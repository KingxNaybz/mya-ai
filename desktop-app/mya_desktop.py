"""
Mya Desktop — a screen-aware, conversational voice assistant for Windows
that shares her real brain (skills, memory, voice) with the web dashboard.

Press the hotkey (default: ctrl+alt+m), ask or tell her something, and
Mya looks at your current screen, combines that with what you said, and
sends it to the SAME Ask Mya endpoint the web dashboard uses — so she can
remember facts, look things up, and talk back in the same voice, all
from a screen she has no direct data access to (like a CRM). The
"Open Dashboard" tray option shows the real web dashboard in its own
window.

This is a separate, self-contained project from the web dashboard —
nothing here is shared in code with command-center/ or api/, only the
same deployed API and Supabase-backed brain over HTTPS. See README.md in
this folder for setup instructions.
"""

import base64
import io
import json
import os
import time
import traceback
from typing import List, Optional

import requests
from dotenv import load_dotenv

load_dotenv()

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL = "claude-sonnet-5"
HOTKEY = os.environ.get("MYA_HOTKEY", "ctrl+alt+m")

# The deployed web dashboard's own Ask Mya endpoint — same brain, same
# skills, same memory, same voice as the browser version. Override in
# .env if the dashboard ever moves to a different URL (e.g. once merged
# to a production domain).
DASHBOARD_BASE_URL = os.environ.get(
    "DASHBOARD_BASE_URL",
    "https://mya-ai-git-claude-mya-command-b9a13e-kingxnaybz-5385s-projects.vercel.app",
).rstrip("/")

MAX_HISTORY = 20

# This is a PERCEPTION prompt, not an answering prompt — it only reports
# what's visible, factually, and hands off the actual thinking (deciding
# what to do, whether to remember something, how to answer) to the real
# Ask Mya brain via the dashboard API. This is what lets "remember these
# leads" while looking at a CRM actually persist as a real memory, the
# same way it would from the web dashboard's chat.
VISION_SYSTEM_PROMPT = (
    "You are looking at a screenshot of the user's computer screen. "
    "Factually describe whatever is relevant to their question or "
    "instruction below — concrete details (names, numbers, statuses, "
    "text you can actually read), not a summary or your own opinion. "
    "Someone else will decide what to do with what you report. If "
    "nothing relevant is visible, say so plainly."
)


def build_anthropic_payload(question: str, image_base64: str, media_type: str = "image/png") -> dict:
    """Pure function: builds the request body for Anthropic's Messages API
    with a screenshot + spoken question, used for the perception step
    only. Kept separate from the network call so it's testable without a
    real screenshot or microphone."""
    return {
        "model": ANTHROPIC_MODEL,
        "max_tokens": 500,
        "output_config": {"effort": "low"},
        "system": VISION_SYSTEM_PROMPT,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {"type": "base64", "media_type": media_type, "data": image_base64},
                    },
                    {"type": "text", "text": question},
                ],
            }
        ],
    }


def extract_reply_text(anthropic_response: dict) -> str:
    """Pure function: pulls the plain text reply out of an Anthropic
    Messages API response."""
    blocks = anthropic_response.get("content", [])
    text = "\n".join(b.get("text", "") for b in blocks if b.get("type") == "text").strip()
    return text or "I couldn't make out anything relevant on screen."


def describe_screen(question: str, image_bytes: bytes) -> str:
    """The perception step: what does the screen actually show, relevant
    to what the user said? This does NOT decide what to do about it —
    that's the dashboard brain's job."""
    if not ANTHROPIC_API_KEY:
        raise RuntimeError("ANTHROPIC_API_KEY isn't set — check your .env file.")
    image_base64 = base64.b64encode(image_bytes).decode("utf-8")
    payload = build_anthropic_payload(question, image_base64)
    res = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json=payload,
        timeout=30,
    )
    if not res.ok:
        raise RuntimeError(f"Anthropic API error {res.status_code}: {res.text[:300]}")
    return extract_reply_text(res.json())


# ---------------------------------------------------------------------------
# Screen ACTIONS (click/type) — a deliberately separate, more cautious path
# from plain Q&A. She only acts when explicitly told to, always describes
# the target and asks for a clear "yes" first, and never guesses a click
# location she isn't confident about. There is no undo for a wrong click in
# another program, unlike everything else this session built (which all has
# a real undo log) — so failing safe here matters more than anywhere else.
# ---------------------------------------------------------------------------

ACTION_KEYWORDS = ("click", "press", "select", "type", "enter", "tap", "check the box", "toggle")

AFFIRMATIVE_WORDS = ("yes", "yeah", "yep", "yup", "go ahead", "do it", "confirm", "confirmed", "sure", "okay", "ok")


def is_action_request(question: str) -> bool:
    """Pure function: does this sound like an instruction to interact with
    the screen, rather than a question about it? Deliberately simple and
    keyword-based rather than another LLM call — deterministic and
    auditable for something this safety-sensitive."""
    q = question.lower()
    return any(kw in q for kw in ACTION_KEYWORDS)


def is_affirmative(text: str) -> bool:
    """Pure function: fails SAFE. Only a clear, known affirmative phrase
    counts as yes — anything unclear, empty, off-topic, or negative is
    treated as no. This is the actual safety gate before a click happens,
    so it deliberately does not try to be clever about interpreting intent."""
    t = text.strip().lower()
    return any(t == w or t.startswith(w + " ") for w in AFFIRMATIVE_WORDS)


LOCATE_SYSTEM_PROMPT = (
    "You are looking at a screenshot of the user's screen and an instruction "
    "to click, type into, or otherwise interact with something on it. "
    "Respond with ONLY a single JSON object and nothing else — no markdown, "
    "no explanation — in exactly this shape: "
    '{"found": true, "target_description": "plain description of the '
    'element and where it is", "x": <pixel x coordinate of its center>, '
    '"y": <pixel y coordinate of its center>, "action_type": "click" or '
    '"type", "text_to_type": "<text to type, or null if action_type is '
    'click>"}. '
    "If you cannot confidently identify one specific, clearly-visible "
    "element matching the instruction, instead respond with exactly "
    '{"found": false, "target_description": "<plainly say what you could '
    'not find and why>"}. Never guess coordinates for something you are '
    "not genuinely confident you can see."
)


def build_locate_payload(instruction: str, image_base64: str, media_type: str = "image/png") -> dict:
    """Pure function: builds the request asking Claude to locate a specific
    on-screen element to interact with, as structured JSON."""
    return {
        "model": ANTHROPIC_MODEL,
        "max_tokens": 300,
        "output_config": {"effort": "low"},
        "system": LOCATE_SYSTEM_PROMPT,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {"type": "base64", "media_type": media_type, "data": image_base64},
                    },
                    {"type": "text", "text": instruction},
                ],
            }
        ],
    }


def parse_locate_response(anthropic_response: dict) -> dict:
    """Pure function: parses Claude's structured click-target JSON. Fails
    SAFE on any problem — malformed JSON, not a dict, missing/non-numeric
    coordinates all become {"found": False} rather than ever passing through
    a guessed or malformed location to something that will actually move
    the mouse and click."""
    blocks = anthropic_response.get("content", [])
    text = "\n".join(b.get("text", "") for b in blocks if b.get("type") == "text").strip()
    try:
        data = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return {"found": False, "target_description": "Couldn't understand what I was looking at."}
    if not isinstance(data, dict) or not data.get("found"):
        description = data.get("target_description") if isinstance(data, dict) else None
        return {"found": False, "target_description": description or "I couldn't find that on screen."}
    if not isinstance(data.get("x"), (int, float)) or not isinstance(data.get("y"), (int, float)):
        return {"found": False, "target_description": "I found something like that, but couldn't pin down exactly where."}
    return data


def locate_target(instruction: str, image_bytes: bytes) -> dict:
    if not ANTHROPIC_API_KEY:
        return {"found": False, "target_description": "ANTHROPIC_API_KEY isn't set — check your .env file."}
    image_base64 = base64.b64encode(image_bytes).decode("utf-8")
    payload = build_locate_payload(instruction, image_base64)
    res = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json=payload,
        timeout=30,
    )
    if not res.ok:
        raise RuntimeError(f"Anthropic API error {res.status_code}: {res.text[:300]}")
    return parse_locate_response(res.json())


def perform_action(action: dict) -> None:
    import pyautogui

    x, y = int(action["x"]), int(action["y"])
    pyautogui.moveTo(x, y, duration=0.3)
    pyautogui.click()
    if action.get("action_type") == "type" and action.get("text_to_type"):
        pyautogui.typewrite(action["text_to_type"], interval=0.02)


def handle_action_request(instruction: str, screenshot_bytes: bytes) -> None:
    try:
        target = locate_target(instruction, screenshot_bytes)
    except Exception as e:
        print(f"[Mya] Couldn't read the screen: {e}")
        return

    if not target.get("found"):
        not_found_message = target.get("target_description") or "I couldn't find that on screen."
        print(f"[Mya] {not_found_message}")
        return

    action_type = target.get("action_type", "click")
    print(f"[Mya] I see {target['target_description']}. Should I {action_type} it? (say yes or no)")
    try:
        confirmation = listen_for_question(timeout=5, phrase_time_limit=5)
    except Exception:
        print("[Mya] Didn't hear a confirmation — not touching anything.")
        return

    if not is_affirmative(confirmation):
        print(f'[Mya] Okay, not doing that (heard: "{confirmation}").')
        return

    try:
        perform_action(target)
        print(f"[Mya] Done — {action_type}ed {target['target_description']}.")
    except Exception as e:
        print(f"[Mya] Tried to act but something went wrong: {e}")


def build_combined_message(question: str, screen_description: str) -> str:
    """Pure function: combines what the user said with what's actually on
    screen into the single text message sent to the dashboard brain.

    Explicitly asks for a direct conversational response, not just an
    acknowledgment — without this, the dashboard brain tends to treat the
    screen description as a fact already reported to it (nothing to add),
    and replies with a bare "Done." instead of actually answering, since
    from its own system prompt's perspective there's no tool call needed
    and no new information to react to."""
    return (
        f'I\'m looking at my screen right now and just said: "{question}"\n\n'
        f"Here's what's actually visible on my screen: {screen_description}\n\n"
        "Please respond to me directly based on this, the same as if I'd "
        "typed this into the dashboard chat myself — answer my question or "
        "take whatever action fits, don't just acknowledge that you got this."
    )


def build_dashboard_payload(message: str, history: List[dict], voice: bool = True) -> dict:
    """Pure function: builds the request body for the dashboard's Ask Mya
    endpoint — the exact same shape the web dashboard's own chat sends."""
    return {"message": message, "voice": voice, "history": history}


def append_turn(history: List[dict], user_message: str, assistant_reply: str, max_len: int = MAX_HISTORY) -> List[dict]:
    """Pure function: appends a user/assistant turn to the rolling
    conversation history and trims it, matching the same windowing the
    web dashboard's chat uses."""
    updated = history + [
        {"role": "user", "content": user_message},
        {"role": "assistant", "content": assistant_reply},
    ]
    return updated[-max_len:] if len(updated) > max_len else updated


def ask_dashboard_brain(message: str, history: List[dict]) -> dict:
    """Sends a message (with rolling history) to the SAME Ask Mya endpoint
    the web dashboard uses — same skills, same memory, same voice. Raises
    with a clear diagnostic if the response isn't valid JSON (most likely
    cause: Vercel's deployment protection blocking a non-browser request,
    which shows up as an HTML login page instead of JSON)."""
    url = f"{DASHBOARD_BASE_URL}/api/command-center-ask-mya"
    payload = build_dashboard_payload(message, history, voice=True)
    res = requests.post(url, json=payload, timeout=45)
    try:
        return res.json()
    except ValueError:
        raise RuntimeError(
            f"Dashboard didn't return JSON (status {res.status_code}) — likely blocked by Vercel's "
            f"deployment protection rather than a real API error. Response started with: {res.text[:200]!r}"
        )


def capture_screen() -> bytes:
    from PIL import ImageGrab

    img = ImageGrab.grab()
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def listen_for_question(timeout: int = 5, phrase_time_limit: int = 10) -> str:
    import speech_recognition as sr

    recognizer = sr.Recognizer()
    with sr.Microphone() as source:
        recognizer.adjust_for_ambient_noise(source, duration=0.5)
        print("[Mya] Listening...")
        audio = recognizer.listen(source, timeout=timeout, phrase_time_limit=phrase_time_limit)
    print("[Mya] Transcribing...")
    return recognizer.recognize_google(audio)


def play_audio(mp3_bytes: bytes) -> None:
    import pygame

    pygame.mixer.init()
    buf = io.BytesIO(mp3_bytes)
    pygame.mixer.music.load(buf)
    pygame.mixer.music.play()
    while pygame.mixer.music.get_busy():
        time.sleep(0.1)


# Conversation memory for THIS desktop session — resets on restart, same
# as the web dashboard's own chat history. Not persisted to disk; what
# gets persisted PERMANENTLY (across sessions and into the web dashboard
# too) is whatever the dashboard brain itself decides to remember via
# its own remember_fact/create_project/etc. skills.
conversation_history: List[dict] = []


def handle_activation() -> None:
    global conversation_history
    try:
        print("\n[Mya] Hotkey pressed — capturing your screen and listening...")
        screenshot_bytes = capture_screen()

        try:
            question = listen_for_question()
        except Exception as e:
            print(f"[Mya] Didn't catch anything ({type(e).__name__}: {e}) — try again.")
            return
        if not question.strip():
            print("[Mya] Didn't catch anything — try again.")
            return
        print(f"[Mya] You said: {question}")

        if is_action_request(question):
            handle_action_request(question, screenshot_bytes)
            return

        try:
            screen_description = describe_screen(question, screenshot_bytes)
        except Exception as e:
            print(f"[Mya] Couldn't read the screen: {e}")
            return
        print(f"[Mya] What's on screen: {screen_description}")

        combined_message = build_combined_message(question, screen_description)

        try:
            data = ask_dashboard_brain(combined_message, conversation_history)
        except Exception as e:
            print(f"[Mya] Couldn't reach her brain: {e}")
            return

        reply = data.get("reply") or "Done."
        print(f"[Mya] {reply}")

        conversation_history = append_turn(conversation_history, combined_message, reply)

        audio_base64 = data.get("audioBase64")
        if audio_base64:
            try:
                play_audio(base64.b64decode(audio_base64))
            except Exception as e:
                print(f"[Mya] Got a reply but couldn't play the voice: {e}")
        else:
            print("[Mya] (No spoken audio came back from the dashboard — either voice isn't set up "
                  "server-side, or something failed on that end. Check Vercel's Runtime Logs for an "
                  "'ElevenLabs TTS failed' line if this keeps happening.)")
    except Exception:
        print("[Mya] Something went wrong:")
        traceback.print_exc()


def open_dashboard_window() -> None:
    """Opens the real web dashboard (same data, same everything) in its
    own native-feeling window instead of a browser tab."""
    try:
        import webview

        webview.create_window("Mya — Elevate Construction", DASHBOARD_BASE_URL, width=1440, height=900)
        webview.start()
    except Exception:
        print("[Mya] Couldn't open the dashboard window:")
        traceback.print_exc()


def run_tray_icon() -> None:
    import pystray
    from PIL import Image, ImageDraw

    def make_icon_image():
        img = Image.new("RGB", (64, 64), "black")
        draw = ImageDraw.Draw(img)
        draw.ellipse((8, 8, 56, 56), fill=(47, 178, 255))
        return img

    def on_quit(icon, _item):
        icon.stop()
        os._exit(0)

    def on_ask_now(_icon, _item):
        handle_activation()

    def on_open_dashboard(_icon, _item):
        open_dashboard_window()

    menu = pystray.Menu(
        pystray.MenuItem("Ask Mya now", on_ask_now),
        pystray.MenuItem("Open Dashboard", on_open_dashboard),
        pystray.MenuItem("Quit", on_quit),
    )
    icon = pystray.Icon("mya-desktop", make_icon_image(), "Mya Desktop", menu)
    icon.run()


def main() -> None:
    if not ANTHROPIC_API_KEY:
        print("[Mya] Warning: ANTHROPIC_API_KEY isn't set — check your .env file. Mya can't see without it.")

    import keyboard

    print(f"[Mya] Ready. Press {HOTKEY} anywhere to ask Mya about your screen.")
    print("[Mya] Right-click the tray icon for 'Ask Mya now' or 'Open Dashboard'.")
    print(f"[Mya] Talking to the dashboard brain at: {DASHBOARD_BASE_URL}")
    keyboard.add_hotkey(HOTKEY, handle_activation)

    run_tray_icon()


if __name__ == "__main__":
    main()

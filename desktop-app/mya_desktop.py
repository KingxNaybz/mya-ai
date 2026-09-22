"""
Mya Desktop — a screen-aware voice assistant for Windows.

Press the hotkey (default: ctrl+alt+m), ask your question out loud, and
Mya looks at your current screen and answers by voice, in the same
ElevenLabs voice as the phone system and web dashboard.

This is a separate, self-contained project from the web dashboard —
nothing here is shared with command-center/ or api/. See README.md in
this folder for setup instructions.
"""

import base64
import io
import os
import time
import traceback
from typing import Optional

import requests
from dotenv import load_dotenv

load_dotenv()

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL = "claude-sonnet-5"
ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY", "")
ELEVENLABS_VOICE_ID = os.environ.get("ELEVENLABS_VOICE_ID", "")
HOTKEY = os.environ.get("MYA_HOTKEY", "ctrl+alt+m")

SYSTEM_PROMPT = (
    "You are Mya, looking at a screenshot of the user's computer screen. "
    "Answer their spoken question about what's on screen clearly and "
    "concisely, in a way that sounds natural when read aloud. If you "
    "can't tell what they're asking about from the screenshot, say so "
    "plainly instead of guessing."
)


def build_anthropic_payload(question: str, image_base64: str, media_type: str = "image/png") -> dict:
    """Pure function: builds the request body for Anthropic's Messages API
    with a screenshot + spoken question. Kept separate from the network
    call itself so it can be tested without hitting the real API or
    needing a real screenshot/microphone."""
    return {
        "model": ANTHROPIC_MODEL,
        "max_tokens": 500,
        "output_config": {"effort": "low"},
        "system": SYSTEM_PROMPT,
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
    return text or "I couldn't come up with an answer for that."


def ask_claude_about_screen(question: str, image_bytes: bytes) -> str:
    if not ANTHROPIC_API_KEY:
        return "ANTHROPIC_API_KEY isn't set — check your .env file."
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


def synthesize_speech(text: str) -> Optional[bytes]:
    """Returns MP3 bytes, or None if voice isn't configured or the call
    fails — voice is a nice-to-have, it should never crash the whole flow."""
    if not ELEVENLABS_API_KEY or not ELEVENLABS_VOICE_ID or not text:
        return None
    try:
        res = requests.post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{ELEVENLABS_VOICE_ID}",
            headers={
                "xi-api-key": ELEVENLABS_API_KEY,
                "content-type": "application/json",
                "accept": "audio/mpeg",
            },
            json={"text": text, "model_id": "eleven_v3"},
            timeout=30,
        )
        if not res.ok:
            print(f"[Mya] ElevenLabs TTS failed: {res.status_code} {res.text[:300]}")
            return None
        return res.content
    except Exception as e:
        print(f"[Mya] ElevenLabs TTS error: {e}")
        return None


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


def handle_activation() -> None:
    try:
        print("\n[Mya] Hotkey pressed — capturing your screen and listening for your question...")
        screenshot_bytes = capture_screen()

        try:
            question = listen_for_question()
        except Exception:
            print("[Mya] Didn't catch a question in time — try again.")
            return
        if not question.strip():
            print("[Mya] Didn't catch anything — try again.")
            return
        print(f"[Mya] You asked: {question}")

        reply = ask_claude_about_screen(question, screenshot_bytes)
        print(f"[Mya] {reply}")

        audio_bytes = synthesize_speech(reply)
        if audio_bytes:
            play_audio(audio_bytes)
    except Exception:
        print("[Mya] Something went wrong:")
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

    menu = pystray.Menu(
        pystray.MenuItem("Ask Mya now", on_ask_now),
        pystray.MenuItem("Quit", on_quit),
    )
    icon = pystray.Icon("mya-desktop", make_icon_image(), "Mya Desktop", menu)
    icon.run()


def main() -> None:
    if not ANTHROPIC_API_KEY:
        print("[Mya] Warning: ANTHROPIC_API_KEY isn't set — check your .env file. Mya can't think without it.")
    if not ELEVENLABS_API_KEY or not ELEVENLABS_VOICE_ID:
        print("[Mya] Note: ElevenLabs isn't configured — Mya will still work, but replies will only show in this console, not out loud.")

    import keyboard

    print(f"[Mya] Ready. Press {HOTKEY} anywhere to ask Mya about your screen.")
    print("[Mya] Right-click the tray icon (or use 'Ask Mya now' there) as an alternative to the hotkey.")
    keyboard.add_hotkey(HOTKEY, handle_activation)

    run_tray_icon()


if __name__ == "__main__":
    main()

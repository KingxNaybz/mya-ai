# Mya Desktop (Windows)

A screen-aware voice assistant: press a hotkey, ask a question out loud,
and Mya looks at your current screen and answers back in the same voice
as the phone system and web dashboard.

This is a completely separate project from the web dashboard
(`command-center/`) — nothing is shared between them except that they
use the same Anthropic and ElevenLabs accounts.

**Honest limits of this v1:**
- Manual activation only (press the hotkey) — she does not watch your
  screen continuously in the background.
- Windows only.
- Runs as a Python script in a visible console window (not a packaged
  `.exe` yet) — you'll see her status/errors printed there as she works,
  which is intentional for now so problems are easy to diagnose together.

## 1. Install Python

If you don't already have it: download and install Python 3.11 from
[python.org](https://www.python.org/downloads/). During installation,
check the box that says **"Add python.exe to PATH"**.

## 2. Install the dependencies

Open a Command Prompt in this `desktop-app` folder and run:

```
pip install -r requirements.txt
```

**If `PyAudio` fails to install** (this is a known, common Windows
hiccup — it needs a compiled component pip doesn't always find a
pre-built version of): run this instead, then try again:

```
pip install pipwin
pipwin install pyaudio
pip install -r requirements.txt
```

## 3. Add your API keys

Copy `.env.example` to a new file named `.env` in this same folder, and
fill in the three values. These are the **same** values already set in
Vercel for the web dashboard (`ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`,
`ELEVENLABS_VOICE_ID`) — copy them from there, don't generate new ones.

Never share this `.env` file or paste its contents anywhere — it holds
real API keys.

## 4. Run it

```
python mya_desktop.py
```

A console window opens and a small icon appears in your system tray
(bottom-right, may be under the "^" overflow arrow). Leave the console
window open — that's where Mya's status and any errors show up.

## 5. Use it

Press **Ctrl+Alt+M** anywhere (any app, any window) to activate her:

1. She captures whatever's currently on your screen.
2. Speak your question — you have about 10 seconds.
3. She reads the screenshot + your question, thinks, and speaks the
   answer back through your speakers.

You can also right-click the tray icon → **"Ask Mya now"** as an
alternative to the hotkey.

To quit: right-click the tray icon → **Quit**.

## Changing the hotkey

If `Ctrl+Alt+M` conflicts with something else, add this line to your
`.env` file with a different combination (see the
[`keyboard` library's hotkey syntax](https://github.com/boppreh/keyboard#keyboard.add_hotkey)):

```
MYA_HOTKEY=ctrl+alt+j
```

## Troubleshooting

- **Nothing happens when you press the hotkey** — check the console
  window for errors. Some games/apps that run "as administrator" can
  block global hotkeys from non-admin programs; try running your Command
  Prompt as administrator too.
- **"Didn't catch a question in time"** — you have about 10 seconds
  after the hotkey to speak; try again and start talking right away.
- **She responds but with no voice** — check the console for an
  `ElevenLabs TTS failed` line; that'll show the real error (usually a
  missing/wrong key in `.env`).
- **Microphone doesn't seem to pick anything up** — check Windows'
  microphone privacy settings (Settings → Privacy & security →
  Microphone) allow desktop apps to use it.

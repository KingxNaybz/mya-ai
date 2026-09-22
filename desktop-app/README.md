# Mya Desktop (Windows)

A screen-aware, conversational voice assistant that shares her real
brain with the web dashboard: press a hotkey, tell her something, and
she looks at your current screen, combines that with what you said, and
sends it to the SAME Ask Mya endpoint the web dashboard uses — same
skills, same memory, same voice. That's what makes "look at my CRM and
remember these leads" actually work: what she learns gets saved for
real, and shows up later even in the web dashboard.

Right-click the tray icon → **Open Dashboard** to see the real web
dashboard in its own window, any time.

This is a separate project from the web dashboard (`command-center/`) —
no code is shared between them, only the same deployed API and database
over the internet.

**Honest limits of this v1:**
- Manual activation only (press the hotkey) — she does not watch your
  screen continuously in the background.
- She can only *see* your screen and talk about it — she cannot click,
  type, or take any action in other programs. That's a deliberately
  separate, bigger, and riskier capability not built here.
- Windows only.
- Runs as a Python script in a visible console window (not a packaged
  `.exe` yet) — you'll see her status/errors printed there as she works,
  which is intentional for now so problems are easy to diagnose together.
- Needs an internet connection at every step (screen understanding,
  talking to her brain, and her voice all happen over the network) —
  nothing runs offline.

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

## 3. Add your API key

Copy `.env.example` to a new file named `.env` in this same folder, and
fill in `ANTHROPIC_API_KEY`. This is the **same** value already set in
Vercel for the web dashboard — copy it from there, don't generate a new
one. (Voice and everything else is handled by the dashboard's own brain
now, so no ElevenLabs key is needed here.)

Never share this `.env` file or paste its contents anywhere — it holds
a real API key.

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
2. Speak what you want — a question, or an instruction like "remember
   these leads." You have about 10 seconds.
3. She reads the screen, sends what she saw plus what you said to her
   real brain (the same one the web dashboard uses), and speaks the
   answer back — remembering it for real if that's what you asked.

You can also right-click the tray icon:
- **"Ask Mya now"** — same as the hotkey.
- **"Open Dashboard"** — opens the real web dashboard in its own window.

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
- **"Didn't catch anything"** — you have about 10 seconds after the
  hotkey to speak; try again and start talking right away.
- **`ModuleNotFoundError: No module named 'distutils'`** — a known
  incompatibility between older SpeechRecognition releases and
  Python 3.12+ (which removed `distutils` entirely). Run
  `pip install --upgrade SpeechRecognition` and try again.
- **"Couldn't reach her brain" / mentions being blocked by Vercel** —
  the dashboard's deployment protection may be blocking a request that
  doesn't come from a logged-in browser. Tell me the exact message
  printed and we'll sort it out together — this is genuinely something
  I can't test myself from here.
- **Microphone doesn't seem to pick anything up** — check Windows'
  microphone privacy settings (Settings → Privacy & security →
  Microphone) allow desktop apps to use it.

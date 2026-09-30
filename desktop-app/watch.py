"""
Watch Mya — the Windows Agent side of the Command Center's live-work view.

Opt-in: nothing here runs unless MYA_WATCH=on is set in .env, so Mya
Desktop behaves exactly as before by default.

It keeps the agent's existing connection model: OUTBOUND HTTPS only, to the
same Command Center API, authenticated with the same COMMAND_CENTER_API_KEY
header. No port is opened on this PC and nothing connects to it. About once
a second it reports a heartbeat (plus task / app / step and, every couple of
seconds, a downscaled screenshot) to
    POST {DASHBOARD_BASE_URL}/api/command-center-data?type=computer-report
and the response says whether Mya may issue input right now. That answer
feeds ControlGate, which every mouse/keyboard call checks immediately
before acting.

Control (same contract as lib/computer.ts in the web project):
    mya     Mya may issue input.
    user    You have the computer. Mya issues NO input.
    paused  Her task is kept; input is suspended.
The agent can only ever YIELD control (report "user"), never take it: when
it sees the mouse move in a way Mya didn't cause, it stops and hands you
control on the spot, then tells the Command Center.

Pure helpers (no Windows, network or screen needed) are unit-tested in
test_watch.py.
"""

import base64
import io
import math
import os
import threading
import time
from typing import Optional, Tuple

CONTROLS = ("mya", "user", "paused")
REPORT_INTERVAL_S = float(os.environ.get("MYA_WATCH_INTERVAL", "1.0"))
FRAME_INTERVAL_S = float(os.environ.get("MYA_WATCH_FRAME_INTERVAL", "2.0"))
FRAME_MAX_WIDTH = 1280
FRAME_QUALITY = 55
MAX_FRAME_CHARS = 700_000
# An answer older than this is not trusted to allow input.
GATE_MAX_AGE_S = 5.0
# How far (px) the cursor may drift from where Mya left it before it counts
# as you taking over.
TAKEOVER_TOLERANCE_PX = 6
# Mya's own cursor moves settle within this window.
SELF_MOVE_GRACE_S = 0.6


def watch_enabled(env=os.environ) -> bool:
    return str(env.get("MYA_WATCH", "")).strip().lower() in ("1", "on", "true", "yes")


def may_issue_input(control: Optional[str]) -> bool:
    """Only an explicit "mya" allows input. Anything else -- user, paused,
    unknown, missing -- does not."""
    return control == "mya"


class ControlGate:
    """What the Command Center last said about control, and when.

    allows_autonomous_input(): for work Mya starts herself -- requires a
    FRESH "mya" answer from the server.
    allows_confirmed_action(): for the existing hotkey flow, where you asked
    for a click and said "yes" at the PC. Blocked whenever the Command Center
    last said "user" or "paused" (you paused Mya or took control); with no
    Watch Mya answer at all, the existing confirmed flow is unchanged.
    """

    def __init__(self, clock=time.monotonic):
        self._clock = clock
        self._lock = threading.Lock()
        self.control: Optional[str] = None
        self.updated_at: Optional[float] = None

    def update(self, control: Optional[str]) -> None:
        with self._lock:
            self.control = control if control in CONTROLS else None
            self.updated_at = self._clock()

    def yield_to_user(self) -> None:
        """Local and immediate: never waits for the network."""
        self.update("user")

    def _fresh(self) -> bool:
        return self.updated_at is not None and (self._clock() - self.updated_at) <= GATE_MAX_AGE_S

    def allows_autonomous_input(self) -> bool:
        with self._lock:
            return self._fresh() and may_issue_input(self.control)

    def allows_confirmed_action(self) -> bool:
        with self._lock:
            return self.control not in ("user", "paused")

    def blocked_reason(self) -> Optional[str]:
        with self._lock:
            if self.control == "user":
                return "You have control in the Command Center, so I'm not touching anything. Hand it back there when you're ready."
            if self.control == "paused":
                return "I'm paused in the Command Center, so I'm not touching anything. Resume me there first."
            return None


def user_moved(expected: Optional[Tuple[int, int]], actual: Optional[Tuple[int, int]], tolerance: int = TAKEOVER_TOLERANCE_PX) -> bool:
    """Did the cursor move somewhere Mya didn't put it?"""
    if expected is None or actual is None:
        return False
    return math.hypot(actual[0] - expected[0], actual[1] - expected[1]) > tolerance


def build_report(state: dict, frame: Optional[str] = None, yield_control: bool = False, events=None) -> dict:
    """The report body. Only known fields; control is only ever "user"."""
    body = {k: state.get(k) for k in ("deviceName", "taskId", "task", "app", "step", "status", "approvalId") if k in state}
    if frame:
        body["frame"] = frame
    if yield_control:
        body["control"] = "user"
    if events:
        body["events"] = events[:20]
    return body


def encode_frame(img, max_width: int = FRAME_MAX_WIDTH, quality: int = FRAME_QUALITY) -> Optional[str]:
    """Downscaled JPEG data URL, or None if it can't be made small enough."""
    w, h = img.size
    if w > max_width:
        img = img.resize((max_width, max(1, int(h * max_width / w))))
    q = quality
    while q >= 25:
        buf = io.BytesIO()
        img.convert("RGB").save(buf, format="JPEG", quality=q, optimize=True)
        url = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
        if len(url) <= MAX_FRAME_CHARS:
            return url
        q -= 10
    return None


class Reporter(threading.Thread):
    """Background heartbeat. Never raises; a failed report just means the
    gate goes stale, which blocks autonomous input (fail safe)."""

    def __init__(self, base_url: str, api_key: str, gate: ControlGate, state: dict, device_name: str = "Windows PC", headers: Optional[dict] = None):
        super().__init__(daemon=True)
        self.url = base_url.rstrip("/") + "/api/command-center-data?type=computer-report"
        self.api_key = api_key
        self.headers = dict(headers or {"x-command-center-key": api_key})
        self.last_problem = None
        self.gate = gate
        self.state = state
        self.state.setdefault("deviceName", device_name)
        self.expected_pos: Optional[Tuple[int, int]] = None
        self.self_move_at = 0.0
        self.pending_events = []
        self._last_frame = 0.0
        self._stop = threading.Event()

    def note_self_move(self, pos: Tuple[int, int]) -> None:
        self.expected_pos = pos
        self.self_move_at = time.monotonic()

    def event(self, kind: str, text: str) -> None:
        self.pending_events.append({"kind": kind, "text": text[:200], "app": self.state.get("app")})

    def stop(self) -> None:
        self._stop.set()

    def _takeover_seen(self) -> bool:
        if not may_issue_input(self.gate.control) or time.monotonic() - self.self_move_at < SELF_MOVE_GRACE_S:
            return False
        try:
            import pyautogui
            pos = tuple(pyautogui.position())
        except Exception:
            return False
        return user_moved(self.expected_pos, pos)

    def _frame(self) -> Optional[str]:
        if time.monotonic() - self._last_frame < FRAME_INTERVAL_S:
            return None
        self._last_frame = time.monotonic()
        try:
            from PIL import ImageGrab
            return encode_frame(ImageGrab.grab())
        except Exception:
            return None

    def run(self) -> None:
        import requests

        while not self._stop.is_set():
            takeover = self._takeover_seen()
            if takeover:
                self.gate.yield_to_user()  # stop first, report second
                print("[Mya] You moved the mouse — I've stopped and handed you control.")
            events, self.pending_events = self.pending_events, []
            body = build_report(self.state, frame=self._frame(), yield_control=takeover, events=events)
            try:
                res = requests.post(self.url, json=body, headers=self.headers, timeout=5)
                problem = None
                if res.ok:
                    try:
                        self.gate.update(res.json().get("control"))
                    except ValueError:
                        problem = "got a web page instead of JSON (likely Vercel Authentication: set VERCEL_PROTECTION_BYPASS)"
                else:
                    problem = f"HTTP {res.status_code}" + (" (check COMMAND_CENTER_API_KEY)" if res.status_code in (401, 403) else " (tables set up?)" if res.status_code == 503 else "")
            except Exception as e:
                problem = f"can't reach the dashboard ({type(e).__name__})"
            if problem != self.last_problem:
                print(f"[Mya] Watch Mya: {problem}" if problem else "[Mya] Watch Mya: connected — reporting to the Command Center.")
                self.last_problem = problem
            self._stop.wait(REPORT_INTERVAL_S)

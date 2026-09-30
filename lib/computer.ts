/**
 * Watch Mya: the computer-control contract shared by the Command Center API
 * (api/command-center-data.ts ?type=computer*) and mirrored by the Windows
 * Agent (desktop-app/watch.py). Pure functions only, so every rule below is
 * tested (tests/command-center/computer.test.mjs).
 *
 * Connection model (unchanged from the existing Windows Agent): the agent
 * only ever makes OUTBOUND HTTPS calls to this API, authenticated with its
 * own COMMAND_CENTER_API_KEY header. No port on the PC is opened, and the
 * Command Center never connects to the PC directly. The agent reports
 * (heartbeat, task, app, step, a downscaled frame, recent events) and every
 * report's response carries the owner's current control state, so the agent
 * learns about Pause / Take Control within one report interval.
 *
 * Control ownership -- who may issue mouse/keyboard input:
 *   mya     Mya may issue input.
 *   user    The owner has the computer. Mya MUST NOT issue input.
 *   paused  The task is kept, input is suspended.
 * Rules:
 *   - Only the owner (a signed-in Command Center session) can GRANT control
 *     to Mya (resume, return). The agent can only YIELD it (report "user",
 *     e.g. when it sees the owner move the mouse). Nothing can make the
 *     agent take control for itself.
 *   - Take Control and Stop are always accepted, from any state (fail safe).
 *   - Computer control never raises Mya's authority. Consequential actions
 *     still go through mya_approvals; while a task waits on one, its status
 *     is "approval" and approvalId names the request.
 */

export type Control = "mya" | "user" | "paused";
export type TaskStatus = "idle" | "working" | "waiting" | "approval" | "completed" | "blocked" | "stopped";
export type OwnerAction = "pause" | "resume" | "take" | "return" | "stop";

export const CONTROLS: Control[] = ["mya", "user", "paused"];
export const TASK_STATUSES: TaskStatus[] = ["idle", "working", "waiting", "approval", "completed", "blocked", "stopped"];
export const OWNER_ACTIONS: OwnerAction[] = ["pause", "resume", "take", "return", "stop"];

// A frame is a downscaled screenshot. Only raster data URLs are accepted
// from the agent (never SVG or anything that can carry script), and small
// enough to store in one row and poll about once a second.
export const MAX_FRAME_CHARS = 700_000;
export const FRAME_PATTERN = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
export const LIVE_AFTER_MS = 15_000;   // heartbeat newer than this: live
export const STALE_AFTER_MS = 120_000; // older than LIVE, newer than this: stale
export const MAX_EVENTS_PER_REPORT = 20;

export interface ComputerSession {
  deviceId: string;
  deviceName: string | null;
  taskId: string | null;
  task: string | null;
  app: string | null;
  step: string | null;
  status: TaskStatus;
  control: Control;
  controlChangedAt: string | null;
  controlChangedBy: "owner" | "agent" | null;
  approvalId: string | null;
  heartbeatAt: string | null;
  frameAt: string | null;
  startedAt: string | null;
}

export interface ComputerEvent {
  at: string;
  kind: "step" | "action" | "control" | "approval" | "note";
  text: string;
  app?: string | null;
  by: "mya" | "owner" | "agent";
}

export function emptySession(deviceId = "windows"): ComputerSession {
  return {
    deviceId, deviceName: null, taskId: null, task: null, app: null, step: null,
    status: "idle", control: "paused", controlChangedAt: null, controlChangedBy: null,
    approvalId: null, heartbeatAt: null, frameAt: null, startedAt: null,
  };
}

/** The one question every input call asks. Only "mya" allows input. */
export function mayIssueInput(control: string | null | undefined): boolean {
  return control === "mya";
}

const OWNER_TEXT: Record<OwnerAction, string> = {
  pause: "You paused Mya. Her task is kept; she issues no input.",
  resume: "You resumed Mya. She has control again.",
  take: "You took control. Mya stopped issuing input.",
  return: "You returned control to Mya.",
  stop: "You stopped the task. Mya issues no input.",
};

/**
 * An owner's control action. Returns the new session and the event to log,
 * or an error for a transition that doesn't apply (resuming a task you took
 * over is "return", and there's nothing to hand back without a task).
 */
export function applyOwnerAction(
  session: ComputerSession,
  action: string,
  nowIso: string
): { ok: true; session: ComputerSession; event: ComputerEvent } | { ok: false; error: string } {
  if (!OWNER_ACTIONS.includes(action as OwnerAction)) return { ok: false, error: "Unknown control action." };
  const a = action as OwnerAction;
  const s: ComputerSession = { ...session };
  switch (a) {
    case "take":
      s.control = "user";
      break;
    case "stop":
      s.control = s.control === "user" ? "user" : "paused";
      s.status = "stopped";
      s.approvalId = null;
      break;
    case "pause":
      if (s.control === "user") return { ok: false, error: "You have control. There's nothing of Mya's to pause." };
      s.control = "paused";
      break;
    case "resume":
      if (s.control === "user") return { ok: false, error: "You have control. Use Return control to hand it back." };
      if (!s.task || s.status === "stopped" || s.status === "completed") return { ok: false, error: "There's no task to resume." };
      s.control = "mya";
      break;
    case "return":
      if (!s.task || s.status === "stopped" || s.status === "completed") return { ok: false, error: "There's no task to hand back." };
      s.control = "mya";
      break;
  }
  s.controlChangedAt = nowIso;
  s.controlChangedBy = "owner";
  return { ok: true, session: s, event: { at: nowIso, kind: "control", text: OWNER_TEXT[a], by: "owner", app: s.app } };
}

export interface AgentReport {
  deviceName?: string | null;
  taskId?: string | null;
  task?: string | null;
  app?: string | null;
  step?: string | null;
  status?: TaskStatus;
  control?: "user"; // the only control value an agent may report: yielding
  approvalId?: string | null;
  frame?: string | null;
  events?: { kind: ComputerEvent["kind"]; text: string; app?: string | null }[];
}

const cap = (v: unknown, n: number): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null;

/** Validates and trims an agent report. Unknown fields are dropped. */
export function validateReport(body: any): { ok: true; report: AgentReport } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Report must be a JSON object." };
  const r: AgentReport = {};
  if ("deviceName" in body) r.deviceName = cap(body.deviceName, 80);
  if ("taskId" in body) r.taskId = cap(body.taskId, 64);
  if ("task" in body) r.task = cap(body.task, 300);
  if ("app" in body) r.app = cap(body.app, 120);
  if ("step" in body) r.step = cap(body.step, 300);
  if ("approvalId" in body) r.approvalId = cap(body.approvalId, 64);
  if ("status" in body) {
    if (!TASK_STATUSES.includes(body.status)) return { ok: false, error: "Unknown status." };
    r.status = body.status;
  }
  if ("control" in body && body.control !== undefined && body.control !== null) {
    // An agent can hand control to the owner, never take it.
    if (body.control !== "user") return { ok: false, error: "An agent can only yield control." };
    r.control = "user";
  }
  if ("frame" in body && body.frame != null) {
    if (typeof body.frame !== "string" || body.frame.length > MAX_FRAME_CHARS || !FRAME_PATTERN.test(body.frame)) {
      return { ok: false, error: "Frame must be a small JPEG, PNG or WebP data URL." };
    }
    r.frame = body.frame;
  }
  if ("events" in body) {
    if (!Array.isArray(body.events)) return { ok: false, error: "Events must be a list." };
    r.events = body.events.slice(0, MAX_EVENTS_PER_REPORT)
      .filter((e: any) => e && ["step", "action", "approval", "note"].includes(e.kind) && cap(e.text, 200))
      .map((e: any) => ({ kind: e.kind, text: cap(e.text, 200) as string, app: cap(e.app, 120) }));
  }
  return { ok: true, report: r };
}

/**
 * Merges a validated agent report into the session. The owner's decisions
 * win: a stopped task stays stopped until the agent starts a NEW task id,
 * and nothing in a report can grant Mya control.
 */
export function applyAgentReport(session: ComputerSession, r: AgentReport, nowIso: string): ComputerSession {
  const s: ComputerSession = { ...session, heartbeatAt: nowIso };
  if (r.deviceName !== undefined) s.deviceName = r.deviceName;
  const newTask = r.taskId !== undefined && r.taskId !== null && r.taskId !== session.taskId;
  if (newTask) {
    // A new task starts without control: the owner (or Mya through an
    // approved path) hands it over explicitly.
    s.taskId = r.taskId as string;
    s.startedAt = nowIso;
    s.approvalId = null;
    s.status = "working";
    if (s.control === "mya") s.control = "paused";
  }
  if (r.task !== undefined) s.task = r.task;
  if (r.app !== undefined) s.app = r.app;
  if (r.step !== undefined) s.step = r.step;
  if (r.approvalId !== undefined) s.approvalId = r.approvalId;
  if (r.status !== undefined && !(session.status === "stopped" && !newTask)) s.status = r.status;
  if (r.control === "user" && s.control !== "user") {
    s.control = "user";
    s.controlChangedAt = nowIso;
    s.controlChangedBy = "agent";
  }
  if (r.frame) s.frameAt = nowIso;
  return s;
}

/** What the agent is told after each report: the only input it acts on. */
export function agentInstructions(s: ComputerSession) {
  return { control: s.control, mayIssueInput: mayIssueInput(s.control), status: s.status, taskId: s.taskId };
}

/** Live / stale / offline from the last heartbeat. */
export function connectionState(heartbeatAt: string | null, nowMs: number): "live" | "stale" | "offline" {
  if (!heartbeatAt) return "offline";
  const age = nowMs - Date.parse(heartbeatAt);
  if (!(age >= 0) && !(age < 0)) return "offline";
  if (age < LIVE_AFTER_MS) return "live";
  if (age < STALE_AFTER_MS) return "stale";
  return "offline";
}

/* Row <-> session mapping for the mya_computer_sessions table. */
export function sessionFromRow(row: any, deviceId = "windows"): ComputerSession {
  if (!row) return emptySession(deviceId);
  return {
    deviceId: row.device_id || deviceId,
    deviceName: row.device_name ?? null,
    taskId: row.task_id ?? null,
    task: row.task ?? null,
    app: row.app ?? null,
    step: row.step ?? null,
    status: TASK_STATUSES.includes(row.status) ? row.status : "idle",
    control: CONTROLS.includes(row.control) ? row.control : "paused",
    controlChangedAt: row.control_changed_at ?? null,
    controlChangedBy: row.control_changed_by ?? null,
    approvalId: row.approval_id ?? null,
    heartbeatAt: row.heartbeat_at ?? null,
    frameAt: row.frame_at ?? null,
    startedAt: row.started_at ?? null,
  };
}

export function rowFromSession(s: ComputerSession) {
  return {
    device_id: s.deviceId, device_name: s.deviceName, task_id: s.taskId, task: s.task, app: s.app, step: s.step,
    status: s.status, control: s.control, control_changed_at: s.controlChangedAt, control_changed_by: s.controlChangedBy,
    approval_id: s.approvalId, heartbeat_at: s.heartbeatAt, frame_at: s.frameAt, started_at: s.startedAt,
  };
}

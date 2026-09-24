import { createHmac, timingSafeEqual } from "crypto";

const SESSION_COOKIE_NAME = "mya_session";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function signingKey(dashboardPassword: string): string {
  return createHmac("sha256", dashboardPassword).update("mya-dashboard-session-key").digest("hex");
}

export function safeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function createSessionToken(dashboardPassword: string): string {
  const expires = Date.now() + SESSION_TTL_MS;
  const payload = String(expires);
  const signature = createHmac("sha256", signingKey(dashboardPassword)).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

export function verifySessionToken(token: string | undefined | null, dashboardPassword: string): boolean {
  if (!token || !dashboardPassword) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payload, signature] = parts;
  const expires = Number(payload);
  if (!Number.isFinite(expires) || Date.now() > expires) return false;
  const expectedSignature = createHmac("sha256", signingKey(dashboardPassword)).update(payload).digest("hex");
  return safeStringEqual(signature, expectedSignature);
}

export function sessionCookieHeader(token: string): string {
  const maxAgeSeconds = Math.floor(SESSION_TTL_MS / 1000);
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

export function extractSessionCookie(cookieHeader: string | undefined | null): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (!match) return null;
  return match.slice(SESSION_COOKIE_NAME.length + 1);
}

export { SESSION_COOKIE_NAME };

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const BROWSER_SESSION_MS = 30 * 24 * 60 * 60 * 1000;
export const browserCookieName = (port: number) => `roblox_workshop_${port}`;
export function sameSecret(a: string, b: string) {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function signature(payload: string, secret: string) {
  return createHmac("sha256", secret)
    .update("roblox-browser-session.v1:" + payload)
    .digest("base64url");
}
export function issueBrowserSession(
  secret: string,
  port: number,
  at = Date.now(),
) {
  const payload = Buffer.from(
    JSON.stringify({
      v: 1,
      port,
      issuedAt: at,
      expiresAt: at + BROWSER_SESSION_MS,
      nonce: randomBytes(16).toString("hex"),
    }),
  ).toString("base64url");
  return payload + "." + signature(payload, secret);
}
export function browserSession(
  cookie: string | undefined,
  secret: string,
  port: number,
  at = Date.now(),
): { expiresAt: number } | null {
  const value = cookie
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(browserCookieName(port) + "="))
    ?.slice(browserCookieName(port).length + 1);
  if (!value || value.length > 1000) return null;
  const parts = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (!parts || !sameSecret(parts[2], signature(parts[1], secret))) return null;
  try {
    const data = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    );
    return data.v === 1 &&
      data.port === port &&
      Number.isSafeInteger(data.issuedAt) &&
      Number.isSafeInteger(data.expiresAt) &&
      data.issuedAt <= at + 5000 &&
      data.expiresAt > at &&
      data.expiresAt - data.issuedAt === BROWSER_SESSION_MS
      ? { expiresAt: data.expiresAt }
      : null;
  } catch {
    return null;
  }
}

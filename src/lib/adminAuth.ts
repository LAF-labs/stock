import { createHmac, createHash, timingSafeEqual } from "node:crypto";

export const ADMIN_SESSION_COOKIE = "stock_admin_session";

const ADMIN_ID = "once0811";
const ADMIN_PASSWORD_SHA256 = "577206e60ef3053967471db1963163be3c827379dcbd53a7eac427613a5f751c";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export function adminCredentialsAreValid(id: string, password: string): boolean {
  return safeEqual(id.trim(), ADMIN_ID) && safeEqual(sha256(password), ADMIN_PASSWORD_SHA256);
}

export function createAdminSessionToken(now = new Date(), secret = adminSessionSecret()): string {
  const expiresAt = now.getTime() + SESSION_TTL_MS;
  const payload = `once0811.${expiresAt}`;
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyAdminSessionToken(token: string | undefined, now = new Date(), secret = adminSessionSecret()): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [id, expiresAtText, signature] = parts;
  const expiresAt = Number(expiresAtText);
  if (id !== ADMIN_ID || !Number.isFinite(expiresAt) || expiresAt <= now.getTime()) return false;
  return safeEqual(signature, sign(`${id}.${expiresAtText}`, secret));
}

function adminSessionSecret(): string {
  return process.env.STOCK_ADMIN_SESSION_SECRET?.trim() || ADMIN_PASSWORD_SHA256;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

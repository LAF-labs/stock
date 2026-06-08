import type { StockPayload } from "@/lib/stockSnapshotCache";

const SECRET_KEY_RE = /(^|[_-])(access[_-]?token|refresh[_-]?token|api[_-]?key|app[_-]?key|app[_-]?secret|authorization|client[_-]?secret|private[_-]?key|password|secret)([_-]|$)/i;
const DEBUG_KEY_RE = /^(?:__debug|debug|headers|provider_body|provider_response|raw_response|request_headers|response_headers)$/i;

export function sanitizeSnapshotPayload(payload: StockPayload): StockPayload {
  return sanitizeValue(payload) as StockPayload;
}

export function snapshotPayloadHasSensitiveKeys(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(snapshotPayloadHasSensitiveKeys);
  if (!isRecord(value)) return false;
  for (const [key, nested] of Object.entries(value)) {
    if (isSensitiveSnapshotKey(key)) return true;
    if (snapshotPayloadHasSensitiveKeys(nested)) return true;
  }
  return false;
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (!isRecord(value)) return value;

  const next: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (isSensitiveSnapshotKey(key)) continue;
    next[key] = sanitizeValue(nested);
  }
  return next;
}

function isSensitiveSnapshotKey(key: string): boolean {
  return SECRET_KEY_RE.test(key) || DEBUG_KEY_RE.test(key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

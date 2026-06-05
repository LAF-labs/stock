import { NextResponse } from "next/server";

export type JsonReadResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; status: number; error: string; message: string };

export function batchStatusFromResults(results: Array<{ ok?: unknown; error?: unknown }>): number {
  if (!results.length) return 400;
  if (results.some((result) => result.ok === true)) return 200;
  if (results.every((result) => result.error === "snapshot_pending" || result.error === "snapshot_unavailable")) return 202;
  return 502;
}

export async function readJsonObjectWithLimit(request: Request, maxBytes: number): Promise<JsonReadResult> {
  const contentLength = Number(request.headers.get("content-length") || "");
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return {
      ok: false,
      status: 413,
      error: "payload_too_large",
      message: "요청 본문이 너무 커요.",
    };
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    return {
      ok: false,
      status: 400,
      error: "invalid_body",
      message: "요청 본문을 읽지 못했어요.",
    };
  }

  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    return {
      ok: false,
      status: 413,
      error: "payload_too_large",
      message: "요청 본문이 너무 커요.",
    };
  }

  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {
        ok: false,
        status: 400,
        error: "invalid_json",
        message: "요청 본문이 올바르지 않아요.",
      };
    }
    return { ok: true, value: value as Record<string, unknown> };
  } catch {
    return {
      ok: false,
      status: 400,
      error: "invalid_json",
      message: "요청 본문이 올바르지 않아요.",
    };
  }
}

export function jsonError(status: number, error: string, message: string, headers?: HeadersInit) {
  return NextResponse.json({ ok: false, error, message }, { status, headers });
}

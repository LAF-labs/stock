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
  const media = requireJsonContentType(request);
  if (!media.ok) return media;

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
    text = await readTextWithLimit(request, maxBytes);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return {
        ok: false,
        status: 413,
        error: "payload_too_large",
        message: "요청 본문이 너무 커요.",
      };
    }
    return {
      ok: false,
      status: 400,
      error: "invalid_body",
      message: "요청 본문을 읽지 못했어요.",
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

export function requireJsonContentType(request: Request): JsonReadResult {
  const contentType = request.headers.get("content-type") || "";
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType === "application/json" || mediaType.endsWith("+json")) {
    return { ok: true, value: {} };
  }
  return {
    ok: false,
    status: 415,
    error: "unsupported_media_type",
    message: "JSON 요청만 지원해요.",
  };
}

export function sameOriginBrowserWriteGuard(request: Request): JsonReadResult {
  const secFetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (secFetchSite === "cross-site") {
    return {
      ok: false,
      status: 403,
      error: "cross_site_request",
      message: "교차 사이트 요청은 허용되지 않아요.",
    };
  }

  const origin = request.headers.get("origin")?.trim();
  const referer = request.headers.get("referer")?.trim();
  if (!origin) {
    if (referer && !sameOriginRequestUrl(referer, request)) return crossSiteRequest();
    return { ok: true, value: {} };
  }

  if (origin.toLowerCase() === "null") {
    return referer && sameOriginRequestUrl(referer, request) ? { ok: true, value: {} } : crossSiteRequest();
  }

  try {
    if (requestOrigins(request).has(new URL(origin).origin)) return { ok: true, value: {} };
  } catch {
    return crossSiteRequest();
  }

  return crossSiteRequest();
}

function sameOriginRequestUrl(value: string, request: Request): boolean {
  try {
    return requestOrigins(request).has(new URL(value).origin);
  } catch {
    return false;
  }
}

function requestOrigins(request: Request): Set<string> {
  const origins = new Set<string>();
  const requestUrl = new URL(request.url);
  origins.add(requestUrl.origin);

  const host = request.headers.get("host")?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim().toLowerCase();
  const protocol = forwardedProto === "https" || forwardedProto === "http" ? forwardedProto : requestUrl.protocol.replace(/:$/, "");
  if (host && protocol) origins.add(`${protocol}://${host}`);

  return origins;
}

function crossSiteRequest(): JsonReadResult {
  return {
    ok: false,
    status: 403,
    error: "cross_site_request",
    message: "교차 사이트 요청은 허용되지 않아요.",
  };
}

class PayloadTooLargeError extends Error {}

async function readTextWithLimit(request: Request, maxBytes: number): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new PayloadTooLargeError("payload too large");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

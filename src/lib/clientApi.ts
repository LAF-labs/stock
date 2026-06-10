export type ClientApiPayload = Record<string, unknown>;

export async function readClientApiPayload(response: Response): Promise<ClientApiPayload> {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error(response.ok ? "서버 응답이 비어 있어요." : `서버 응답이 비어 있어요. (HTTP ${response.status})`);
  }

  try {
    const payload = JSON.parse(text) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("non_object_payload");
    }
    return payload as ClientApiPayload;
  } catch {
    throw new Error(response.ok ? "서버 응답 형식이 올바르지 않아요." : `서버 오류 응답을 읽지 못했어요. (HTTP ${response.status})`);
  }
}

export async function apiJson<TPayload extends ClientApiPayload = ClientApiPayload>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<{ payload: TPayload; response: Response }> {
  const response = await fetch(input, init);
  const payload = await readClientApiPayload(response) as TPayload;
  return { payload, response };
}

export function apiPayloadMessage(payload: ClientApiPayload, fallback: string): string {
  return stringFromUnknown(payload.message) || stringFromUnknown(payload.error) || fallback;
}

export function stringFromUnknown(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

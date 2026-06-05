export type BoundedOutput = {
  value: string;
  truncated: boolean;
};

export function appendBoundedOutput(current: string, chunk: string | Buffer, maxBytes: number): BoundedOutput {
  const next = current + String(chunk);
  if (Buffer.byteLength(next, "utf8") <= maxBytes) {
    return { value: next, truncated: false };
  }

  let value = next;
  while (Buffer.byteLength(value, "utf8") > maxBytes) {
    value = value.slice(0, -1);
  }

  return { value, truncated: true };
}

export function subprocessErrorMessage(output: BoundedOutput, fallback: string): string {
  if (!output.value) return fallback;
  return output.truncated ? `${output.value}\n[truncated]` : output.value;
}

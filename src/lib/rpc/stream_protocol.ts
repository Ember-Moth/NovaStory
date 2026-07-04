import { isRpcErrorBody, RpcErrorCodes } from "./core";

export const RPC_STREAM_ACCEPT = "application/x-ndjson";
export const RPC_STREAM_CONTENT_TYPE = "application/x-ndjson; charset=utf-8";

export function isStreamAccept(req: { headers: { get(name: string): string | null } }): boolean {
  return req.headers.get("accept")?.includes(RPC_STREAM_ACCEPT) ?? false;
}

export function createStreamProtocolError(message: string) {
  return { code: RpcErrorCodes.STREAM_PROTOCOL_ERROR, status: 400, message };
}

export async function* readNdjsonStreamFrames(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<any> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf("\n");
      while (idx >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line.length > 0) yield JSON.parse(line);
        idx = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    const line = buffer.trim();
    if (line.length > 0) yield JSON.parse(line);
  } finally {
    reader.releaseLock();
  }
}

export function parseStreamFrame(value: unknown): any {
  if (!value || typeof value !== "object" || !("type" in value))
    throw new Error("Invalid stream frame");
  const frame = value as any;
  if (typeof frame.seq !== "number" || !Number.isInteger(frame.seq) || frame.seq < 0)
    throw new Error("Invalid stream frame seq");
  if (frame.type === "error" && !isRpcErrorBody(frame.error))
    throw new Error("Invalid error frame");
  return frame;
}

export function validateStreamSeq(expected: number, actual: number): string | undefined {
  if (actual !== expected) return `Stream seq mismatch: expected ${expected}, got ${actual}`;
  return undefined;
}

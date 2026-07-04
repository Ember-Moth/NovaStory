import { fromRpcErrorBody, isRpcErrorBody, RpcError, RpcErrorCodes, toRpcError } from "../core";

export function createRpcTransport(endpoint: string, fetchImpl: typeof fetch) {
  const pendingCalls: Array<{
    request: { key: string; input: unknown };
    resolve: (v: any) => void;
    reject: (e: any) => void;
  }> = [];
  let batchFlushScheduled = false;

  function enqueueCall(key: string, input: unknown): Promise<any> {
    return new Promise((resolve, reject) => {
      pendingCalls.push({ request: { key, input }, resolve, reject });
      if (!batchFlushScheduled) {
        batchFlushScheduled = true;
        queueMicrotask(() => {
          void flushPendingCalls();
        });
      }
    });
  }

  async function flushPendingCalls() {
    batchFlushScheduled = false;
    if (pendingCalls.length === 0) return;
    const calls = pendingCalls.splice(0, pendingCalls.length);
    try {
      const results = await dispatchBatch(calls.map((c) => c.request));
      validateBatchResponse(results, calls.length);
      for (let i = 0; i < calls.length; i++) {
        const result = results[i];
        const call = calls[i]!;
        if (result.ok) {
          call.resolve(result);
        } else {
          call.reject(
            fromRpcErrorBody(result.error, {
              procedure: call.request.key,
            }),
          );
        }
      }
    } catch (error) {
      const normalized = toRpcError(error);
      for (const call of calls) call.reject(normalized);
    }
  }

  async function dispatchBatch(batch: { key: string; input: unknown }[]): Promise<any[]> {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(batch),
    });
    if (!response.ok) throw await readRpcError(response);
    return (await response.json()) as any[];
  }

  return { enqueueCall };
}

async function readRpcError(response: Response): Promise<RpcError> {
  try {
    const body = (await response.json()) as any;
    if (isRpcErrorBody(body.error)) return fromRpcErrorBody(body.error);
    if (typeof body.error === "string")
      return toRpcError(new Error(body.error), {
        defaultStatus: response.status,
      });
  } catch {
    /* fall through */
  }
  return new RpcError({
    code: RpcErrorCodes.HTTP_ERROR,
    status: response.status,
    message: `Request failed with status ${response.status}`,
  });
}

function validateBatchResponse(results: any[], expectedLength: number): void {
  if (!Array.isArray(results)) throw new Error("Invalid RPC batch response");
  if (results.length !== expectedLength) throw new Error("RPC batch response length mismatch");
  for (const result of results) {
    if (!isBatchResponseItem(result)) throw new Error("Invalid RPC batch response item");
  }
}

function isBatchResponseItem(value: unknown): boolean {
  if (!value || typeof value !== "object" || !("ok" in value)) return false;
  if ((value as any).ok === true) return true;
  return (value as any).ok === false && "error" in value && isRpcErrorBody((value as any).error);
}

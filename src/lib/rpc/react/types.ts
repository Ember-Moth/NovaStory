export const skipToken = Symbol("rpc.skipToken");
export type SkipToken = typeof skipToken;
export type QueryStatus = "idle" | "pending" | "success" | "error";
export type QueryFetchStatus = "idle" | "fetching" | "paused";
export type MutationStatus = "idle" | "pending" | "success" | "error";
export type StreamMutationStatus = "idle" | "streaming" | "success" | "error" | "aborted";
export type TaskStatus =
  | "idle"
  | "starting"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "disconnected"
  | "reconnecting";
export type SubscriptionStatus = "idle" | "connecting" | "running" | "completed" | "error";
export type UseQueryRefetchTrigger = boolean | "always";
export type UseQueryRetry = boolean | number | ((failureCount: number, error: Error) => boolean);
export type RpcFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface RpcClientOptions {
  endpoint?: string;
  fetch?: RpcFetch;
  queryCacheTime?: number;
}

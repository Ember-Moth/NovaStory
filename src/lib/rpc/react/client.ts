import { QueryCache } from "./query_cache";
import { createQueryController } from "./query_controller";
import { normalizeQueryCacheTime } from "./query_utils";
import { createRpcTransport } from "./transport";
import type { RpcClientOptions } from "./types";
import { createUseMutation } from "./use_mutation";
import { createUseQuery } from "./use_query";

export interface UseQueryResult<T = any> {
  data: T;
  error: Error | null;
  isLoading: boolean;
  isSkipped: boolean;
  isPreviousData: boolean;
  isFetching: boolean;
  isInitialLoading: boolean;
  isRefetching: boolean;
  hasData: boolean;
  isStale: boolean;
  dataUpdatedAt: number;
  errorUpdatedAt: number;
  status: "idle" | "pending" | "success" | "error";
  fetchStatus: "idle" | "fetching";
  refetch: () => Promise<void>;
}

export interface UseMutationResult<T = any> {
  data: T;
  error: Error | null;
  isPending: boolean;
  variables: unknown;
  submittedAt: number;
  failureCount: number;
  status: "idle" | "pending" | "success" | "error";
  reset: () => void;
  mutate: (input: unknown, options?: any) => Promise<T>;
  mutateAsync: (input: unknown, options?: any) => Promise<T>;
}

export interface RpcClient {
  useQuery: <T = any>(key: string, input?: unknown, options?: any) => UseQueryResult<T>;
  useMutation: <T = any>(key: string, options?: any) => UseMutationResult<T>;
  callQuery: (
    key: string,
    input: unknown,
  ) => Promise<{ data: unknown; watch?: readonly unknown[] }>;
  callMutation: (
    key: string,
    input: unknown,
  ) => Promise<{ data: unknown; invalidate?: readonly unknown[] }>;
  invalidateQueries: (keys: readonly (string | readonly unknown[])[]) => void;
  invalidateTags: (keys: readonly (string | readonly unknown[])[]) => void;
  cancelQueries: (key: string, input?: unknown) => void;
  cancelTags: (keys: readonly (string | readonly unknown[])[]) => void;
  getQueryData: (key: string, input?: unknown) => unknown;
  setQueryData: (key: string, ...args: unknown[]) => void;
  updateQueryData: (key: string, ...args: unknown[]) => unknown;
  removeQueryData: (key: string, input?: unknown) => void;
  refetchQueries: (key: string, input?: unknown) => Promise<void>;
  refetchTags: (keys: readonly (string | readonly unknown[])[]) => Promise<void>;
}

export function createRpcClient<_TApi = any>(options: RpcClientOptions = {}): RpcClient {
  const endpoint = options.endpoint ?? "/api/rpc";
  const fetchImpl = (options.fetch ?? fetch) as typeof fetch;
  const queryCacheTime = normalizeQueryCacheTime(options.queryCacheTime);
  const transport = createRpcTransport(endpoint, fetchImpl);
  const queryCache = new QueryCache(queryCacheTime);

  async function callQuery(key: string, input: unknown) {
    const result = await transport.enqueueCall(key, input);
    return { data: result.data, watch: result.watch };
  }

  async function callMutation(key: string, input: unknown) {
    const result = await transport.enqueueCall(key, input);
    return { data: result.data, invalidate: result.invalidate };
  }

  const queryController = createQueryController(queryCache, callQuery);

  const getQueryData = (key: string, ...args: any[]) => queryController.getQueryData(key, args[0]);
  const setQueryData = (key: string, ...args: any[]) => {
    if (args.length === 1) {
      queryController.setQueryData(key, undefined, args[0]);
      return;
    }
    queryController.setQueryData(key, args[0], args[1]);
  };
  const updateQueryData = (key: string, ...args: any[]) => {
    if (args.length === 1) return queryController.updateQueryData(key, undefined, args[0]);
    return queryController.updateQueryData(key, args[0], args[1]);
  };
  const removeQueryData = (key: string, ...args: any[]) =>
    queryController.removeQueryData(key, args[0]);
  const cancelQueries = (key: string, ...args: any[]) =>
    queryController.cancelQueries(key, args[0]);
  const refetchQueries = (key: string, ...args: any[]) =>
    queryController.refetchQueries(key, args[0]);

  if (typeof globalThis.addEventListener === "function") {
    globalThis.addEventListener("focus", () => {
      queryController.refetchQueriesOnWindowFocus();
    });
  }

  return {
    callMutation,
    callQuery,
    cancelQueries,
    cancelTags: queryController.cancelTags,
    getQueryData,
    invalidateQueries: queryController.invalidateQueries as RpcClient["invalidateQueries"],
    invalidateTags: queryController.invalidateTags as RpcClient["invalidateTags"],
    refetchQueries,
    refetchTags: queryController.refetchTags,
    removeQueryData,
    setQueryData,
    updateQueryData,
    useMutation: createUseMutation(
      callMutation,
      queryController.invalidateQueries as (
        keys: readonly (string | readonly unknown[])[] | undefined,
      ) => void,
    ) as RpcClient["useMutation"],
    useQuery: createUseQuery(queryCache, queryController, queryCacheTime) as RpcClient["useQuery"],
  };
}

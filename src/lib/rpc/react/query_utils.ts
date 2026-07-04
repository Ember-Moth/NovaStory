export const DEFAULT_QUERY_CACHE_TIME = 5 * 60 * 1000;

export function buildCacheKey(path: string, input: unknown): string {
  return JSON.stringify([path, input === undefined ? ["undefined"] : ["json", input]]);
}

export function normalizeQueryCacheTime(value: number | undefined): number {
  if (value === undefined) return DEFAULT_QUERY_CACHE_TIME;
  if (!Number.isFinite(value))
    return value === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : DEFAULT_QUERY_CACHE_TIME;
  return Math.max(0, value);
}

export function normalizeQueryStaleTime(value: number | undefined): number {
  if (value === undefined) return Number.POSITIVE_INFINITY;
  if (value === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

export function isQueryEntryFresh(entry: { dataUpdatedAt: number }, staleTime: number): boolean {
  if (staleTime === Number.POSITIVE_INFINITY) return true;
  return Date.now() - entry.dataUpdatedAt <= staleTime;
}

export function shouldRetryQuery(
  retry: boolean | number | ((failureCount: number, error: Error) => boolean),
  failureCount: number,
  error: Error,
): boolean {
  if (typeof retry === "function") return retry(failureCount, error);
  if (retry === true) return failureCount <= 3;
  if (typeof retry === "number")
    return Number.isFinite(retry) && failureCount <= Math.max(0, retry);
  return false;
}

export function selectQueryData<T, U>(data: T, select?: (data: T) => U): T | U {
  return select ? select(data) : data;
}

export function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  (timer as any).unref?.();
}

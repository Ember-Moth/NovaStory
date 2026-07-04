import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { QueryCache } from "./query_cache";
import {
  buildCacheKey,
  isQueryEntryFresh,
  normalizeQueryCacheTime,
  normalizeQueryStaleTime,
  selectQueryData,
} from "./query_utils";
import { skipToken } from "./types";

export function createUseQuery(cache: QueryCache, controller: any, queryCacheTime: number) {
  return function useQuery(key: string, ...args: any[]) {
    const rawInput = args[0];
    const options = args[1];
    const enabled = options?.enabled ?? true;
    const keepPreviousData = options?.keepPreviousData ?? true;
    const staleTime = normalizeQueryStaleTime(options?.staleTime);
    const cacheTime =
      options?.cacheTime === undefined
        ? queryCacheTime
        : normalizeQueryCacheTime(options.cacheTime);
    const refetchOnMount = options?.refetchOnMount ?? true;
    const refetchOnWindowFocus = options?.refetchOnWindowFocus ?? false;
    const retry = options?.retry;
    const isSkipped = rawInput === skipToken;
    const input = rawInput;
    const previousDataRef = useRef<{
      hasData: boolean;
      data?: unknown;
      dataUpdatedAt: number;
    }>({
      hasData: false,
      dataUpdatedAt: 0,
    });
    const cacheKey = useMemo(
      () => (isSkipped ? null : buildCacheKey(key, input)),
      [input, isSkipped, key],
    );
    useSyncExternalStore(
      useCallback(
        (listener) => (cacheKey ? cache.subscribeQuery(cacheKey, listener) : () => undefined),
        [cacheKey],
      ),
      useCallback(() => (cacheKey ? cache.getQueryRevision(cacheKey) : 0), [cacheKey]),
      useCallback(() => (cacheKey ? cache.getQueryRevision(cacheKey) : 0), [cacheKey]),
    );
    const entry = cacheKey ? cache.get(cacheKey) : undefined;
    const hasCurrentData = entry?.hasData ?? false;
    const canUsePreviousData = Boolean(
      cacheKey &&
        keepPreviousData &&
        !hasCurrentData &&
        !entry?.isRemoved &&
        previousDataRef.current.hasData,
    );
    const hasPlaceholderData = Boolean(
      cacheKey && !hasCurrentData && !canUsePreviousData && options && "placeholderData" in options,
    );
    const isPreviousData = canUsePreviousData;
    const dataUpdatedAt = hasCurrentData
      ? (entry?.dataUpdatedAt ?? 0)
      : isPreviousData
        ? previousDataRef.current.dataUpdatedAt
        : 0;
    const selectedDataRef = useRef<any>({
      cacheKey: null,
      revision: -1,
      source: "empty",
    });
    let data: any;
    const currentSource = hasCurrentData
      ? "current"
      : isPreviousData
        ? "previous"
        : hasPlaceholderData
          ? "placeholder"
          : "empty";
    const currentRevision = hasCurrentData ? (entry?.revision ?? 0) : dataUpdatedAt;
    if (
      selectedDataRef.current.cacheKey === cacheKey &&
      selectedDataRef.current.revision === currentRevision &&
      selectedDataRef.current.source === currentSource &&
      selectedDataRef.current.select === options?.select
    ) {
      data = selectedDataRef.current.value;
    } else {
      data = hasCurrentData
        ? selectQueryData(entry?.data, options?.select)
        : isPreviousData
          ? selectQueryData(previousDataRef.current.data, options?.select)
          : hasPlaceholderData
            ? options?.placeholderData
            : undefined;
      selectedDataRef.current = {
        cacheKey,
        revision: currentRevision,
        source: currentSource,
        select: options?.select,
        value: data,
      };
    }
    const hasData = Boolean(hasCurrentData || isPreviousData || hasPlaceholderData);
    const error = entry?.error ?? null;
    const errorUpdatedAt = error ? (entry?.errorUpdatedAt ?? 0) : 0;
    const isFetching = Boolean(entry?.promise);
    const isLoading = Boolean(cacheKey && ((enabled && !entry) || isFetching));
    const isInitialLoading = Boolean(isFetching && !hasData);
    const isRefetching = Boolean(isFetching && hasCurrentData);
    const isStale = Boolean(entry && (entry.stale || !isQueryEntryFresh(entry, staleTime)));
    const shouldRefetchExistingOnMount = Boolean(
      entry?.hasData &&
        !entry.promise &&
        (refetchOnMount === "always" ||
          (refetchOnMount !== false && !isQueryEntryFresh(entry, staleTime))),
    );
    const needsAutoFetch = Boolean(
      cacheKey &&
        enabled &&
        (!entry ||
          entry.stale ||
          shouldRefetchExistingOnMount ||
          (!entry.isRemoved && !entry.hasData && !entry.promise)),
    );
    const status =
      !cacheKey || (!enabled && !hasData && !error && !isFetching)
        ? "idle"
        : error
          ? "error"
          : hasData
            ? "success"
            : "pending";
    const fetchStatus = isFetching ? "fetching" : "idle";
    const fetchOptions = useMemo(() => ({ staleTime, retry }), [retry, staleTime]);
    useEffect(() => {
      if (!cacheKey) return;
      cache.retain(cacheKey, {
        cacheTime,
        queryKey: key,
        input,
        staleTime,
        retry,
        refetchOnWindowFocus,
      } as any);
      return () => {
        cache.release(cacheKey);
      };
    }, [cacheKey, cacheTime, input, key, refetchOnWindowFocus, retry, staleTime]);
    useEffect(() => {
      if (!cacheKey || !needsAutoFetch) return;
      void controller.ensureQueryData(key, input, cacheKey, fetchOptions);
    }, [cacheKey, fetchOptions, input, key, needsAutoFetch]);
    useEffect(() => {
      if (!cacheKey || !hasCurrentData) return;
      previousDataRef.current = {
        data: entry?.data,
        hasData: true,
        dataUpdatedAt: entry?.dataUpdatedAt ?? 0,
      };
    }, [cacheKey, entry?.data, entry?.dataUpdatedAt, hasCurrentData]);
    const refetch = useCallback(async () => {
      if (!cacheKey) return;
      const current = cache.get(cacheKey);
      if (current && !current.stale) {
        cache.set(cacheKey, {
          ...current,
          stale: true,
          staleVersion: current.staleVersion + 1,
        });
        cache.emitQueryChange([cacheKey], current.watch);
      }
      await controller.ensureQueryData(key, input, cacheKey, fetchOptions);
    }, [cacheKey, fetchOptions, input, key]);
    return useMemo(
      () => ({
        data,
        error,
        isLoading,
        isSkipped,
        isPreviousData,
        isFetching,
        isInitialLoading,
        isRefetching,
        hasData,
        isStale,
        dataUpdatedAt,
        errorUpdatedAt,
        status,
        fetchStatus,
        refetch,
      }),
      [
        data,
        error,
        isLoading,
        isSkipped,
        isPreviousData,
        isFetching,
        isInitialLoading,
        isRefetching,
        hasData,
        isStale,
        dataUpdatedAt,
        errorUpdatedAt,
        status,
        fetchStatus,
        refetch,
      ],
    );
  };
}

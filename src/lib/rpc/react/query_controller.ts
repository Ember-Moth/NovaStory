import { toRpcError } from "../core";
import type { QueryCache } from "./query_cache";
import { buildCacheKey, isQueryEntryFresh, shouldRetryQuery } from "./query_utils";

export function createQueryController(
  cache: QueryCache,
  callQuery: (
    key: string,
    input: unknown,
  ) => Promise<{
    data: unknown;
    watch?: readonly (string | readonly unknown[])[];
  }>,
) {
  async function callQueryWithRetry(key: string, input: unknown, retry: any) {
    let failureCount = 0;
    for (;;) {
      try {
        return await callQuery(key, input);
      } catch (error) {
        const normalized = toRpcError(error);
        failureCount += 1;
        if (!shouldRetryQuery(retry, failureCount, normalized)) throw normalized;
        await Promise.resolve();
      }
    }
  }

  function ensureQueryData(
    key: string,
    input: unknown,
    cacheKey: string,
    options: { staleTime: number; retry?: any },
  ): Promise<unknown> | undefined {
    const existing = cache.get(cacheKey);
    if (
      existing?.hasData &&
      !existing.promise &&
      existing.error === undefined &&
      !existing.stale &&
      isQueryEntryFresh(existing, options.staleTime)
    )
      return;
    if (existing?.promise) return existing.promise;
    const loadStaleVersion = existing?.staleVersion ?? 0;
    const loadPromise = callQueryWithRetry(key, input, options.retry)
      .then((result) => {
        const current = cache.get(cacheKey);
        if (current?.promise !== loadPromise) return;
        const currentStaleVersion = current?.staleVersion ?? loadStaleVersion;
        const isStillStale = currentStaleVersion !== loadStaleVersion;
        cache.set(cacheKey, {
          data: result.data,
          error: undefined,
          hasData: true,
          promise: undefined,
          watch: result.watch,
          stale: isStillStale,
          staleVersion: currentStaleVersion,
          dataUpdatedAt: Date.now(),
          errorUpdatedAt: 0,
          queryKey: key,
          input,
          staleTime: options.staleTime,
          retry: options.retry,
        });
        cache.emitQueryChange([cacheKey], result.watch);
        if (isStillStale) void ensureQueryData(key, input, cacheKey, options);
      })
      .catch((error) => {
        const current = cache.get(cacheKey);
        if (current?.promise !== loadPromise) return;
        cache.set(cacheKey, {
          data: existing?.data,
          error: toRpcError(error),
          hasData: existing?.hasData ?? false,
          promise: undefined,
          watch: existing?.watch,
          stale: existing?.stale ?? false,
          staleVersion: existing?.staleVersion ?? 0,
          dataUpdatedAt: existing?.dataUpdatedAt ?? 0,
          errorUpdatedAt: Date.now(),
          queryKey: key,
          input,
          staleTime: options.staleTime,
          retry: options.retry,
        });
        cache.emitQueryChange([cacheKey], existing?.watch);
      });
    cache.set(cacheKey, {
      data: existing?.data,
      error: undefined,
      hasData: existing?.hasData ?? false,
      promise: loadPromise,
      watch: existing?.watch,
      stale: existing?.stale ?? false,
      staleVersion: existing?.staleVersion ?? 0,
      dataUpdatedAt: existing?.dataUpdatedAt ?? 0,
      errorUpdatedAt: 0,
      queryKey: key,
      input,
      staleTime: options.staleTime,
      retry: options.retry,
    });
    cache.emitQueryChange([cacheKey], existing?.watch);
    return loadPromise;
  }

  function invalidateQueries(keys: readonly (string | readonly unknown[])[]) {
    const affected = cache.invalidate(keys);
    if (affected.length > 0) cache.emitQueryChange(affected, keys);
  }

  function getQueryData(key: string, input: unknown) {
    const entry = cache.get(buildCacheKey(key, input));
    return entry?.hasData ? entry.data : undefined;
  }

  function setQueryData(key: string, input: unknown, data: unknown) {
    const cacheKey = buildCacheKey(key, input);
    setQueryEntryData(cacheKey, key, input, data);
    cache.emitQueryChange([cacheKey]);
  }

  function updateQueryData(key: string, input: unknown, updater: (data: unknown) => unknown) {
    const cacheKey = buildCacheKey(key, input);
    const entry = cache.get(cacheKey);
    if (!entry?.hasData) return undefined;
    const data = updater(entry.data);
    setQueryEntryData(cacheKey, key, input, data);
    cache.emitQueryChange([cacheKey]);
    return data;
  }

  function removeQueryData(key: string, input: unknown) {
    const cacheKey = buildCacheKey(key, input);
    const entry = cache.get(cacheKey);
    if (!entry) return;
    if (entry.subscriberCount > 0) {
      cache.set(cacheKey, {
        data: undefined,
        error: undefined,
        hasData: false,
        promise: undefined,
        watch: entry.watch,
        stale: false,
        staleVersion: entry.staleVersion + 1,
        dataUpdatedAt: 0,
        errorUpdatedAt: 0,
        queryKey: key,
        input,
        staleTime: entry.staleTime,
        retry: entry.retry,
        refetchOnWindowFocus: entry.refetchOnWindowFocus,
      });
    } else {
      cache.delete(cacheKey);
    }
    cache.emitQueryChange([cacheKey], entry.watch);
  }

  function cancelQueries(key: string, input: unknown) {
    cancelCacheKeys([buildCacheKey(key, input)]);
  }

  async function refetchQueries(key: string, input: unknown) {
    await refetchCacheKey(buildCacheKey(key, input), key, input);
  }

  function cancelTags(keys: readonly (string | readonly unknown[])[]) {
    cancelCacheKeys(cache.getCacheKeysByWatchKeys(keys));
  }

  async function refetchTags(keys: readonly (string | readonly unknown[])[]) {
    await Promise.all(
      [...cache.getCacheKeysByWatchKeys(keys)].map((k) => refetchExistingCacheKey(k)),
    );
  }

  function setQueryEntryData(cacheKey: string, key: string, input: unknown, data: unknown) {
    const entry = cache.get(cacheKey);
    cache.set(cacheKey, {
      data,
      error: undefined,
      hasData: true,
      promise: entry?.promise,
      watch: entry?.watch,
      stale: false,
      staleVersion: entry?.staleVersion ?? 0,
      dataUpdatedAt: Date.now(),
      errorUpdatedAt: 0,
      queryKey: key,
      input,
      staleTime: entry?.staleTime,
      retry: entry?.retry,
      refetchOnWindowFocus: entry?.refetchOnWindowFocus,
    });
  }

  function cancelCacheKeys(cacheKeys: Iterable<string>) {
    let changed = false;
    for (const cacheKey of cacheKeys) {
      const entry = cache.get(cacheKey);
      if (!entry?.promise) continue;
      cache.set(cacheKey, {
        ...entry,
        promise: undefined,
        staleVersion: entry.staleVersion + 1,
      });
      changed = true;
    }
    if (changed) cache.emitQueryChange([...cacheKeys] as string[]);
  }

  function refetchExistingCacheKey(cacheKey: string) {
    const entry = cache.get(cacheKey);
    if (!entry?.queryKey) return;
    return refetchCacheKey(cacheKey, entry.queryKey, entry.input, entry);
  }

  function refetchCacheKey(
    cacheKey: string,
    key: string,
    input: unknown,
    entry = cache.get(cacheKey),
  ) {
    if (entry && !entry.stale) {
      cache.set(cacheKey, {
        ...entry,
        stale: true,
        staleVersion: entry.staleVersion + 1,
      });
      cache.emitQueryChange([cacheKey], entry.watch);
    }
    return ensureQueryData(key, input, cacheKey, {
      staleTime: entry?.staleTime ?? Number.POSITIVE_INFINITY,
      retry: entry?.retry,
    });
  }

  function refetchQueriesOnWindowFocus() {
    for (const [cacheKey, entry] of cache.entries) {
      if (
        entry.subscriberCount === 0 ||
        entry.promise ||
        !entry.queryKey ||
        !entry.refetchOnWindowFocus
      )
        continue;
      const staleTime = entry.staleTime ?? Number.POSITIVE_INFINITY;
      const shouldRefetch =
        entry.refetchOnWindowFocus === "always" ||
        entry.stale ||
        !entry.hasData ||
        !isQueryEntryFresh(entry, staleTime);
      if (!shouldRefetch) continue;
      void ensureQueryData(entry.queryKey, entry.input, cacheKey, {
        staleTime,
        retry: entry.retry,
      });
    }
  }

  return {
    ensureQueryData,
    invalidateQueries,
    invalidateTags: invalidateQueries,
    getQueryData,
    setQueryData,
    updateQueryData,
    removeQueryData,
    cancelQueries,
    refetchQueries,
    cancelTags,
    refetchTags,
    refetchQueriesOnWindowFocus,
  };
}

import { serializeTagKey } from "../core";
import { unrefTimer } from "./query_utils";

export interface QueryCacheEntry {
  hasData: boolean;
  data?: unknown;
  error?: unknown;
  staleVersion: number;
  stale?: boolean;
  isRemoved?: boolean;
  dataUpdatedAt: number;
  errorUpdatedAt: number;
  subscriberCount: number;
  cacheTime?: number;
  queryKey?: string;
  input?: unknown;
  staleTime?: number;
  retry?: any;
  refetchOnWindowFocus?: any;
  promise?: Promise<unknown>;
  gcTimer?: ReturnType<typeof setTimeout>;
  watch?: readonly (string | readonly unknown[])[];
  revision: number;
}

export class QueryCache {
  defaultCacheTime: number;
  entries = new Map<string, QueryCacheEntry>();
  queryListeners = new Map<string, Set<() => void>>();
  tagListeners = new Map<string, Set<() => void>>();
  watchIndex = new Map<string, Set<string>>();
  revisions = new Map<string, number>();

  constructor(defaultCacheTime: number) {
    this.defaultCacheTime = defaultCacheTime;
  }

  emitQueryChange(cacheKeys: string[], watches?: readonly (string | readonly unknown[])[]): void {
    const notifiedQueries = new Set<() => void>();
    for (const cacheKey of cacheKeys) {
      this.bumpRevision(cacheKey);
      const listeners = this.queryListeners.get(cacheKey);
      if (!listeners) continue;
      for (const listener of listeners) notifiedQueries.add(listener);
    }
    for (const listener of notifiedQueries) listener();
    if (!watches) return;
    const notifiedTags = new Set<() => void>();
    for (const watch of watches) {
      const listeners = this.tagListeners.get(serializeTagKey(watch));
      if (!listeners) continue;
      for (const listener of listeners) notifiedTags.add(listener);
    }
    for (const listener of notifiedTags) listener();
  }

  subscribeQuery = (cacheKey: string, listener: () => void): (() => void) => {
    let listeners = this.queryListeners.get(cacheKey);
    if (!listeners) {
      listeners = new Set();
      this.queryListeners.set(cacheKey, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners!.delete(listener);
      if (listeners!.size === 0) this.queryListeners.delete(cacheKey);
    };
  };

  observeTags = (
    keys: readonly (string | readonly unknown[])[] | undefined,
    listener: () => void,
  ): (() => void) => {
    if (!keys || keys.length === 0) return () => undefined;
    const subscribed = new Map<string, Set<() => void>>();
    for (const key of keys) {
      const serialized = serializeTagKey(key);
      let listeners = this.tagListeners.get(serialized);
      if (!listeners) {
        listeners = new Set();
        this.tagListeners.set(serialized, listeners);
      }
      listeners.add(listener);
      subscribed.set(serialized, listeners);
    }
    return () => {
      for (const [serialized, listeners] of subscribed) {
        listeners.delete(listener);
        if (listeners.size === 0) this.tagListeners.delete(serialized);
      }
    };
  };

  getQueryRevision = (cacheKey: string): number => this.revisions.get(cacheKey) ?? 0;

  get(cacheKey: string): QueryCacheEntry | undefined {
    return this.entries.get(cacheKey);
  }

  set(cacheKey: string, entry: Partial<QueryCacheEntry>): void {
    const previous = this.entries.get(cacheKey);
    let gcTimer = entry.gcTimer ?? previous?.gcTimer;
    const subscriberCount = entry.subscriberCount ?? previous?.subscriberCount ?? 0;
    if (subscriberCount > 0 && gcTimer !== undefined) {
      clearTimeout(gcTimer);
      gcTimer = undefined;
    }
    this.removeFromWatchIndex(cacheKey, previous?.watch);
    const nextEntry: QueryCacheEntry = {
      hasData: false,
      staleVersion: 0,
      dataUpdatedAt: 0,
      errorUpdatedAt: 0,
      revision: this.revisions.get(cacheKey) ?? previous?.revision ?? 0,
      ...previous,
      ...entry,
      subscriberCount,
      gcTimer,
    };
    this.entries.set(cacheKey, nextEntry);
    this.addToWatchIndex(cacheKey, nextEntry.watch);
    this.scheduleGc(cacheKey);
  }

  delete(cacheKey: string): void {
    const entry = this.entries.get(cacheKey);
    if (!entry) return;
    if (entry.gcTimer !== undefined) clearTimeout(entry.gcTimer);
    this.removeFromWatchIndex(cacheKey, entry.watch);
    this.entries.delete(cacheKey);
  }

  getCacheKeysByWatchKeys(keys: readonly (string | readonly unknown[])[]): Set<string> {
    const cacheKeys = new Set<string>();
    if (!keys || keys.length === 0) return cacheKeys;
    for (const key of keys) {
      const entries = this.watchIndex.get(serializeTagKey(key));
      if (!entries) continue;
      for (const cacheKey of entries) cacheKeys.add(cacheKey);
    }
    return cacheKeys;
  }

  retain(
    cacheKey: string,
    options: Omit<
      QueryCacheEntry,
      | "hasData"
      | "staleVersion"
      | "dataUpdatedAt"
      | "errorUpdatedAt"
      | "subscriberCount"
      | "revision"
    >,
  ): void {
    const entry = this.entries.get(cacheKey);
    if (entry) {
      entry.subscriberCount += 1;
      Object.assign(entry, options);
      if (entry.gcTimer !== undefined) {
        clearTimeout(entry.gcTimer);
        entry.gcTimer = undefined;
      }
      return;
    }
    this.set(cacheKey, {
      hasData: false,
      staleVersion: 0,
      dataUpdatedAt: 0,
      errorUpdatedAt: 0,
      subscriberCount: 1,
      ...options,
    });
  }

  release(cacheKey: string): void {
    const entry = this.entries.get(cacheKey);
    if (!entry) return;
    entry.subscriberCount = Math.max(0, entry.subscriberCount - 1);
    this.scheduleGc(cacheKey);
  }

  invalidate(keys: readonly (string | readonly unknown[])[]): string[] {
    if (!keys || keys.length === 0) return [];
    const affected = this.getCacheKeysByWatchKeys(keys);
    if (affected.size === 0) return [];
    const changed: string[] = [];
    for (const cacheKey of affected) {
      const entry = this.entries.get(cacheKey);
      if (entry && (!entry.stale || entry.promise)) {
        this.set(cacheKey, {
          ...entry,
          stale: true,
          staleVersion: entry.staleVersion + 1,
        });
        if (!entry.stale) changed.push(cacheKey);
      }
    }
    return changed;
  }

  scheduleGc(cacheKey: string): void {
    const entry = this.entries.get(cacheKey);
    const cacheTime = entry?.cacheTime ?? this.defaultCacheTime;
    if (cacheTime === Number.POSITIVE_INFINITY) return;
    if (!entry || entry.subscriberCount > 0 || entry.promise || entry.gcTimer !== undefined) return;
    if (cacheTime === 0) {
      this.delete(cacheKey);
      return;
    }
    entry.gcTimer = setTimeout(() => {
      const current = this.entries.get(cacheKey);
      if (current && current.subscriberCount === 0 && !current.promise) this.delete(cacheKey);
    }, cacheTime);
    unrefTimer(entry.gcTimer);
  }

  private removeFromWatchIndex(
    cacheKey: string,
    watches?: readonly (string | readonly unknown[])[],
  ): void {
    if (!watches) return;
    for (const watchKey of watches) {
      const indexKey = serializeTagKey(watchKey);
      const entries = this.watchIndex.get(indexKey);
      if (!entries) continue;
      entries.delete(cacheKey);
      if (entries.size === 0) this.watchIndex.delete(indexKey);
    }
  }

  private addToWatchIndex(
    cacheKey: string,
    watches?: readonly (string | readonly unknown[])[],
  ): void {
    if (!watches) return;
    for (const watchKey of watches) {
      const indexKey = serializeTagKey(watchKey);
      let entries = this.watchIndex.get(indexKey);
      if (!entries) {
        entries = new Set();
        this.watchIndex.set(indexKey, entries);
      }
      entries.add(cacheKey);
    }
  }

  private bumpRevision(cacheKey: string): void {
    const revision = (this.revisions.get(cacheKey) ?? 0) + 1;
    this.revisions.set(cacheKey, revision);
    const entry = this.entries.get(cacheKey);
    if (entry) entry.revision = revision;
  }
}

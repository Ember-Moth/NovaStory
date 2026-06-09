import { eq } from "drizzle-orm";

import { db, schema } from "@/db";

export interface GlobalConfigOption {
  key: string;
  valueJson: string;
  createdAt: number;
  updatedAt: number;
}

function normalizeConfigKey(key: string): string {
  const normalized = key.trim();
  if (!normalized) {
    throw new Error("Global config key must not be empty");
  }
  return normalized;
}

function stringifyGlobalConfigValue(value: unknown): string {
  const valueJson = JSON.stringify(value);
  if (valueJson === undefined) {
    throw new Error("Global config value must be JSON serializable");
  }
  return valueJson;
}

export function getGlobalConfig<T>(key: string, fallback: T): T {
  const normalizedKey = key.trim();
  if (!normalizedKey) return fallback;

  const row = db
    .select({ valueJson: schema.globalConfigOptions.valueJson })
    .from(schema.globalConfigOptions)
    .where(eq(schema.globalConfigOptions.key, normalizedKey))
    .get();

  if (!row) return fallback;

  try {
    return JSON.parse(row.valueJson) as T;
  } catch {
    return fallback;
  }
}

export function setGlobalConfig(key: string, value: unknown): void {
  const normalizedKey = normalizeConfigKey(key);
  const valueJson = stringifyGlobalConfigValue(value);
  const timestamp = Date.now();

  db.insert(schema.globalConfigOptions)
    .values({
      key: normalizedKey,
      valueJson,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoUpdate({
      target: schema.globalConfigOptions.key,
      set: {
        valueJson,
        updatedAt: timestamp,
      },
    })
    .run();
}

export function deleteGlobalConfig(key: string): void {
  const normalizedKey = normalizeConfigKey(key);
  db.delete(schema.globalConfigOptions)
    .where(eq(schema.globalConfigOptions.key, normalizedKey))
    .run();
}

export function listGlobalConfigOptions(): GlobalConfigOption[] {
  return db
    .select({
      key: schema.globalConfigOptions.key,
      valueJson: schema.globalConfigOptions.valueJson,
      createdAt: schema.globalConfigOptions.createdAt,
      updatedAt: schema.globalConfigOptions.updatedAt,
    })
    .from(schema.globalConfigOptions)
    .orderBy(schema.globalConfigOptions.key)
    .all();
}

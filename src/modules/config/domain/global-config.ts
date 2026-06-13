import { createJsonFileStore } from "@/shared/lib/json-file-store";
import { getConfigFilePath } from "@/shared/lib/storage-paths";

export interface GlobalConfigOption {
  key: string;
  valueJson: string;
  createdAt: number;
  updatedAt: number;
}

interface GlobalConfigFile {
  options: GlobalConfigOption[];
}

const globalConfigStore = createJsonFileStore<GlobalConfigFile>(
  () => getConfigFilePath("global.json"),
  () => ({ options: [] }),
);

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

  const row = globalConfigStore.read().options.find((option) => option.key === normalizedKey);

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

  globalConfigStore.update((file) => {
    const existing = file.options.find((option) => option.key === normalizedKey);
    if (existing) {
      return {
        options: file.options.map((option) =>
          option.key === normalizedKey ? { ...option, valueJson, updatedAt: timestamp } : option,
        ),
      };
    }

    return {
      options: [
        ...file.options,
        {
          key: normalizedKey,
          valueJson,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    };
  });
}

export function deleteGlobalConfig(key: string): void {
  const normalizedKey = normalizeConfigKey(key);
  globalConfigStore.update((file) => ({
    options: file.options.filter((option) => option.key !== normalizedKey),
  }));
}

export function listGlobalConfigOptions(): GlobalConfigOption[] {
  return [...globalConfigStore.read().options].sort((a, b) => a.key.localeCompare(b.key));
}

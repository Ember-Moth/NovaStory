import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import { invariant, now } from "@/shared/lib/domain";
import {
  getCatalogDir,
  getCatalogModelDir,
  getCatalogModelPath,
  getCatalogProviderDir,
  getCatalogProviderPath,
  getCatalogRegistryStatePath,
} from "@/shared/lib/storage-paths";

// === Row types (de-drizzled, mirror the original SQLite columns) ===

export const AI_REGISTRY_STATE_ID = "models.dev";

export interface AiRegistryStateRow {
  id: string;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  contentHash: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AiRegistryProviderRow {
  id: string;
  name: string;
  sdkPackage: string | null;
  apiUrl: string | null;
  docsUrl: string | null;
  envKeysJson: string;
  rawJson: string;
  isActive: boolean;
  lastSeenAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface AiRegistryModelRow {
  id: string;
  providerId: string;
  modelId: string;
  displayName: string;
  family: string | null;
  inputModalitiesJson: string;
  outputModalitiesJson: string;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  supportsVision: boolean;
  supportsToolUse: boolean;
  supportsReasoning: boolean;
  supportsTemperature: boolean;
  inputPricePer1m: number | null;
  outputPricePer1m: number | null;
  costJson: string | null;
  rawJson: string;
  isActive: boolean;
  lastSeenAt: number;
  createdAt: number;
  updatedAt: number;
}

// === Atomic write helpers ===

function ensureParent(filepath: string) {
  mkdirSync(dirname(filepath), { recursive: true });
}

function readJsonFile<T>(filepath: string): T {
  const raw = readFileSync(filepath, "utf8");
  return JSON.parse(raw) as T;
}

function atomicWriteJson(filepath: string, value: unknown) {
  ensureParent(filepath);
  const json = `${JSON.stringify(value, null, 2)}\n`;
  const tempPath = `${filepath}.${Date.now()}-${Math.random().toString(36).slice(2, 8)}.tmp`;
  writeFileSync(tempPath, json, "utf8");
  renameSync(tempPath, filepath);
}

function tryUnlink(filepath: string) {
  try {
    if (existsSync(filepath)) unlinkSync(filepath);
  } catch {
    // ignore: file may have been removed concurrently
  }
}

function listJsonFiles(dir: string) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter(
      (entry) => entry.isFile() && entry.name.endsWith(".json") && !entry.name.endsWith(".tmp"),
    )
    .map((entry) => entry.name);
}

// === Registry state ===

export function readRegistryState(): AiRegistryStateRow | null {
  const filepath = getCatalogRegistryStatePath();
  if (!existsSync(filepath)) return null;
  return readJsonFile<AiRegistryStateRow>(filepath);
}

export function writeRegistryState(
  patch: Partial<Omit<AiRegistryStateRow, "id" | "createdAt" | "updatedAt">>,
): AiRegistryStateRow {
  const filepath = getCatalogRegistryStatePath();
  const existing = readRegistryState();
  const timestamp = now();
  const next: AiRegistryStateRow = {
    id: existing?.id ?? AI_REGISTRY_STATE_ID,
    lastAttemptAt: patch.lastAttemptAt ?? existing?.lastAttemptAt ?? null,
    lastSuccessAt: patch.lastSuccessAt ?? existing?.lastSuccessAt ?? null,
    lastError: patch.lastError !== undefined ? patch.lastError : (existing?.lastError ?? null),
    contentHash:
      patch.contentHash !== undefined ? patch.contentHash : (existing?.contentHash ?? null),
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  atomicWriteJson(filepath, next);
  return next;
}

// === Providers ===

export function listProviders(): AiRegistryProviderRow[] {
  const dir = getCatalogProviderDir();
  const result: AiRegistryProviderRow[] = [];
  for (const filename of listJsonFiles(dir)) {
    const filepath = `${dir}/${filename}`;
    try {
      result.push(readJsonFile<AiRegistryProviderRow>(filepath));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[catalog-file-store] skipping invalid provider file ${filepath}: ${message}`);
    }
  }
  return result;
}

export function getProvider(providerId: string): AiRegistryProviderRow | null {
  const filepath = getCatalogProviderPath(providerId);
  if (!existsSync(filepath)) return null;
  try {
    return readJsonFile<AiRegistryProviderRow>(filepath);
  } catch {
    return null;
  }
}

export function upsertProvider(
  patch: Pick<AiRegistryProviderRow, "id"> & Partial<AiRegistryProviderRow>,
): AiRegistryProviderRow {
  const filepath = getCatalogProviderPath(patch.id);
  const existing = existsSync(filepath) ? readJsonFile<AiRegistryProviderRow>(filepath) : null;
  const timestamp = now();
  const next: AiRegistryProviderRow = {
    id: patch.id,
    name: patch.name ?? existing?.name ?? patch.id,
    sdkPackage: patch.sdkPackage !== undefined ? patch.sdkPackage : (existing?.sdkPackage ?? null),
    apiUrl: patch.apiUrl !== undefined ? patch.apiUrl : (existing?.apiUrl ?? null),
    docsUrl: patch.docsUrl !== undefined ? patch.docsUrl : (existing?.docsUrl ?? null),
    envKeysJson: patch.envKeysJson ?? existing?.envKeysJson ?? "[]",
    rawJson: patch.rawJson ?? existing?.rawJson ?? "{}",
    isActive: patch.isActive ?? existing?.isActive ?? true,
    lastSeenAt: patch.lastSeenAt ?? existing?.lastSeenAt ?? timestamp,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  atomicWriteJson(filepath, next);
  return next;
}

export function markAllProvidersInactive(): number {
  let updated = 0;
  for (const row of listProviders()) {
    if (row.isActive) {
      atomicWriteJson(getCatalogProviderPath(row.id), {
        ...row,
        isActive: false,
        updatedAt: now(),
      });
      updated += 1;
    }
  }
  return updated;
}

export function deleteProvider(providerId: string) {
  tryUnlink(getCatalogProviderPath(providerId));
}

// === Models ===

export function listModels(): AiRegistryModelRow[] {
  const dir = getCatalogModelDir();
  const result: AiRegistryModelRow[] = [];
  for (const filename of listJsonFiles(dir)) {
    const filepath = `${dir}/${filename}`;
    try {
      result.push(readJsonFile<AiRegistryModelRow>(filepath));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[catalog-file-store] skipping invalid model file ${filepath}: ${message}`);
    }
  }
  return result;
}

export function getModel(modelId: string): AiRegistryModelRow | null {
  const filepath = getCatalogModelPath(modelId);
  if (!existsSync(filepath)) return null;
  try {
    return readJsonFile<AiRegistryModelRow>(filepath);
  } catch {
    return null;
  }
}

export function listModelsByProvider(
  providerId: string,
  { activeOnly = false }: { activeOnly?: boolean } = {},
): AiRegistryModelRow[] {
  return listModels().filter((row) => {
    if (row.providerId !== providerId) return false;
    if (activeOnly && !row.isActive) return false;
    return true;
  });
}

export function findModelByProviderAndModelId(
  providerId: string,
  modelId: string,
  { activeOnly = false }: { activeOnly?: boolean } = {},
): AiRegistryModelRow | null {
  const filepath = getCatalogModelPath(`${providerId}:${modelId}`);
  if (!existsSync(filepath)) return null;
  try {
    const row = readJsonFile<AiRegistryModelRow>(filepath);
    if (row.providerId !== providerId || row.modelId !== modelId) return null;
    if (activeOnly && !row.isActive) return null;
    return row;
  } catch {
    return null;
  }
}

export function upsertModel(
  patch: Pick<AiRegistryModelRow, "id"> & Partial<AiRegistryModelRow>,
): AiRegistryModelRow {
  const filepath = getCatalogModelPath(patch.id);
  const existing = existsSync(filepath) ? readJsonFile<AiRegistryModelRow>(filepath) : null;
  const timestamp = now();
  const next: AiRegistryModelRow = {
    id: patch.id,
    providerId: patch.providerId ?? existing?.providerId ?? "",
    modelId: patch.modelId ?? existing?.modelId ?? "",
    displayName: patch.displayName ?? existing?.displayName ?? patch.id,
    family: patch.family !== undefined ? patch.family : (existing?.family ?? null),
    inputModalitiesJson: patch.inputModalitiesJson ?? existing?.inputModalitiesJson ?? "[]",
    outputModalitiesJson: patch.outputModalitiesJson ?? existing?.outputModalitiesJson ?? "[]",
    contextWindow:
      patch.contextWindow !== undefined ? patch.contextWindow : (existing?.contextWindow ?? null),
    maxOutputTokens:
      patch.maxOutputTokens !== undefined
        ? patch.maxOutputTokens
        : (existing?.maxOutputTokens ?? null),
    supportsVision: patch.supportsVision ?? existing?.supportsVision ?? false,
    supportsToolUse: patch.supportsToolUse ?? existing?.supportsToolUse ?? false,
    supportsReasoning: patch.supportsReasoning ?? existing?.supportsReasoning ?? false,
    supportsTemperature: patch.supportsTemperature ?? existing?.supportsTemperature ?? false,
    inputPricePer1m:
      patch.inputPricePer1m !== undefined
        ? patch.inputPricePer1m
        : (existing?.inputPricePer1m ?? null),
    outputPricePer1m:
      patch.outputPricePer1m !== undefined
        ? patch.outputPricePer1m
        : (existing?.outputPricePer1m ?? null),
    costJson: patch.costJson !== undefined ? patch.costJson : (existing?.costJson ?? null),
    rawJson: patch.rawJson ?? existing?.rawJson ?? "{}",
    isActive: patch.isActive ?? existing?.isActive ?? true,
    lastSeenAt: patch.lastSeenAt ?? existing?.lastSeenAt ?? timestamp,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  atomicWriteJson(filepath, next);
  return next;
}

export function markAllModelsInactive(): number {
  let updated = 0;
  for (const row of listModels()) {
    if (row.isActive) {
      atomicWriteJson(getCatalogModelPath(row.id), { ...row, isActive: false, updatedAt: now() });
      updated += 1;
    }
  }
  return updated;
}

export function deleteModel(modelId: string) {
  tryUnlink(getCatalogModelPath(modelId));
}

// === Mutex (single-process Bun) ===

let mutexChain: Promise<unknown> = Promise.resolve();

export async function runInTransaction<T>(fn: () => Promise<T> | T): Promise<T> {
  const next = mutexChain.then(async () => fn());
  // Swallow rejections on the chain so a failed call does not poison future calls.
  mutexChain = next.catch(() => undefined);
  return await next;
}

// === Snapshot of sync helpers (for tests) ===

export function clearCatalogStore() {
  // Best-effort wipe for tests; not used in production code paths.
  const dir = getCatalogDir();
  if (existsSync(dir)) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile()) {
        tryUnlink(`${dir}/${entry.name}`);
      }
    }
  }
  invariant(
    listProviders().length === 0 && listModels().length === 0 && readRegistryState() == null,
    "catalog store should be empty after clearCatalogStore()",
  );
}

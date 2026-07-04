import { createHash } from "node:crypto";

import { isSupportedAiSdkPackage } from "@/modules/ai/domain/packages";
import type {
  AiCatalogModelView,
  AiCatalogProviderView,
  AiCatalogStatusView,
  AiConnectionRow,
  AiResolvedModelView,
} from "@/modules/ai/domain/types";
import * as userConfig from "@/modules/ai/domain/user-config";
import { invariant, now } from "@/shared/lib/domain";
import {
  type AiRegistryModelRow,
  type AiRegistryProviderRow,
  findModelByProviderAndModelId,
  listModels,
  listModelsByProvider,
  listProviders,
  readRegistryState,
  runInTransaction,
  upsertModel,
  upsertProvider,
  writeRegistryState,
} from "./catalog-file-store";

const AI_REGISTRY_URL = "https://models.dev/api.json";
const AI_REGISTRY_STALE_MS = 24 * 60 * 60 * 1000;

interface RegistryProviderPayload {
  id?: string;
  name?: string;
  api?: string;
  doc?: string;
  npm?: string;
  env?: unknown;
  models?: Record<string, RegistryModelPayload>;
  [key: string]: unknown;
}

interface RegistryModelPayload {
  id?: string;
  name?: string;
  family?: string;
  attachment?: boolean;
  tool_call?: boolean;
  reasoning?: boolean;
  temperature?: boolean;
  modalities?: {
    input?: unknown;
    output?: unknown;
  };
  limit?: {
    context?: number;
    output?: number;
  };
  cost?: {
    input?: number;
    output?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

let pendingCatalogRefresh: Promise<AiCatalogStatusView> | null = null;

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function isTextToTextModel(model: RegistryModelPayload): boolean {
  const input = normalizeStringArray(model.modalities?.input);
  const output = normalizeStringArray(model.modalities?.output);
  return input.includes("text") && output.includes("text");
}

function hashPayload(payload: string): string {
  return createHash("sha256").update(payload).digest("hex");
}

function parseRegistryPayload(payload: string): Record<string, RegistryProviderPayload> {
  const parsed = JSON.parse(payload) as unknown;
  invariant(
    parsed && typeof parsed === "object" && !Array.isArray(parsed),
    "模型目录数据格式不正确。",
  );
  return parsed as Record<string, RegistryProviderPayload>;
}

export function getAiRegistryState() {
  return readRegistryState();
}

export function getAiCatalogStatus(): AiCatalogStatusView {
  const state = getAiRegistryState();
  const providers = listProviders();
  const models = listModels();
  const activeProviderCount = providers.filter((provider) => provider.isActive).length;
  const activeModelCount = models.filter((model) => model.isActive).length;
  const lastSuccessAt = state?.lastSuccessAt ?? null;

  return {
    lastAttemptAt: state?.lastAttemptAt ?? null,
    lastSuccessAt,
    lastError: state?.lastError ?? null,
    contentHash: state?.contentHash ?? null,
    providerCount: providers.length,
    activeProviderCount,
    modelCount: models.length,
    activeModelCount,
    isStale: lastSuccessAt == null || now() - lastSuccessAt > AI_REGISTRY_STALE_MS,
  };
}

export function listCatalogProvidersView({
  activeOnly = true,
  supportedOnly = false,
}: {
  activeOnly?: boolean;
  supportedOnly?: boolean;
}): AiCatalogProviderView[] {
  const providers = listProviders();
  const models = listModels();
  const modelCounts = new Map<string, number>();

  for (const model of models) {
    if (activeOnly && !model.isActive) continue;
    modelCounts.set(model.providerId, (modelCounts.get(model.providerId) ?? 0) + 1);
  }

  return providers
    .filter((provider) => !activeOnly || provider.isActive)
    .map((provider) => {
      const isSupported = isSupportedAiSdkPackage(provider.sdkPackage);
      return {
        id: provider.id,
        name: provider.name,
        sdkPackage: provider.sdkPackage,
        apiUrl: provider.apiUrl,
        docsUrl: provider.docsUrl,
        envKeys: normalizeStringArray(JSON.parse(provider.envKeysJson)),
        isActive: provider.isActive,
        isSupported,
        modelCount: modelCounts.get(provider.id) ?? 0,
      };
    })
    .filter((provider) => !supportedOnly || provider.isSupported)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function listCatalogModelsView({
  catalogProviderId,
  activeOnly = true,
  query,
}: {
  catalogProviderId: string;
  activeOnly?: boolean;
  query?: string;
}): AiCatalogModelView[] {
  const rows = listModelsByProvider(catalogProviderId, { activeOnly });

  const needle = query?.trim().toLowerCase();

  return rows
    .filter((row) => {
      if (!needle) return true;
      return (
        row.modelId.toLowerCase().includes(needle) ||
        row.displayName.toLowerCase().includes(needle) ||
        (row.family?.toLowerCase().includes(needle) ?? false)
      );
    })
    .map((row) => modelRowToView(row))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function listResolvedModelsForConnection({
  connectionId,
  includeDisabled = false,
}: {
  connectionId: string;
  includeDisabled?: boolean;
}): AiResolvedModelView[] {
  const connection = userConfig.aiConnections.get(connectionId);
  invariant(connection, "未找到 AI 连接。");

  const resolved: AiResolvedModelView[] = [];

  if (connection.kind === "registry" && connection.catalogProviderId) {
    const catalogModels = listModelsByProvider(connection.catalogProviderId, { activeOnly: true });
    const overrides = userConfig.aiConnections.listCatalogOverridesForConnection(connectionId);
    const overrideMap = new Map(overrides.map((override) => [override.catalogModelId, override]));

    for (const model of catalogModels) {
      const override = overrideMap.get(model.id);
      const isEnabled = override?.isEnabled ?? true;
      if (!includeDisabled && !isEnabled) continue;
      resolved.push({
        id: `catalog:${model.id}`,
        connectionId,
        origin: "catalog",
        sdkPackage: connection.sdkPackage,
        modelId: model.modelId,
        displayName: model.displayName,
        family: model.family,
        contextWindow: model.contextWindow,
        maxOutputTokens: model.maxOutputTokens,
        supportsVision: model.supportsVision,
        supportsToolUse: model.supportsToolUse,
        supportsReasoning: model.supportsReasoning,
        supportsTemperature: model.supportsTemperature,
        inputPricePer1m: model.inputPricePer1m,
        outputPricePer1m: model.outputPricePer1m,
        isEnabled,
        catalogModelId: model.id,
        customModelId: null,
        isActive: model.isActive,
      });
    }
  }

  const customModels = userConfig.aiConnections.listCustomModelsForConnection(connectionId);
  for (const model of customModels) {
    if (!includeDisabled && !model.isEnabled) continue;
    resolved.push({
      id: `custom:${model.id}`,
      connectionId,
      origin: "custom",
      sdkPackage: connection.sdkPackage,
      modelId: model.modelId,
      displayName: model.displayName,
      family: null,
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxOutputTokens,
      supportsVision: model.supportsVision,
      supportsToolUse: model.supportsToolUse,
      supportsReasoning: model.supportsReasoning,
      supportsTemperature: model.supportsTemperature,
      inputPricePer1m: model.inputPricePer1m,
      outputPricePer1m: model.outputPricePer1m,
      isEnabled: model.isEnabled,
      catalogModelId: null,
      customModelId: model.id,
      isActive: true,
    });
  }

  return resolved.sort((a, b) => {
    if (a.origin !== b.origin) return a.origin === "catalog" ? -1 : 1;
    return a.displayName.localeCompare(b.displayName);
  });
}

export function assertConnectionSupportsCustomModel(connection: AiConnectionRow, modelId: string) {
  if (connection.kind !== "registry" || !connection.catalogProviderId) return;
  const conflicting = findModelByProviderAndModelId(connection.catalogProviderId, modelId, {
    activeOnly: true,
  });
  invariant(!conflicting, "模型 ID 与当前连接中的目录模型冲突。");
}

function modelRowToView(row: AiRegistryModelRow): AiCatalogModelView {
  return {
    id: row.id,
    providerId: row.providerId,
    modelId: row.modelId,
    displayName: row.displayName,
    family: row.family,
    inputModalities: normalizeStringArray(JSON.parse(row.inputModalitiesJson)),
    outputModalities: normalizeStringArray(JSON.parse(row.outputModalitiesJson)),
    contextWindow: row.contextWindow,
    maxOutputTokens: row.maxOutputTokens,
    supportsVision: row.supportsVision,
    supportsToolUse: row.supportsToolUse,
    supportsReasoning: row.supportsReasoning,
    supportsTemperature: row.supportsTemperature,
    inputPricePer1m: row.inputPricePer1m,
    outputPricePer1m: row.outputPricePer1m,
    isActive: row.isActive,
  };
}

// Re-export for backwards compatibility with anything that might import these from catalog.ts.
export type { AiRegistryModelRow, AiRegistryProviderRow };

export async function syncAiCatalogFromPayload(payload: string): Promise<AiCatalogStatusView> {
  const contentHash = hashPayload(payload);
  const registry = parseRegistryPayload(payload);
  const existingState = getAiRegistryState();

  return await runInTransaction(async () => {
    const timestamp = now();

    // Mark all existing providers & models inactive (soft delete semantics).
    const providers = listProviders();
    for (const provider of providers) {
      if (provider.isActive) {
        upsertProvider({ id: provider.id, isActive: false, updatedAt: timestamp });
      }
    }
    const models = listModels();
    for (const model of models) {
      if (model.isActive) {
        upsertModel({ id: model.id, isActive: false, updatedAt: timestamp });
      }
    }

    if (existingState?.contentHash === contentHash) {
      writeRegistryState({
        lastAttemptAt: timestamp,
        lastSuccessAt: timestamp,
        lastError: null,
        contentHash,
      });
      return getAiCatalogStatus();
    }

    for (const [providerKey, provider] of Object.entries(registry)) {
      const providerId = provider.id ?? providerKey;
      const providerName = provider.name ?? providerId;
      const envKeys = JSON.stringify(normalizeStringArray(provider.env));
      const rawJson = JSON.stringify(provider);

      upsertProvider({
        id: providerId,
        name: providerName,
        sdkPackage: provider.npm ?? null,
        apiUrl: provider.api ?? null,
        docsUrl: provider.doc ?? null,
        envKeysJson: envKeys,
        rawJson,
        isActive: true,
        lastSeenAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      for (const model of Object.values(provider.models ?? {})) {
        if (!isTextToTextModel(model)) continue;
        const modelId = model.id ?? "";
        if (!modelId) continue;

        const inputModalities = normalizeStringArray(model.modalities?.input);
        const outputModalities = normalizeStringArray(model.modalities?.output);

        upsertModel({
          id: `${providerId}:${modelId}`,
          providerId,
          modelId,
          displayName: model.name ?? modelId,
          family: model.family ?? null,
          inputModalitiesJson: JSON.stringify(inputModalities),
          outputModalitiesJson: JSON.stringify(outputModalities),
          contextWindow: model.limit?.context ?? null,
          maxOutputTokens: model.limit?.output ?? null,
          supportsVision:
            inputModalities.includes("image") ||
            outputModalities.includes("image") ||
            inputModalities.includes("pdf"),
          supportsToolUse: Boolean(model.tool_call),
          supportsReasoning: Boolean(model.reasoning),
          supportsTemperature: Boolean(model.temperature),
          inputPricePer1m: model.cost?.input ?? null,
          outputPricePer1m: model.cost?.output ?? null,
          costJson: model.cost ? JSON.stringify(model.cost) : null,
          rawJson: JSON.stringify(model),
          isActive: true,
          lastSeenAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }
    }

    writeRegistryState({
      lastAttemptAt: timestamp,
      lastSuccessAt: timestamp,
      lastError: null,
      contentHash,
    });

    return getAiCatalogStatus();
  });
}

export async function refreshAiCatalog({
  force = false,
  fetcher = fetch,
}: {
  force?: boolean;
  fetcher?: typeof fetch;
} = {}): Promise<AiCatalogStatusView> {
  if (pendingCatalogRefresh && !force) {
    return pendingCatalogRefresh;
  }

  const refreshPromise = (async () => {
    const timestamp = now();
    writeRegistryState({ lastAttemptAt: timestamp });

    try {
      const response = await fetcher(AI_REGISTRY_URL, {
        headers: { "user-agent": "NovelEvolver/0.1" },
      });
      if (!response.ok) {
        throw new Error(`模型目录请求失败：HTTP ${response.status} ${response.statusText}`);
      }
      const payload = await response.text();
      return await syncAiCatalogFromPayload(payload);
    } catch (error) {
      writeRegistryState({
        lastAttemptAt: timestamp,
        lastError: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      pendingCatalogRefresh = null;
    }
  })();

  pendingCatalogRefresh = refreshPromise;
  return refreshPromise;
}

export async function ensureAiCatalogFresh(): Promise<AiCatalogStatusView> {
  const status = getAiCatalogStatus();
  if (status.lastSuccessAt == null || status.isStale) {
    try {
      return await refreshAiCatalog();
    } catch {
      return getAiCatalogStatus();
    }
  }
  return status;
}

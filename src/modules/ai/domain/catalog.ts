import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { type DatabaseExecutor, db, schema } from "@/db";
import { isSupportedAiSdkPackage } from "@/modules/ai/domain/packages";
import { invariant, now } from "@/shared/lib/domain";
import type {
  AiCatalogModelView,
  AiCatalogProviderView,
  AiCatalogStatusView,
  AiConnectionRow,
  AiResolvedModelView,
} from "@/modules/ai/domain/types";

const AI_REGISTRY_STATE_ID = "models.dev";
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

function upsertRegistryState(
  executor: DatabaseExecutor,
  state: Partial<typeof schema.aiRegistryState.$inferInsert>,
) {
  const timestamp = now();
  executor
    .insert(schema.aiRegistryState)
    .values({
      id: AI_REGISTRY_STATE_ID,
      createdAt: timestamp,
      updatedAt: timestamp,
      ...state,
    })
    .onConflictDoUpdate({
      target: schema.aiRegistryState.id,
      set: {
        ...state,
        updatedAt: timestamp,
      },
    })
    .run();
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
  return db.query.aiRegistryState
    .findFirst({ where: eq(schema.aiRegistryState.id, AI_REGISTRY_STATE_ID) })
    .sync();
}

export function getAiCatalogStatus(): AiCatalogStatusView {
  const state = getAiRegistryState();
  const providers = db.query.aiCatalogProviders.findMany().sync();
  const models = db.query.aiCatalogModels.findMany().sync();
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
  const providers = db.query.aiCatalogProviders.findMany().sync();
  const models = db.query.aiCatalogModels.findMany().sync();
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
  const rows = db.query.aiCatalogModels
    .findMany({
      where: activeOnly
        ? and(
            eq(schema.aiCatalogModels.providerId, catalogProviderId),
            eq(schema.aiCatalogModels.isActive, true),
          )
        : eq(schema.aiCatalogModels.providerId, catalogProviderId),
    })
    .sync();

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
    .map((row) => ({
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
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function listResolvedModelsForConnection({
  connectionId,
  includeDisabled = false,
}: {
  connectionId: string;
  includeDisabled?: boolean;
}): AiResolvedModelView[] {
  const connection = db.query.aiConnections
    .findFirst({ where: eq(schema.aiConnections.id, connectionId) })
    .sync();
  invariant(connection, "未找到 AI 连接。");

  const resolved: AiResolvedModelView[] = [];

  if (connection.kind === "registry" && connection.catalogProviderId) {
    const catalogModels = db.query.aiCatalogModels
      .findMany({
        where: and(
          eq(schema.aiCatalogModels.providerId, connection.catalogProviderId),
          eq(schema.aiCatalogModels.isActive, true),
        ),
      })
      .sync();
    const overrides = db.query.aiConnectionCatalogOverrides
      .findMany({ where: eq(schema.aiConnectionCatalogOverrides.connectionId, connectionId) })
      .sync();
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

  const customModels = db.query.aiConnectionCustomModels
    .findMany({ where: eq(schema.aiConnectionCustomModels.connectionId, connectionId) })
    .sync();
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
  const conflicting = db.query.aiCatalogModels
    .findFirst({
      where: and(
        eq(schema.aiCatalogModels.providerId, connection.catalogProviderId),
        eq(schema.aiCatalogModels.modelId, modelId),
        eq(schema.aiCatalogModels.isActive, true),
      ),
    })
    .sync();
  invariant(!conflicting, "模型 ID 与当前连接中的目录模型冲突。");
}

export async function syncAiCatalogFromPayload(
  payload: string,
  executor: DatabaseExecutor = db,
): Promise<AiCatalogStatusView> {
  const timestamp = now();
  const contentHash = hashPayload(payload);
  const registry = parseRegistryPayload(payload);
  const existingState = getAiRegistryState();

  upsertRegistryState(executor, {
    lastAttemptAt: timestamp,
  });

  if (existingState?.contentHash === contentHash) {
    upsertRegistryState(executor, {
      lastAttemptAt: timestamp,
      lastSuccessAt: timestamp,
      lastError: null,
      contentHash,
    });
    return getAiCatalogStatus();
  }

  executor.transaction((tx) => {
    tx.update(schema.aiCatalogProviders).set({ isActive: false, updatedAt: timestamp }).run();
    tx.update(schema.aiCatalogModels).set({ isActive: false, updatedAt: timestamp }).run();

    for (const [providerKey, provider] of Object.entries(registry)) {
      const providerId = provider.id ?? providerKey;
      const providerName = provider.name ?? providerId;
      tx.insert(schema.aiCatalogProviders)
        .values({
          id: providerId,
          name: providerName,
          sdkPackage: provider.npm ?? null,
          apiUrl: provider.api ?? null,
          docsUrl: provider.doc ?? null,
          envKeysJson: JSON.stringify(normalizeStringArray(provider.env)),
          rawJson: JSON.stringify(provider),
          isActive: true,
          lastSeenAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .onConflictDoUpdate({
          target: schema.aiCatalogProviders.id,
          set: {
            name: providerName,
            sdkPackage: provider.npm ?? null,
            apiUrl: provider.api ?? null,
            docsUrl: provider.doc ?? null,
            envKeysJson: JSON.stringify(normalizeStringArray(provider.env)),
            rawJson: JSON.stringify(provider),
            isActive: true,
            lastSeenAt: timestamp,
            updatedAt: timestamp,
          },
        })
        .run();

      for (const model of Object.values(provider.models ?? {})) {
        if (!isTextToTextModel(model)) continue;
        const modelId = model.id ?? "";
        if (!modelId) continue;

        const inputModalities = normalizeStringArray(model.modalities?.input);
        const outputModalities = normalizeStringArray(model.modalities?.output);

        tx.insert(schema.aiCatalogModels)
          .values({
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
          })
          .onConflictDoUpdate({
            target: schema.aiCatalogModels.id,
            set: {
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
              updatedAt: timestamp,
            },
          })
          .run();
      }
    }

    upsertRegistryState(tx, {
      lastAttemptAt: timestamp,
      lastSuccessAt: timestamp,
      lastError: null,
      contentHash,
    });
  });

  return getAiCatalogStatus();
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
    upsertRegistryState(db, { lastAttemptAt: timestamp });

    try {
      const response = await fetcher(AI_REGISTRY_URL, {
        headers: { "user-agent": "NovelEvolver/0.1" },
      });
      if (!response.ok) {
        throw new Error(`模型目录请求失败：HTTP ${response.status} ${response.statusText}`);
      }
      const payload = await response.text();
      return await syncAiCatalogFromPayload(payload, db);
    } catch (error) {
      upsertRegistryState(db, {
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

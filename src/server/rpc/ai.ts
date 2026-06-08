import { type MutationCtx, mutation, query } from "@codehz/rpc";
import { type InferInsertModel, and, eq } from "drizzle-orm";

import { db, schema } from "@/db";
import {
  assertConnectionSupportsCustomModel,
  ensureAiCatalogFresh,
  getAiCatalogStatus,
  listCatalogModelsView,
  listCatalogProvidersView,
  listResolvedModelsForConnection,
  refreshAiCatalog,
} from "@/domain/ai-catalog";
import {
  type AiConnectionConfig,
  normalizeAiConnectionConfig,
  parseAiConnectionConfig,
  stringifyAiConnectionConfig,
} from "@/domain/ai-config";
import {
  type AiSupportedSdkPackage,
  SUPPORTED_AI_SDK_PACKAGES,
  getAiSdkPackageRecipe,
} from "@/domain/ai-packages";
import { createId, invariant, now } from "@/domain/internal/ids";
import type {
  AiCatalogModelView,
  AiCatalogProviderView,
  AiCatalogStatusView,
  AiConnectionRow,
  AiResolvedModelView,
} from "@/domain/types";

type ConnectionInsert = InferInsertModel<typeof schema.aiConnections>;
type CustomModelInsert = InferInsertModel<typeof schema.aiConnectionCustomModels>;
type CustomModelRow = typeof schema.aiConnectionCustomModels.$inferSelect;

interface CreateRegistryConnectionInput {
  kind: "registry";
  name: string;
  catalogProviderId: string;
  baseUrl?: string | null;
  apiKey?: string | null;
  config?: AiConnectionConfig;
  isEnabled?: boolean;
}

interface CreateCustomConnectionInput {
  kind: "custom";
  name: string;
  sdkPackage: string;
  baseUrl?: string | null;
  apiKey?: string | null;
  config?: AiConnectionConfig;
  isEnabled?: boolean;
}

type CreateConnectionInput = CreateRegistryConnectionInput | CreateCustomConnectionInput;

type UpdateConnectionInput = {
  id: string;
  name?: string;
  catalogProviderId?: string;
  sdkPackage?: string;
  baseUrl?: string | null;
  apiKey?: string | null;
  config?: AiConnectionConfig;
  isEnabled?: boolean;
};

type CustomModelMutationInput = Pick<
  CustomModelInsert,
  | "modelId"
  | "displayName"
  | "contextWindow"
  | "maxOutputTokens"
  | "supportsVision"
  | "supportsToolUse"
  | "supportsReasoning"
  | "supportsTemperature"
  | "inputPricePer1m"
  | "outputPricePer1m"
  | "isEnabled"
>;

function invalidateConnection(ctx: MutationCtx, connectionId: string) {
  ctx.invalidate(`ai.connections.models:${connectionId}`);
}

function invalidateConnectionsList(ctx: MutationCtx, connectionId: string) {
  ctx.invalidate("ai.connections");
  invalidateConnection(ctx, connectionId);
}

function sanitizeName(name: string): string {
  const trimmed = name.trim();
  invariant(trimmed.length > 0, "名称不能为空。");
  return trimmed;
}

function sanitizeBaseUrl(baseUrl: string | null | undefined): string | null {
  const trimmed = baseUrl?.trim();
  return trimmed ? trimmed : null;
}

function sanitizeApiKey(apiKey: string | null | undefined): string | null {
  const trimmed = apiKey?.trim();
  return trimmed ? trimmed : null;
}

function normalizeConnectionConfigForSdkPackage(
  sdkPackage: string,
  config: AiConnectionConfig | null | undefined,
) {
  return normalizeAiConnectionConfig({ sdkPackage, config });
}

function sanitizeConfigJson(
  sdkPackage: string,
  config: AiConnectionConfig | null | undefined,
): string {
  return stringifyAiConnectionConfig({ sdkPackage, config });
}

function validateSdkPackageForInput(sdkPackage: string) {
  const recipe = getAiSdkPackageRecipe(sdkPackage);
  invariant(recipe, "不支持这个 AI SDK 包。");
  return recipe;
}

export function validateConnectionApiKey({
  apiKey,
  existingApiKey,
}: {
  apiKey: string | null;
  existingApiKey?: string | null;
}) {
  invariant(apiKey || existingApiKey, "请填写 API Key。");
}

export function validateConnectionBaseUrl({
  sdkPackage,
  baseUrl,
  config,
}: {
  sdkPackage: string;
  baseUrl: string | null;
  config: AiConnectionConfig | null | undefined;
}) {
  const recipe = validateSdkPackageForInput(sdkPackage);
  if (recipe.requiresBaseUrl) {
    invariant(baseUrl, "这个 AI SDK 包需要填写 Base URL。");
  }
  if (!recipe.requiresBaseUrl && !recipe.allowsCustomEndpoint) {
    invariant(baseUrl == null, "这个 AI SDK 包不支持自定义接口地址。");
  }
  if (recipe.configKind === "azure") {
    invariant(
      baseUrl || config?.azure?.resourceName,
      "Azure 连接需要填写 Base URL 或 Resource Name。",
    );
  }
}

function buildConnectionInsert(input: CreateConnectionInput): ConnectionInsert {
  const timestamp = now();
  const name = sanitizeName(input.name);
  const apiKey = sanitizeApiKey(input.apiKey);

  if (input.kind === "registry") {
    const provider = db.query.aiCatalogProviders
      .findFirst({ where: eq(schema.aiCatalogProviders.id, input.catalogProviderId) })
      .sync();
    invariant(provider, "未找到模型目录服务商。");
    invariant(provider.sdkPackage, "该模型目录服务商没有配置 AI SDK 包。");

    const recipe = validateSdkPackageForInput(provider.sdkPackage);
    invariant(recipe.supportsRegistryProvider, "暂不支持该模型目录服务商使用的 AI SDK 包。");
    const baseUrl = sanitizeBaseUrl(input.baseUrl);
    const config = normalizeConnectionConfigForSdkPackage(provider.sdkPackage, input.config);
    validateConnectionApiKey({ apiKey });
    validateConnectionBaseUrl({ sdkPackage: provider.sdkPackage, baseUrl, config });

    return {
      id: createId("conn"),
      kind: "registry",
      name,
      sdkPackage: provider.sdkPackage,
      catalogProviderId: provider.id,
      baseUrl,
      apiKey,
      configJson: sanitizeConfigJson(provider.sdkPackage, config),
      isEnabled: input.isEnabled ?? true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  const sdkPackage = input.sdkPackage;
  const baseUrl = sanitizeBaseUrl(input.baseUrl);
  const config = normalizeConnectionConfigForSdkPackage(sdkPackage, input.config);
  validateConnectionApiKey({ apiKey });
  validateConnectionBaseUrl({ sdkPackage, baseUrl, config });

  return {
    id: createId("conn"),
    kind: "custom",
    name,
    sdkPackage,
    catalogProviderId: null,
    baseUrl,
    apiKey,
    configJson: sanitizeConfigJson(sdkPackage, config),
    isEnabled: input.isEnabled ?? true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function normalizeCustomModelInput(input: CustomModelMutationInput) {
  const modelId = input.modelId.trim();
  const displayName = input.displayName.trim();
  invariant(modelId.length > 0, "模型 ID 不能为空。");
  invariant(displayName.length > 0, "显示名称不能为空。");

  return {
    modelId,
    displayName,
    contextWindow: input.contextWindow ?? null,
    maxOutputTokens: input.maxOutputTokens ?? null,
    supportsVision: input.supportsVision ?? false,
    supportsToolUse: input.supportsToolUse ?? false,
    supportsReasoning: input.supportsReasoning ?? false,
    supportsTemperature: input.supportsTemperature ?? false,
    inputPricePer1m: input.inputPricePer1m ?? null,
    outputPricePer1m: input.outputPricePer1m ?? null,
    isEnabled: input.isEnabled ?? true,
  };
}

export const listSupportedSdkPackages = query<void, AiSupportedSdkPackage[]>((_, ctx) => {
  ctx.watch("ai.catalog.packages");
  return [...SUPPORTED_AI_SDK_PACKAGES];
});

export const getCatalogStatus = query<void, AiCatalogStatusView>((_, ctx) => {
  ctx.watch("ai.catalog.status");
  return getAiCatalogStatus();
});

export const refreshCatalog = mutation<{ force?: boolean } | void, AiCatalogStatusView>(
  async (input, ctx) => {
    const status = await refreshAiCatalog({ force: input?.force ?? false });
    ctx.invalidate(
      "ai.catalog.status",
      "ai.catalog.providers",
      "ai.connections",
      "ai.catalog.models",
    );
    return status;
  },
);

export const listCatalogProviders = query<
  { activeOnly?: boolean; supportedOnly?: boolean } | void,
  AiCatalogProviderView[]
>((input, ctx) => {
  ctx.watch("ai.catalog.providers");
  return listCatalogProvidersView({
    activeOnly: input?.activeOnly ?? true,
    supportedOnly: input?.supportedOnly ?? false,
  });
});

export const listCatalogModels = query<
  { catalogProviderId: string; activeOnly?: boolean; query?: string },
  AiCatalogModelView[]
>(({ catalogProviderId, activeOnly, query: search }, ctx) => {
  ctx.watch("ai.catalog.models", `ai.catalog.models:${catalogProviderId}`);
  return listCatalogModelsView({
    catalogProviderId,
    activeOnly: activeOnly ?? true,
    query: search,
  });
});

export const listConnections = query<void, AiConnectionRow[]>((_, ctx) => {
  ctx.watch("ai.connections");
  return db.query.aiConnections
    .findMany()
    .sync()
    .sort((a, b) => a.name.localeCompare(b.name));
});

export const createConnection = mutation<CreateConnectionInput, AiConnectionRow>((input, ctx) => {
  const values = buildConnectionInsert(input);
  db.insert(schema.aiConnections).values(values).run();
  ctx.invalidate("ai.connections");
  return db.query.aiConnections
    .findFirst({ where: eq(schema.aiConnections.id, values.id) })
    .sync()!;
});

export const updateConnection = mutation<UpdateConnectionInput, AiConnectionRow>((input, ctx) => {
  const existing = db.query.aiConnections
    .findFirst({ where: eq(schema.aiConnections.id, input.id) })
    .sync();
  invariant(existing, "未找到 AI 连接。");

  const timestamp = now();
  const nextName = input.name != null ? sanitizeName(input.name) : existing.name;
  const nextKind = existing.kind;
  let nextSdkPackage = existing.sdkPackage;
  let nextCatalogProviderId = existing.catalogProviderId;

  if (nextKind === "registry") {
    const providerId = input.catalogProviderId ?? existing.catalogProviderId;
    invariant(providerId, "模型目录连接必须关联一个服务商。");
    const provider = db.query.aiCatalogProviders
      .findFirst({ where: eq(schema.aiCatalogProviders.id, providerId) })
      .sync();
    invariant(provider, "未找到模型目录服务商。");
    invariant(provider.sdkPackage, "该模型目录服务商没有配置 AI SDK 包。");
    const recipe = validateSdkPackageForInput(provider.sdkPackage);
    invariant(recipe.supportsRegistryProvider, "暂不支持该模型目录服务商使用的 AI SDK 包。");
    nextSdkPackage = provider.sdkPackage;
    nextCatalogProviderId = provider.id;
  } else if (input.sdkPackage != null) {
    validateSdkPackageForInput(input.sdkPackage);
    nextSdkPackage = input.sdkPackage;
  }

  const nextBaseUrl =
    input.baseUrl !== undefined ? sanitizeBaseUrl(input.baseUrl) : existing.baseUrl;
  const nextApiKey =
    input.apiKey !== undefined ? sanitizeApiKey(input.apiKey) : (existing.apiKey ?? null);
  const nextConfig = normalizeConnectionConfigForSdkPackage(
    nextSdkPackage,
    input.config ?? parseAiConnectionConfig(existing.configJson),
  );

  validateConnectionApiKey({ apiKey: nextApiKey, existingApiKey: existing.apiKey });
  validateConnectionBaseUrl({
    sdkPackage: nextSdkPackage,
    baseUrl: nextBaseUrl,
    config: nextConfig,
  });

  const nextValues: Partial<ConnectionInsert> = {
    name: nextName,
    sdkPackage: nextSdkPackage,
    catalogProviderId: nextCatalogProviderId,
    baseUrl: nextBaseUrl,
    configJson: sanitizeConfigJson(nextSdkPackage, nextConfig),
    isEnabled: input.isEnabled ?? existing.isEnabled,
    updatedAt: timestamp,
  };

  if (input.apiKey !== undefined) {
    nextValues.apiKey = nextApiKey;
  }

  db.update(schema.aiConnections)
    .set(nextValues)
    .where(eq(schema.aiConnections.id, input.id))
    .run();
  invalidateConnectionsList(ctx, input.id);
  return db.query.aiConnections.findFirst({ where: eq(schema.aiConnections.id, input.id) }).sync()!;
});

export const deleteConnection = mutation<{ id: string }, void>(({ id }, ctx) => {
  db.delete(schema.aiConnections).where(eq(schema.aiConnections.id, id)).run();
  invalidateConnectionsList(ctx, id);
});

export const listResolvedModels = query<
  { connectionId: string; includeDisabled?: boolean },
  AiResolvedModelView[]
>(({ connectionId, includeDisabled }, ctx) => {
  ctx.watch(`ai.connections.models:${connectionId}`);
  return listResolvedModelsForConnection({
    connectionId,
    includeDisabled: includeDisabled ?? false,
  });
});

export const setCatalogModelEnabled = mutation<
  { connectionId: string; catalogModelId: string; enabled: boolean },
  AiResolvedModelView[]
>(({ connectionId, catalogModelId, enabled }, ctx) => {
  const connection = db.query.aiConnections
    .findFirst({ where: eq(schema.aiConnections.id, connectionId) })
    .sync();
  invariant(connection, "未找到 AI 连接。");
  invariant(connection.kind === "registry", "只有模型目录连接可以启用或停用目录模型。");

  const catalogModel = db.query.aiCatalogModels
    .findFirst({ where: eq(schema.aiCatalogModels.id, catalogModelId) })
    .sync();
  invariant(catalogModel, "未找到目录模型。");
  invariant(catalogModel.providerId === connection.catalogProviderId, "该目录模型不属于当前连接。");

  if (enabled) {
    db.delete(schema.aiConnectionCatalogOverrides)
      .where(
        and(
          eq(schema.aiConnectionCatalogOverrides.connectionId, connectionId),
          eq(schema.aiConnectionCatalogOverrides.catalogModelId, catalogModelId),
        ),
      )
      .run();
  } else {
    const timestamp = now();
    db.insert(schema.aiConnectionCatalogOverrides)
      .values({
        id: createId("ovr"),
        connectionId,
        catalogModelId,
        isEnabled: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .onConflictDoUpdate({
        target: [
          schema.aiConnectionCatalogOverrides.connectionId,
          schema.aiConnectionCatalogOverrides.catalogModelId,
        ],
        set: {
          isEnabled: false,
          updatedAt: timestamp,
        },
      })
      .run();
  }

  invalidateConnection(ctx, connectionId);
  return listResolvedModelsForConnection({ connectionId, includeDisabled: true });
});

export const createCustomModel = mutation<
  { connectionId: string } & CustomModelMutationInput,
  CustomModelRow
>(({ connectionId, ...input }, ctx) => {
  const connection = db.query.aiConnections
    .findFirst({ where: eq(schema.aiConnections.id, connectionId) })
    .sync();
  invariant(connection, "未找到 AI 连接。");

  const values = normalizeCustomModelInput(input);
  assertConnectionSupportsCustomModel(connection, values.modelId);

  const timestamp = now();
  const id = createId("cmodel");
  db.insert(schema.aiConnectionCustomModels)
    .values({
      id,
      connectionId,
      ...values,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();

  invalidateConnection(ctx, connectionId);
  return db.query.aiConnectionCustomModels
    .findFirst({ where: eq(schema.aiConnectionCustomModels.id, id) })
    .sync()!;
});

export const updateCustomModel = mutation<
  { id: string } & Partial<CustomModelMutationInput>,
  CustomModelRow
>(({ id, ...input }, ctx) => {
  const existing = db.query.aiConnectionCustomModels
    .findFirst({ where: eq(schema.aiConnectionCustomModels.id, id) })
    .sync();
  invariant(existing, "未找到自定义模型。");

  const connection = db.query.aiConnections
    .findFirst({ where: eq(schema.aiConnections.id, existing.connectionId) })
    .sync();
  invariant(connection, "未找到 AI 连接。");

  const values = normalizeCustomModelInput({
    modelId: input.modelId ?? existing.modelId,
    displayName: input.displayName ?? existing.displayName,
    contextWindow: input.contextWindow ?? existing.contextWindow,
    maxOutputTokens: input.maxOutputTokens ?? existing.maxOutputTokens,
    supportsVision: input.supportsVision ?? existing.supportsVision,
    supportsToolUse: input.supportsToolUse ?? existing.supportsToolUse,
    supportsReasoning: input.supportsReasoning ?? existing.supportsReasoning,
    supportsTemperature: input.supportsTemperature ?? existing.supportsTemperature,
    inputPricePer1m: input.inputPricePer1m ?? existing.inputPricePer1m,
    outputPricePer1m: input.outputPricePer1m ?? existing.outputPricePer1m,
    isEnabled: input.isEnabled ?? existing.isEnabled,
  });
  if (values.modelId !== existing.modelId) {
    assertConnectionSupportsCustomModel(connection, values.modelId);
  }

  db.update(schema.aiConnectionCustomModels)
    .set({ ...values, updatedAt: now() })
    .where(eq(schema.aiConnectionCustomModels.id, id))
    .run();

  invalidateConnection(ctx, existing.connectionId);
  return db.query.aiConnectionCustomModels
    .findFirst({ where: eq(schema.aiConnectionCustomModels.id, id) })
    .sync()!;
});

export const deleteCustomModel = mutation<{ id: string }, void>(({ id }, ctx) => {
  const model = db.query.aiConnectionCustomModels
    .findFirst({ where: eq(schema.aiConnectionCustomModels.id, id) })
    .sync();
  invariant(model, "未找到自定义模型。");
  db.delete(schema.aiConnectionCustomModels)
    .where(eq(schema.aiConnectionCustomModels.id, id))
    .run();
  invalidateConnection(ctx, model.connectionId);
});

// Warm the local catalog snapshot whenever the AI surface is touched.
void ensureAiCatalogFresh();

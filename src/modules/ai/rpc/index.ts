import { type MutationCtx, mutation, query } from "@codehz/rpc/core";
import {
  assertConnectionSupportsCustomModel,
  ensureAiCatalogFresh,
  getAiCatalogStatus,
  listCatalogModelsView,
  listCatalogProvidersView,
  listResolvedModelsForConnection,
  refreshAiCatalog,
} from "@/modules/ai/domain/catalog";
import { getModel, getProvider } from "@/modules/ai/domain/catalog-file-store";
import {
  type AiConnectionConfig,
  normalizeAiConnectionConfig,
  parseAiConnectionConfig,
  stringifyAiConnectionConfig,
} from "@/modules/ai/domain/config";
import {
  type AiSupportedSdkPackage,
  getAiSdkPackageRecipe,
  SUPPORTED_AI_SDK_PACKAGES,
} from "@/modules/ai/domain/packages";
import type {
  AiCatalogModelView,
  AiCatalogProviderView,
  AiCatalogStatusView,
  AiConnectionCustomModelRow,
  AiConnectionRow,
  AiResolvedModelView,
  GlobalPromptRow,
} from "@/modules/ai/domain/types";
import * as userConfig from "@/modules/ai/domain/user-config";
import { assertRpcFound } from "@/rpc/errors";
import { type RpcTagList, rpcTags } from "@/rpc/tags";
import { createId, invariant, now } from "@/shared/lib/domain";

type ConnectionInsert = AiConnectionRow;
type CustomModelRow = AiConnectionCustomModelRow;
type GlobalPromptInsert = GlobalPromptRow;

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
  AiConnectionCustomModelRow,
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

interface CreateGlobalPromptInput {
  name: string;
  description?: string | null;
  content: string;
  isEnabled?: boolean;
}

interface UpdateGlobalPromptInput {
  id: string;
  name?: string;
  description?: string | null;
  content?: string;
  isEnabled?: boolean;
}

type RpcMutationCtx = MutationCtx<RpcTagList>;

function invalidateConnection(ctx: RpcMutationCtx, connectionId: string) {
  ctx.invalidate(rpcTags.aiConnectionModels(connectionId));
}

function invalidateConnectionsList(ctx: RpcMutationCtx, connectionId: string) {
  ctx.invalidate(rpcTags.aiConnections());
  invalidateConnection(ctx, connectionId);
}

function sanitizeName(name: string): string {
  const trimmed = name.trim();
  invariant(trimmed.length > 0, "名称不能为空。");
  return trimmed;
}

function sanitizePromptContent(content: string): string {
  const trimmed = content.trim();
  invariant(trimmed.length > 0, "Prompt 正文不能为空。");
  return trimmed;
}

function sanitizeDescription(description: string | null | undefined): string | null {
  const trimmed = description?.trim();
  return trimmed ? trimmed : null;
}

function assertGlobalPromptNameAvailable(name: string, excludeId?: string) {
  const existing = userConfig.globalPrompts.findByName(name);
  invariant(!existing || existing.id === excludeId, "Prompt 名称已存在。");
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
    const provider = getProvider(input.catalogProviderId);
    assertRpcFound(provider, "未找到模型目录服务商。");
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

export const listSupportedSdkPackages = query<void, AiSupportedSdkPackage[], RpcTagList>({
  watch: () => [rpcTags.aiCatalogPackages()],
  handler: () => [...SUPPORTED_AI_SDK_PACKAGES],
});

export const getCatalogStatus = query<void, AiCatalogStatusView, RpcTagList>({
  watch: () => [rpcTags.aiCatalogStatus()],
  handler: () => getAiCatalogStatus(),
});

export const refreshCatalog = mutation<
  { force?: boolean } | undefined,
  AiCatalogStatusView,
  RpcTagList
>(async (input, ctx) => {
  const status = await refreshAiCatalog({ force: input?.force ?? false });
  ctx.invalidate(
    rpcTags.aiCatalogStatus(),
    rpcTags.aiCatalogProviders(),
    rpcTags.aiConnections(),
    rpcTags.aiCatalogModels(),
  );
  return status;
});

export const listCatalogProviders = query<
  { activeOnly?: boolean; supportedOnly?: boolean } | undefined,
  AiCatalogProviderView[],
  RpcTagList
>({
  watch: () => [rpcTags.aiCatalogProviders()],
  handler: (input) =>
    listCatalogProvidersView({
      activeOnly: input?.activeOnly ?? true,
      supportedOnly: input?.supportedOnly ?? false,
    }),
});

export const listCatalogModels = query<
  { catalogProviderId: string; activeOnly?: boolean; query?: string },
  AiCatalogModelView[],
  RpcTagList
>({
  watch: ({ catalogProviderId }) => [
    rpcTags.aiCatalogModels(),
    rpcTags.aiCatalogModelsByProvider(catalogProviderId),
  ],
  handler: ({ catalogProviderId, activeOnly, query: search }) =>
    listCatalogModelsView({
      catalogProviderId,
      activeOnly: activeOnly ?? true,
      query: search,
    }),
});

export const listGlobalPrompts = query<void, GlobalPromptRow[], RpcTagList>({
  watch: () => [rpcTags.aiGlobalPrompts()],
  handler: () => userConfig.globalPrompts.list(),
});

export const createGlobalPrompt = mutation<CreateGlobalPromptInput, GlobalPromptRow, RpcTagList>({
  invalidate: () => [rpcTags.aiGlobalPrompts()],
  handler: (input) => {
    const timestamp = now();
    const name = sanitizeName(input.name);
    assertGlobalPromptNameAvailable(name);

    const values: GlobalPromptInsert = {
      id: createId("prompt"),
      name,
      description: sanitizeDescription(input.description),
      content: sanitizePromptContent(input.content),
      isEnabled: input.isEnabled ?? true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    return userConfig.globalPrompts.insert(values);
  },
});

export const updateGlobalPrompt = mutation<UpdateGlobalPromptInput, GlobalPromptRow, RpcTagList>({
  invalidate: () => [rpcTags.aiGlobalPrompts()],
  handler: (input) => {
    const existing = userConfig.globalPrompts.get(input.id);
    assertRpcFound(existing, "未找到 Prompt。");

    const name = input.name != null ? sanitizeName(input.name) : existing.name;
    assertGlobalPromptNameAvailable(name, input.id);

    const nextValues: Partial<GlobalPromptInsert> = {
      name,
      description:
        input.description !== undefined
          ? sanitizeDescription(input.description)
          : existing.description,
      content: input.content != null ? sanitizePromptContent(input.content) : existing.content,
      isEnabled: input.isEnabled ?? existing.isEnabled,
      updatedAt: now(),
    };

    const updated = userConfig.globalPrompts.update(input.id, nextValues);
    assertRpcFound(updated, "未找到 Prompt。");
    return updated;
  },
});

export const deleteGlobalPrompt = mutation<{ id: string }, { id: string }, RpcTagList>({
  invalidate: () => [rpcTags.aiGlobalPrompts()],
  handler: ({ id }) => {
    const existing = userConfig.globalPrompts.get(id);
    assertRpcFound(existing, "未找到 Prompt。");
    userConfig.globalPrompts.remove(id);
    return { id };
  },
});

export const listConnections = query<void, AiConnectionRow[], RpcTagList>({
  watch: () => [rpcTags.aiConnections()],
  handler: () => userConfig.aiConnections.list(),
});

export const listEnabledConnectionModels = query<
  void,
  Array<{ connection: AiConnectionRow; models: AiResolvedModelView[] }>,
  RpcTagList
>({
  watch: (_, result) => [
    rpcTags.aiConnections(),
    ...result.map(({ connection }) => rpcTags.aiConnectionModels(connection.id)),
  ],
  handler: () => {
    const connections = userConfig.aiConnections
      .list()
      .filter((connection) => connection.isEnabled)
      .sort((a, b) => a.name.localeCompare(b.name));

    return connections.map((connection) => ({
      connection,
      models: listResolvedModelsForConnection({ connectionId: connection.id }),
    }));
  },
});

export const createConnection = mutation<CreateConnectionInput, AiConnectionRow, RpcTagList>({
  invalidate: () => [rpcTags.aiConnections()],
  handler: (input) => {
    const values = buildConnectionInsert(input);
    return userConfig.aiConnections.insert(values);
  },
});

export const updateConnection = mutation<UpdateConnectionInput, AiConnectionRow, RpcTagList>(
  (input, ctx) => {
    const existing = userConfig.aiConnections.get(input.id);
    assertRpcFound(existing, "未找到 AI 连接。");

    const timestamp = now();
    const nextName = input.name != null ? sanitizeName(input.name) : existing.name;
    const nextKind = existing.kind;
    let nextSdkPackage = existing.sdkPackage;
    let nextCatalogProviderId = existing.catalogProviderId;

    if (nextKind === "registry") {
      const providerId = input.catalogProviderId ?? existing.catalogProviderId;
      invariant(providerId, "模型目录连接必须关联一个服务商。");
      const provider = getProvider(providerId);
      assertRpcFound(provider, "未找到模型目录服务商。");
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

    const updated = userConfig.aiConnections.update(input.id, nextValues);
    assertRpcFound(updated, "未找到 AI 连接。");
    invalidateConnectionsList(ctx, input.id);
    return updated;
  },
);

export const deleteConnection = mutation<{ id: string }, void, RpcTagList>(({ id }, ctx) => {
  userConfig.aiConnections.remove(id);
  invalidateConnectionsList(ctx, id);
});

export const listResolvedModels = query<
  { connectionId: string; includeDisabled?: boolean },
  AiResolvedModelView[],
  RpcTagList
>({
  watch: ({ connectionId }) => [rpcTags.aiConnectionModels(connectionId)],
  handler: ({ connectionId, includeDisabled }) =>
    listResolvedModelsForConnection({
      connectionId,
      includeDisabled: includeDisabled ?? false,
    }),
});

export const setCatalogModelEnabled = mutation<
  { connectionId: string; catalogModelId: string; enabled: boolean },
  AiResolvedModelView[],
  RpcTagList
>(({ connectionId, catalogModelId, enabled }, ctx) => {
  const connection = userConfig.aiConnections.get(connectionId);
  assertRpcFound(connection, "未找到 AI 连接。");
  invariant(connection.kind === "registry", "只有模型目录连接可以启用或停用目录模型。");

  const catalogModel = getModel(catalogModelId);
  assertRpcFound(catalogModel, "未找到目录模型。");
  invariant(catalogModel.providerId === connection.catalogProviderId, "该目录模型不属于当前连接。");

  if (enabled) {
    userConfig.aiConnections.deleteCatalogModelOverride(connectionId, catalogModelId);
  } else {
    const timestamp = now();
    userConfig.aiConnections.setCatalogModelOverride({
      id: createId("ovr"),
      connectionId,
      catalogModelId,
      isEnabled: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  invalidateConnection(ctx, connectionId);
  return listResolvedModelsForConnection({ connectionId, includeDisabled: true });
});

export const createCustomModel = mutation<
  { connectionId: string } & CustomModelMutationInput,
  CustomModelRow,
  RpcTagList
>(({ connectionId, ...input }, ctx) => {
  const connection = userConfig.aiConnections.get(connectionId);
  assertRpcFound(connection, "未找到 AI 连接。");

  const values = normalizeCustomModelInput(input);
  assertConnectionSupportsCustomModel(connection, values.modelId);

  const timestamp = now();
  const model = userConfig.aiConnections.insertCustomModel({
    id: createId("cmodel"),
    connectionId,
    ...values,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  invalidateConnection(ctx, connectionId);
  return model;
});

export const updateCustomModel = mutation<
  { id: string } & Partial<CustomModelMutationInput>,
  CustomModelRow,
  RpcTagList
>(({ id, ...input }, ctx) => {
  const existing = userConfig.aiConnections.getCustomModel(id);
  assertRpcFound(existing, "未找到自定义模型。");

  const connection = userConfig.aiConnections.get(existing.connectionId);
  assertRpcFound(connection, "未找到 AI 连接。");

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

  const updated = userConfig.aiConnections.updateCustomModel(id, { ...values, updatedAt: now() });
  assertRpcFound(updated, "未找到自定义模型。");

  invalidateConnection(ctx, existing.connectionId);
  return updated;
});

export const deleteCustomModel = mutation<{ id: string }, void, RpcTagList>(({ id }, ctx) => {
  const model = userConfig.aiConnections.getCustomModel(id);
  assertRpcFound(model, "未找到自定义模型。");
  userConfig.aiConnections.deleteCustomModel(id);
  invalidateConnection(ctx, model.connectionId);
});

// Warm the local catalog snapshot whenever the AI surface is touched.
void ensureAiCatalogFresh();

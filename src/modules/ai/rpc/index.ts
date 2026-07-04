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
import { rpcTags } from "@/rpc/tags";
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

function getConnectionInvalidateTags(connectionId: string): unknown[] {
  return [rpcTags.aiConnectionModels(connectionId)];
}

function getConnectionsListInvalidateTags(connectionId: string): unknown[] {
  return [rpcTags.aiConnections(), ...getConnectionInvalidateTags(connectionId)];
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

export async function listSupportedSdkPackages(
  _input: undefined,
): Promise<{ data: AiSupportedSdkPackage[]; watch?: unknown[] }> {
  const data = [...SUPPORTED_AI_SDK_PACKAGES];
  const watch = [rpcTags.aiCatalogPackages()];
  return { data, watch };
}

export async function getCatalogStatus(
  _input: undefined,
): Promise<{ data: AiCatalogStatusView; watch?: unknown[] }> {
  const data = getAiCatalogStatus();
  const watch = [rpcTags.aiCatalogStatus()];
  return { data, watch };
}

export async function refreshCatalog(
  input: { force?: boolean } | undefined,
): Promise<{ data: AiCatalogStatusView; invalidate?: unknown[] }> {
  const data = await refreshAiCatalog({ force: input?.force ?? false });
  const invalidate = [
    rpcTags.aiCatalogStatus(),
    rpcTags.aiCatalogProviders(),
    rpcTags.aiConnections(),
    rpcTags.aiCatalogModels(),
  ];
  return { data, invalidate };
}

export async function listCatalogProviders(
  input: { activeOnly?: boolean; supportedOnly?: boolean } | undefined,
): Promise<{ data: AiCatalogProviderView[]; watch?: unknown[] }> {
  const data = listCatalogProvidersView({
    activeOnly: input?.activeOnly ?? true,
    supportedOnly: input?.supportedOnly ?? false,
  });
  const watch = [rpcTags.aiCatalogProviders()];
  return { data, watch };
}

export async function listCatalogModels(input: {
  catalogProviderId: string;
  activeOnly?: boolean;
  query?: string;
}): Promise<{ data: AiCatalogModelView[]; watch?: unknown[] }> {
  const data = listCatalogModelsView({
    catalogProviderId: input.catalogProviderId,
    activeOnly: input.activeOnly ?? true,
    query: input.query,
  });
  const watch = [
    rpcTags.aiCatalogModels(),
    rpcTags.aiCatalogModelsByProvider(input.catalogProviderId),
  ];
  return { data, watch };
}

export async function listGlobalPrompts(
  _input: undefined,
): Promise<{ data: GlobalPromptRow[]; watch?: unknown[] }> {
  const data = userConfig.globalPrompts.list();
  const watch = [rpcTags.aiGlobalPrompts()];
  return { data, watch };
}

export async function createGlobalPrompt(
  input: CreateGlobalPromptInput,
): Promise<{ data: GlobalPromptRow; invalidate?: unknown[] }> {
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

  const data = userConfig.globalPrompts.insert(values);
  const invalidate = [rpcTags.aiGlobalPrompts()];
  return { data, invalidate };
}

export async function updateGlobalPrompt(
  input: UpdateGlobalPromptInput,
): Promise<{ data: GlobalPromptRow; invalidate?: unknown[] }> {
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
  const invalidate = [rpcTags.aiGlobalPrompts()];
  return { data: updated, invalidate };
}

export async function deleteGlobalPrompt(input: {
  id: string;
}): Promise<{ data: { id: string }; invalidate?: unknown[] }> {
  const existing = userConfig.globalPrompts.get(input.id);
  assertRpcFound(existing, "未找到 Prompt。");
  userConfig.globalPrompts.remove(input.id);
  const invalidate = [rpcTags.aiGlobalPrompts()];
  return { data: { id: input.id }, invalidate };
}

export async function listConnections(
  _input: undefined,
): Promise<{ data: AiConnectionRow[]; watch?: unknown[] }> {
  const data = userConfig.aiConnections.list();
  const watch = [rpcTags.aiConnections()];
  return { data, watch };
}

export async function listEnabledConnectionModels(_input: undefined): Promise<{
  data: Array<{ connection: AiConnectionRow; models: AiResolvedModelView[] }>;
  watch?: unknown[];
}> {
  const connections = userConfig.aiConnections
    .list()
    .filter((connection) => connection.isEnabled)
    .sort((a, b) => a.name.localeCompare(b.name));

  const data = connections.map((connection) => ({
    connection,
    models: listResolvedModelsForConnection({ connectionId: connection.id }),
  }));

  const watch = [
    rpcTags.aiConnections(),
    ...data.map(({ connection }) => rpcTags.aiConnectionModels(connection.id)),
  ];
  return { data, watch };
}

export async function createConnection(
  input: CreateConnectionInput,
): Promise<{ data: AiConnectionRow; invalidate?: unknown[] }> {
  const values = buildConnectionInsert(input);
  const data = userConfig.aiConnections.insert(values);
  const invalidate = [rpcTags.aiConnections()];
  return { data, invalidate };
}

export async function updateConnection(
  input: UpdateConnectionInput,
): Promise<{ data: AiConnectionRow; invalidate?: unknown[] }> {
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
  const invalidate = getConnectionsListInvalidateTags(input.id);
  return { data: updated, invalidate };
}

export async function deleteConnection(input: {
  id: string;
}): Promise<{ data: void; invalidate?: unknown[] }> {
  userConfig.aiConnections.remove(input.id);
  const invalidate = getConnectionsListInvalidateTags(input.id);
  return { data: undefined, invalidate };
}

export async function listResolvedModels(input: {
  connectionId: string;
  includeDisabled?: boolean;
}): Promise<{ data: AiResolvedModelView[]; watch?: unknown[] }> {
  const data = listResolvedModelsForConnection({
    connectionId: input.connectionId,
    includeDisabled: input.includeDisabled ?? false,
  });
  const watch = [rpcTags.aiConnectionModels(input.connectionId)];
  return { data, watch };
}

export async function setCatalogModelEnabled(input: {
  connectionId: string;
  catalogModelId: string;
  enabled: boolean;
}): Promise<{ data: AiResolvedModelView[]; invalidate?: unknown[] }> {
  const connection = userConfig.aiConnections.get(input.connectionId);
  assertRpcFound(connection, "未找到 AI 连接。");
  invariant(connection.kind === "registry", "只有模型目录连接可以启用或停用目录模型。");

  const catalogModel = getModel(input.catalogModelId);
  assertRpcFound(catalogModel, "未找到目录模型。");
  invariant(catalogModel.providerId === connection.catalogProviderId, "该目录模型不属于当前连接。");

  if (input.enabled) {
    userConfig.aiConnections.deleteCatalogModelOverride(input.connectionId, input.catalogModelId);
  } else {
    const timestamp = now();
    userConfig.aiConnections.setCatalogModelOverride({
      id: createId("ovr"),
      connectionId: input.connectionId,
      catalogModelId: input.catalogModelId,
      isEnabled: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  const data = listResolvedModelsForConnection({
    connectionId: input.connectionId,
    includeDisabled: true,
  });
  const invalidate = getConnectionInvalidateTags(input.connectionId);
  return { data, invalidate };
}

export async function createCustomModel(
  input: { connectionId: string } & CustomModelMutationInput,
): Promise<{ data: CustomModelRow; invalidate?: unknown[] }> {
  const { connectionId, ...rest } = input;
  const connection = userConfig.aiConnections.get(connectionId);
  assertRpcFound(connection, "未找到 AI 连接。");

  const values = normalizeCustomModelInput(rest);
  assertConnectionSupportsCustomModel(connection, values.modelId);

  const timestamp = now();
  const data = userConfig.aiConnections.insertCustomModel({
    id: createId("cmodel"),
    connectionId,
    ...values,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  const invalidate = getConnectionInvalidateTags(connectionId);
  return { data, invalidate };
}

export async function updateCustomModel(
  input: { id: string } & Partial<CustomModelMutationInput>,
): Promise<{ data: CustomModelRow; invalidate?: unknown[] }> {
  const { id, ...rest } = input;
  const existing = userConfig.aiConnections.getCustomModel(id);
  assertRpcFound(existing, "未找到自定义模型。");

  const connection = userConfig.aiConnections.get(existing.connectionId);
  assertRpcFound(connection, "未找到 AI 连接。");

  const values = normalizeCustomModelInput({
    modelId: rest.modelId ?? existing.modelId,
    displayName: rest.displayName ?? existing.displayName,
    contextWindow: rest.contextWindow ?? existing.contextWindow,
    maxOutputTokens: rest.maxOutputTokens ?? existing.maxOutputTokens,
    supportsVision: rest.supportsVision ?? existing.supportsVision,
    supportsToolUse: rest.supportsToolUse ?? existing.supportsToolUse,
    supportsReasoning: rest.supportsReasoning ?? existing.supportsReasoning,
    supportsTemperature: rest.supportsTemperature ?? existing.supportsTemperature,
    inputPricePer1m: rest.inputPricePer1m ?? existing.inputPricePer1m,
    outputPricePer1m: rest.outputPricePer1m ?? existing.outputPricePer1m,
    isEnabled: rest.isEnabled ?? existing.isEnabled,
  });
  if (values.modelId !== existing.modelId) {
    assertConnectionSupportsCustomModel(connection, values.modelId);
  }

  const updated = userConfig.aiConnections.updateCustomModel(id, { ...values, updatedAt: now() });
  assertRpcFound(updated, "未找到自定义模型。");

  const invalidate = getConnectionInvalidateTags(existing.connectionId);
  return { data: updated, invalidate };
}

export async function deleteCustomModel(input: {
  id: string;
}): Promise<{ data: void; invalidate?: unknown[] }> {
  const model = userConfig.aiConnections.getCustomModel(input.id);
  assertRpcFound(model, "未找到自定义模型。");
  userConfig.aiConnections.deleteCustomModel(input.id);
  const invalidate = getConnectionInvalidateTags(model.connectionId);
  return { data: undefined, invalidate };
}

// Warm the local catalog snapshot whenever the AI surface is touched.
void ensureAiCatalogFresh();

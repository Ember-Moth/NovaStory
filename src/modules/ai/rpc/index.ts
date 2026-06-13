import { mutation, type MutationCtx, query, stream } from "@codehz/rpc/core";
import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import {
  assertConnectionSupportsCustomModel,
  ensureAiCatalogFresh,
  getAiCatalogStatus,
  listCatalogModelsView,
  listCatalogProvidersView,
  listResolvedModelsForConnection,
  refreshAiCatalog,
} from "@/modules/ai/domain/catalog";
import {
  getProjectAssistantService,
  type ProjectAssistantEditResult,
  type ProjectAssistantContinueResult,
  type ProjectAssistantOverview,
  type ProjectAssistantRetryResult,
  type ProjectAssistantSendResult,
} from "@/modules/ai/server/project-assistant";
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
import { createId, invariant, now } from "@/shared/lib/domain";
import type {
  AgentCandidateNodeView,
  AgentRunView,
  AgentRunTraceView,
  AgentThreadStateView,
  AgentThreadView,
  AssistantMentionInput,
  AiCatalogModelView,
  AiCatalogProviderView,
  AiCatalogStatusView,
  AiConnectionCustomModelRow,
  AiConnectionRow,
  AiResolvedModelView,
  GlobalPromptRow,
  ProjectAssistantStreamEvent,
  ProjectAssistantContextSnapshot,
  ProjectAssistantToolName,
} from "@/modules/ai/domain/types";
import { PROJECT_ASSISTANT_WRITE_TOOL_NAMES } from "@/modules/ai/domain/types";
import {
  deleteAiConnectionFromConfig,
  deleteCatalogModelOverrideFromConfig,
  deleteCustomModelFromConfig,
  deleteGlobalPromptFromConfig,
  findGlobalPromptByNameFromConfig,
  getAiConnectionFromConfig,
  getCustomModelFromConfig,
  getGlobalPromptFromConfig,
  insertAiConnectionToConfig,
  insertCustomModelToConfig,
  insertGlobalPromptToConfig,
  listAiConnectionsFromConfig,
  listGlobalPromptsFromConfig,
  setCatalogModelOverrideInConfig,
  updateAiConnectionInConfig,
  updateCustomModelInConfig,
  updateGlobalPromptInConfig,
} from "@/modules/ai/domain/user-config";
import { assertRpcFound } from "@/rpc/errors";
import { rpcTags, type RpcTagList } from "@/rpc/tags";
import { getDefaultWorkspace } from "@/modules/workspace/domain";

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

interface ProjectAssistantStateInput {
  projectId: string;
}

interface SendProjectAssistantMessageInput {
  projectId: string;
  threadId: string;
  text: string;
  mentions?: AssistantMentionInput[] | null;
  context?: ProjectAssistantContextSnapshot | null;
  activeTools?: ProjectAssistantToolName[] | null;
}

interface RetryProjectAssistantMessageInput {
  projectId: string;
  threadId: string;
  triggerNodeId: string;
  context?: ProjectAssistantContextSnapshot | null;
  activeTools?: ProjectAssistantToolName[] | null;
}

interface EditProjectAssistantMessageInput {
  projectId: string;
  threadId: string;
  nodeId: string;
  text: string;
  mentions?: AssistantMentionInput[] | null;
  context?: ProjectAssistantContextSnapshot | null;
  activeTools?: ProjectAssistantToolName[] | null;
}

interface ContinueProjectAssistantRunInput {
  projectId: string;
  threadId: string;
  runId: string;
}

interface CancelProjectAssistantRunInput {
  projectId: string;
  threadId: string;
  runId: string;
}

type RpcMutationCtx = MutationCtx<RpcTagList>;

function invalidateConnection(ctx: RpcMutationCtx, connectionId: string) {
  ctx.invalidate(rpcTags.aiConnectionModels(connectionId));
}

function invalidateConnectionsList(ctx: RpcMutationCtx, connectionId: string) {
  ctx.invalidate(rpcTags.aiConnections());
  invalidateConnection(ctx, connectionId);
}

function invalidateProjectAiState(
  ctx: RpcMutationCtx,
  projectId: string,
  options?: {
    threadId?: string | null;
    candidateParentNodeId?: string | null;
    runId?: string | null;
  },
) {
  ctx.invalidate(rpcTags.aiProjectAssistantOverview(projectId));
  ctx.invalidate(rpcTags.aiProjectThreads(projectId));
  if (options?.threadId) {
    ctx.invalidate(rpcTags.aiThreadView(options.threadId));
  }
  if (options?.candidateParentNodeId) {
    ctx.invalidate(rpcTags.aiNodeCandidates(options.candidateParentNodeId));
  }
  if (options?.runId) {
    ctx.invalidate(rpcTags.aiRunTrace(options.runId));
    ctx.invalidate(rpcTags.aiChildRuns(options.runId));
  }
}

function unwrapToolOutputValue(output: unknown) {
  if (!output || typeof output !== "object") {
    return null;
  }

  const value = Reflect.get(output as Record<string, unknown>, "value");
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }

  return output as Record<string, unknown>;
}

function isSuccessfulWriteToolOutput(content: unknown) {
  if (!content || typeof content !== "object") {
    return false;
  }

  const toolName = Reflect.get(content as Record<string, unknown>, "toolName");
  if (
    typeof toolName !== "string" ||
    !(PROJECT_ASSISTANT_WRITE_TOOL_NAMES as readonly string[]).includes(toolName)
  ) {
    return false;
  }

  const output = unwrapToolOutputValue(Reflect.get(content as Record<string, unknown>, "output"));
  return !!output && Reflect.get(output, "ok") === true;
}

function invalidateAuxWorkspaceForRun(ctx: RpcMutationCtx, projectId: string, runId: string) {
  const trace = getProjectAssistantService().getRunTrace(runId);
  const hasSuccessfulWrite = trace.artifacts.some(
    (artifact) =>
      artifact.artifactKind === "tool-output" && isSuccessfulWriteToolOutput(artifact.content),
  );
  if (!hasSuccessfulWrite) {
    return;
  }

  let defaultWorkspaceId: string | null = null;
  try {
    defaultWorkspaceId = getDefaultWorkspace(projectId)?.id ?? null;
  } catch {
    defaultWorkspaceId = null;
  }

  const workspaceId =
    defaultWorkspaceId ??
    (typeof trace.run.contextSnapshot?.workspaceId === "string"
      ? trace.run.contextSnapshot.workspaceId
      : null);
  if (!workspaceId) {
    return;
  }

  ctx.invalidate(rpcTags.auxWorkspace(workspaceId));
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
  const existing = findGlobalPromptByNameFromConfig(name);
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
    const provider = db.query.aiCatalogProviders
      .findFirst({ where: eq(schema.aiCatalogProviders.id, input.catalogProviderId) })
      .sync();
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

export const refreshCatalog = mutation<{ force?: boolean } | void, AiCatalogStatusView, RpcTagList>(
  async (input, ctx) => {
    const status = await refreshAiCatalog({ force: input?.force ?? false });
    ctx.invalidate(
      rpcTags.aiCatalogStatus(),
      rpcTags.aiCatalogProviders(),
      rpcTags.aiConnections(),
      rpcTags.aiCatalogModels(),
    );
    return status;
  },
);

export const listCatalogProviders = query<
  { activeOnly?: boolean; supportedOnly?: boolean } | void,
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
  handler: () => listGlobalPromptsFromConfig(),
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

    return insertGlobalPromptToConfig(values);
  },
});

export const updateGlobalPrompt = mutation<UpdateGlobalPromptInput, GlobalPromptRow, RpcTagList>({
  invalidate: () => [rpcTags.aiGlobalPrompts()],
  handler: (input) => {
    const existing = getGlobalPromptFromConfig(input.id);
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

    const updated = updateGlobalPromptInConfig(input.id, nextValues);
    assertRpcFound(updated, "未找到 Prompt。");
    return updated;
  },
});

export const deleteGlobalPrompt = mutation<{ id: string }, { id: string }, RpcTagList>({
  invalidate: () => [rpcTags.aiGlobalPrompts()],
  handler: ({ id }) => {
    const existing = getGlobalPromptFromConfig(id);
    assertRpcFound(existing, "未找到 Prompt。");
    deleteGlobalPromptFromConfig(id);
    return { id };
  },
});

export const listConnections = query<void, AiConnectionRow[], RpcTagList>({
  watch: () => [rpcTags.aiConnections()],
  handler: () => listAiConnectionsFromConfig(),
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
    const connections = listAiConnectionsFromConfig()
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
    return insertAiConnectionToConfig(values);
  },
});

export const updateConnection = mutation<UpdateConnectionInput, AiConnectionRow, RpcTagList>(
  (input, ctx) => {
    const existing = getAiConnectionFromConfig(input.id);
    assertRpcFound(existing, "未找到 AI 连接。");

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

    const updated = updateAiConnectionInConfig(input.id, nextValues);
    assertRpcFound(updated, "未找到 AI 连接。");
    invalidateConnectionsList(ctx, input.id);
    return updated;
  },
);

export const deleteConnection = mutation<{ id: string }, void, RpcTagList>(({ id }, ctx) => {
  deleteAiConnectionFromConfig(id);
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
  const connection = getAiConnectionFromConfig(connectionId);
  assertRpcFound(connection, "未找到 AI 连接。");
  invariant(connection.kind === "registry", "只有模型目录连接可以启用或停用目录模型。");

  const catalogModel = db.query.aiCatalogModels
    .findFirst({ where: eq(schema.aiCatalogModels.id, catalogModelId) })
    .sync();
  assertRpcFound(catalogModel, "未找到目录模型。");
  invariant(catalogModel.providerId === connection.catalogProviderId, "该目录模型不属于当前连接。");

  if (enabled) {
    deleteCatalogModelOverrideFromConfig(connectionId, catalogModelId);
  } else {
    const timestamp = now();
    setCatalogModelOverrideInConfig({
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
  const connection = getAiConnectionFromConfig(connectionId);
  assertRpcFound(connection, "未找到 AI 连接。");

  const values = normalizeCustomModelInput(input);
  assertConnectionSupportsCustomModel(connection, values.modelId);

  const timestamp = now();
  const model = insertCustomModelToConfig({
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
  const existing = getCustomModelFromConfig(id);
  assertRpcFound(existing, "未找到自定义模型。");

  const connection = getAiConnectionFromConfig(existing.connectionId);
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

  const updated = updateCustomModelInConfig(id, { ...values, updatedAt: now() });
  assertRpcFound(updated, "未找到自定义模型。");

  invalidateConnection(ctx, existing.connectionId);
  return updated;
});

export const deleteCustomModel = mutation<{ id: string }, void, RpcTagList>(({ id }, ctx) => {
  const model = getCustomModelFromConfig(id);
  assertRpcFound(model, "未找到自定义模型。");
  deleteCustomModelFromConfig(id);
  invalidateConnection(ctx, model.connectionId);
});

export const listProjectThreads = query<
  { projectId: string; archived?: boolean },
  AgentThreadView[],
  RpcTagList
>({
  watch: ({ projectId }) => [rpcTags.aiProjectThreads(projectId)],
  handler: ({ projectId, archived }) =>
    getProjectAssistantService()
      .getProjectAssistantState(projectId)
      .threads.filter((thread) =>
        archived ? thread.archivedAt != null : thread.archivedAt == null,
      ),
});

export const getProjectAssistantState = query<
  ProjectAssistantStateInput,
  ProjectAssistantOverview,
  RpcTagList
>({
  watch: ({ projectId }, result) => [
    rpcTags.aiProjectAssistantOverview(projectId),
    rpcTags.aiProjectThreads(projectId),
    ...(result.activeThreadId ? [rpcTags.aiThreadView(result.activeThreadId)] : []),
  ],
  handler: ({ projectId }) => getProjectAssistantService().getProjectAssistantState(projectId),
});

export const getThreadView = query<{ threadId: string }, AgentThreadStateView, RpcTagList>({
  watch: ({ threadId }, result) => [
    rpcTags.aiThreadView(threadId),
    ...result.candidateGroups.map((group) =>
      rpcTags.aiNodeCandidates(group.parentNodeId ?? "__root__"),
    ),
    ...result.latestRuns.map((run) => rpcTags.aiRunTrace(run.id)),
  ],
  handler: ({ threadId }) => getProjectAssistantService().getThreadView(threadId),
});

export const getNodeCandidatesQuery = query<
  { parentNodeId: string },
  AgentCandidateNodeView[],
  RpcTagList
>({
  watch: ({ parentNodeId }) => [rpcTags.aiNodeCandidates(parentNodeId)],
  handler: ({ parentNodeId }) => getProjectAssistantService().getNodeCandidates(parentNodeId),
});

export const getRunTraceQuery = query<{ runId: string }, AgentRunTraceView, RpcTagList>({
  watch: ({ runId }) => [rpcTags.aiRunTrace(runId), rpcTags.aiChildRuns(runId)],
  handler: ({ runId }) => getProjectAssistantService().getRunTrace(runId),
});

export const getChildRunsQuery = query<{ runId: string }, AgentRunView[], RpcTagList>({
  watch: ({ runId }) => [rpcTags.aiChildRuns(runId)],
  handler: ({ runId }) => getProjectAssistantService().getChildRuns(runId),
});

export const createProjectAssistantThread = mutation<
  { projectId: string },
  AgentThreadView,
  RpcTagList
>(({ projectId }, ctx) => {
  const thread = getProjectAssistantService().createProjectAssistantThread(projectId);
  invalidateProjectAiState(ctx, projectId, {
    threadId: thread.id,
  });
  return thread;
});

export const setProjectAssistantActiveThread = mutation<
  { projectId: string; threadId: string },
  AgentThreadView,
  RpcTagList
>(({ projectId, threadId }, ctx) => {
  const thread = getProjectAssistantService().setProjectAssistantActiveThread(projectId, threadId);
  invalidateProjectAiState(ctx, projectId, {
    threadId: thread.id,
  });
  return thread;
});

export const renameProjectAssistantThread = mutation<
  { threadId: string; title: string },
  AgentThreadView,
  RpcTagList
>(({ threadId, title }, ctx) => {
  const thread = getProjectAssistantService().renameProjectAssistantThread(threadId, title);
  invalidateProjectAiState(ctx, thread.projectId, {
    threadId: thread.id,
  });
  return thread;
});

export const archiveProjectAssistantThread = mutation<
  { threadId: string; archived: boolean },
  AgentThreadView,
  RpcTagList
>(({ threadId, archived }, ctx) => {
  const thread = getProjectAssistantService().archiveProjectAssistantThread(threadId, archived);
  invalidateProjectAiState(ctx, thread.projectId, {
    threadId: thread.id,
  });
  return thread;
});

export const selectThreadTip = mutation<
  { threadId: string; tipNodeId: string },
  AgentThreadView,
  RpcTagList
>(({ threadId, tipNodeId }, ctx) => {
  const thread = getProjectAssistantService().selectThreadTip(threadId, tipNodeId);
  invalidateProjectAiState(ctx, thread.projectId, {
    threadId: thread.id,
    candidateParentNodeId: tipNodeId,
  });
  return thread;
});

export const sendProjectAssistantMessage = mutation<
  SendProjectAssistantMessageInput,
  ProjectAssistantSendResult,
  RpcTagList
>(async ({ projectId, threadId, text, mentions, context, activeTools }, ctx) => {
  try {
    const result = await getProjectAssistantService().sendProjectAssistantMessage({
      projectId,
      threadId,
      text,
      mentions,
      context,
      activeTools,
    });
    invalidateProjectAiState(ctx, projectId, {
      threadId: result.thread.id,
      runId: result.run.id,
      candidateParentNodeId: result.userNode.id,
    });
    invalidateAuxWorkspaceForRun(ctx, projectId, result.run.id);
    return result;
  } catch (error) {
    invalidateProjectAiState(ctx, projectId, { threadId });
    throw error;
  }
});

export const sendProjectAssistantMessageStream = stream<
  SendProjectAssistantMessageInput,
  ProjectAssistantStreamEvent,
  ProjectAssistantSendResult,
  RpcTagList
>({
  handler: async ({ projectId, threadId, text, mentions, context, activeTools }, ctx) => {
    const execution = getProjectAssistantService().sendProjectAssistantMessageStream({
      projectId,
      threadId,
      text,
      mentions,
      context,
      activeTools,
    });
    const unsubscribe = execution.subscribe((event) => {
      ctx.emit(event);
    });
    try {
      const result = await Promise.race([
        execution.finalResult,
        (async () => {
          await new Promise<void>((resolve) => {
            if (ctx.signal.aborted) {
              resolve();
              return;
            }
            ctx.signal.addEventListener("abort", () => resolve(), { once: true });
          });
          return execution.initialResult;
        })(),
      ]);
      if (!ctx.signal.aborted) {
        invalidateProjectAiState(ctx, projectId, {
          threadId: result.thread.id,
          runId: result.run.id,
          candidateParentNodeId: result.userNode.id,
        });
        invalidateAuxWorkspaceForRun(ctx, projectId, result.run.id);
      }
      return result;
    } finally {
      unsubscribe();
    }
  },
});

export const retryProjectAssistantMessage = mutation<
  RetryProjectAssistantMessageInput,
  ProjectAssistantRetryResult,
  RpcTagList
>(async ({ projectId, threadId, triggerNodeId, context, activeTools }, ctx) => {
  try {
    const result = await getProjectAssistantService().retryProjectAssistantMessage({
      projectId,
      threadId,
      triggerNodeId,
      context,
      activeTools,
    });
    invalidateProjectAiState(ctx, projectId, {
      threadId: result.thread.id,
      runId: result.run.id,
      candidateParentNodeId: triggerNodeId,
    });
    invalidateAuxWorkspaceForRun(ctx, projectId, result.run.id);
    return result;
  } catch (error) {
    invalidateProjectAiState(ctx, projectId, { threadId });
    throw error;
  }
});

export const retryProjectAssistantMessageStream = stream<
  RetryProjectAssistantMessageInput,
  ProjectAssistantStreamEvent,
  ProjectAssistantRetryResult,
  RpcTagList
>({
  handler: async ({ projectId, threadId, triggerNodeId, context, activeTools }, ctx) => {
    const execution = getProjectAssistantService().retryProjectAssistantMessageStream({
      projectId,
      threadId,
      triggerNodeId,
      context,
      activeTools,
    });
    const unsubscribe = execution.subscribe((event) => {
      ctx.emit(event);
    });
    try {
      const result = await Promise.race([
        execution.finalResult,
        (async () => {
          await new Promise<void>((resolve) => {
            if (ctx.signal.aborted) {
              resolve();
              return;
            }
            ctx.signal.addEventListener("abort", () => resolve(), { once: true });
          });
          return execution.initialResult;
        })(),
      ]);
      if (!ctx.signal.aborted) {
        invalidateProjectAiState(ctx, projectId, {
          threadId: result.thread.id,
          runId: result.run.id,
          candidateParentNodeId: triggerNodeId,
        });
        invalidateAuxWorkspaceForRun(ctx, projectId, result.run.id);
      }
      return result;
    } finally {
      unsubscribe();
    }
  },
});

export const editProjectAssistantMessage = mutation<
  EditProjectAssistantMessageInput,
  ProjectAssistantEditResult,
  RpcTagList
>(async ({ projectId, threadId, nodeId, text, mentions, context, activeTools }, ctx) => {
  try {
    const result = await getProjectAssistantService().editProjectAssistantMessage({
      projectId,
      threadId,
      nodeId,
      text,
      mentions,
      context,
      activeTools,
    });
    invalidateProjectAiState(ctx, projectId, {
      threadId: result.thread.id,
      runId: result.run.id,
      candidateParentNodeId: result.replacementNode.parentNodeId,
    });
    invalidateAuxWorkspaceForRun(ctx, projectId, result.run.id);
    return result;
  } catch (error) {
    invalidateProjectAiState(ctx, projectId, { threadId });
    throw error;
  }
});

export const editProjectAssistantMessageStream = stream<
  EditProjectAssistantMessageInput,
  ProjectAssistantStreamEvent,
  ProjectAssistantEditResult,
  RpcTagList
>({
  handler: async ({ projectId, threadId, nodeId, text, mentions, context, activeTools }, ctx) => {
    const execution = getProjectAssistantService().editProjectAssistantMessageStream({
      projectId,
      threadId,
      nodeId,
      text,
      mentions,
      context,
      activeTools,
    });
    const unsubscribe = execution.subscribe((event) => {
      ctx.emit(event);
    });
    try {
      const result = await Promise.race([
        execution.finalResult,
        (async () => {
          await new Promise<void>((resolve) => {
            if (ctx.signal.aborted) {
              resolve();
              return;
            }
            ctx.signal.addEventListener("abort", () => resolve(), { once: true });
          });
          return execution.initialResult;
        })(),
      ]);
      if (!ctx.signal.aborted) {
        invalidateProjectAiState(ctx, projectId, {
          threadId: result.thread.id,
          runId: result.run.id,
          candidateParentNodeId: result.replacementNode.parentNodeId,
        });
        invalidateAuxWorkspaceForRun(ctx, projectId, result.run.id);
      }
      return result;
    } finally {
      unsubscribe();
    }
  },
});

export const continueProjectAssistantRun = mutation<
  ContinueProjectAssistantRunInput,
  ProjectAssistantContinueResult,
  RpcTagList
>(async ({ projectId, threadId, runId }, ctx) => {
  try {
    const result = await getProjectAssistantService().continueProjectAssistantRun({
      projectId,
      threadId,
      runId,
    });
    invalidateProjectAiState(ctx, projectId, {
      threadId: result.thread.id,
      runId: result.run.id,
      candidateParentNodeId: result.run.triggerNodeId,
    });
    ctx.invalidate(rpcTags.aiRunTrace(runId), rpcTags.aiChildRuns(runId));
    invalidateAuxWorkspaceForRun(ctx, projectId, result.run.id);
    return result;
  } catch (error) {
    invalidateProjectAiState(ctx, projectId, { threadId, runId });
    throw error;
  }
});

export const continueProjectAssistantRunStream = stream<
  ContinueProjectAssistantRunInput,
  ProjectAssistantStreamEvent,
  ProjectAssistantContinueResult,
  RpcTagList
>({
  handler: async ({ projectId, threadId, runId }, ctx) => {
    const execution = getProjectAssistantService().continueProjectAssistantRunStream({
      projectId,
      threadId,
      runId,
    });
    const unsubscribe = execution.subscribe((event) => {
      ctx.emit(event);
    });
    try {
      const result = await Promise.race([
        execution.finalResult,
        (async () => {
          await new Promise<void>((resolve) => {
            if (ctx.signal.aborted) {
              resolve();
              return;
            }
            ctx.signal.addEventListener("abort", () => resolve(), { once: true });
          });
          return execution.initialResult;
        })(),
      ]);
      if (!ctx.signal.aborted) {
        invalidateProjectAiState(ctx, projectId, {
          threadId: result.thread.id,
          runId: result.run.id,
          candidateParentNodeId: result.run.triggerNodeId,
        });
        ctx.invalidate(rpcTags.aiRunTrace(runId), rpcTags.aiChildRuns(runId));
        invalidateAuxWorkspaceForRun(ctx, projectId, result.run.id);
      }
      return result;
    } finally {
      unsubscribe();
    }
  },
});

export const cancelProjectAssistantRun = mutation<
  CancelProjectAssistantRunInput,
  { runId: string },
  RpcTagList
>(async ({ projectId, threadId, runId }, ctx) => {
  const result = getProjectAssistantService().cancelProjectAssistantRun({
    projectId,
    threadId,
    runId,
  });
  invalidateProjectAiState(ctx, projectId, {
    threadId,
    runId,
  });
  return result;
});

// Warm the local catalog snapshot whenever the AI surface is touched.
void ensureAiCatalogFresh();

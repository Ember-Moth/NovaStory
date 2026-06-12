import { mutation, type MutationCtx, query, stream } from "@codehz/rpc/core";
import { and, eq, type InferInsertModel } from "drizzle-orm";

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
  AiCatalogModelView,
  AiCatalogProviderView,
  AiCatalogStatusView,
  AiConnectionRow,
  AiResolvedModelView,
  ProjectAssistantStreamEvent,
  ProjectAssistantContextSnapshot,
  ProjectAssistantToolName,
} from "@/modules/ai/domain/types";
import { PROJECT_ASSISTANT_WRITE_TOOL_NAMES } from "@/modules/ai/domain/types";
import { assertRpcFound } from "@/rpc/errors";
import { rpcTags, type RpcTagList } from "@/rpc/tags";
import { getDefaultWorkspace } from "@/modules/workspace/domain";

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

interface ProjectAssistantStateInput {
  projectId: string;
}

interface SendProjectAssistantMessageInput {
  projectId: string;
  threadId: string;
  text: string;
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
  context?: ProjectAssistantContextSnapshot | null;
  activeTools?: ProjectAssistantToolName[] | null;
}

interface ContinueProjectAssistantRunInput {
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

export const listConnections = query<void, AiConnectionRow[], RpcTagList>({
  watch: () => [rpcTags.aiConnections()],
  handler: () =>
    db.query.aiConnections
      .findMany()
      .sync()
      .sort((a, b) => a.name.localeCompare(b.name)),
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
    const connections = db.query.aiConnections
      .findMany()
      .sync()
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
    db.insert(schema.aiConnections).values(values).run();
    return db.query.aiConnections
      .findFirst({ where: eq(schema.aiConnections.id, values.id) })
      .sync()!;
  },
});

export const updateConnection = mutation<UpdateConnectionInput, AiConnectionRow, RpcTagList>(
  (input, ctx) => {
    const existing = db.query.aiConnections
      .findFirst({ where: eq(schema.aiConnections.id, input.id) })
      .sync();
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

    db.update(schema.aiConnections)
      .set(nextValues)
      .where(eq(schema.aiConnections.id, input.id))
      .run();
    invalidateConnectionsList(ctx, input.id);
    return db.query.aiConnections
      .findFirst({ where: eq(schema.aiConnections.id, input.id) })
      .sync()!;
  },
);

export const deleteConnection = mutation<{ id: string }, void, RpcTagList>(({ id }, ctx) => {
  db.delete(schema.aiConnections).where(eq(schema.aiConnections.id, id)).run();
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
  const connection = db.query.aiConnections
    .findFirst({ where: eq(schema.aiConnections.id, connectionId) })
    .sync();
  assertRpcFound(connection, "未找到 AI 连接。");
  invariant(connection.kind === "registry", "只有模型目录连接可以启用或停用目录模型。");

  const catalogModel = db.query.aiCatalogModels
    .findFirst({ where: eq(schema.aiCatalogModels.id, catalogModelId) })
    .sync();
  assertRpcFound(catalogModel, "未找到目录模型。");
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
  CustomModelRow,
  RpcTagList
>(({ connectionId, ...input }, ctx) => {
  const connection = db.query.aiConnections
    .findFirst({ where: eq(schema.aiConnections.id, connectionId) })
    .sync();
  assertRpcFound(connection, "未找到 AI 连接。");

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
  CustomModelRow,
  RpcTagList
>(({ id, ...input }, ctx) => {
  const existing = db.query.aiConnectionCustomModels
    .findFirst({ where: eq(schema.aiConnectionCustomModels.id, id) })
    .sync();
  assertRpcFound(existing, "未找到自定义模型。");

  const connection = db.query.aiConnections
    .findFirst({ where: eq(schema.aiConnections.id, existing.connectionId) })
    .sync();
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

  db.update(schema.aiConnectionCustomModels)
    .set({ ...values, updatedAt: now() })
    .where(eq(schema.aiConnectionCustomModels.id, id))
    .run();

  invalidateConnection(ctx, existing.connectionId);
  return db.query.aiConnectionCustomModels
    .findFirst({ where: eq(schema.aiConnectionCustomModels.id, id) })
    .sync()!;
});

export const deleteCustomModel = mutation<{ id: string }, void, RpcTagList>(({ id }, ctx) => {
  const model = db.query.aiConnectionCustomModels
    .findFirst({ where: eq(schema.aiConnectionCustomModels.id, id) })
    .sync();
  assertRpcFound(model, "未找到自定义模型。");
  db.delete(schema.aiConnectionCustomModels)
    .where(eq(schema.aiConnectionCustomModels.id, id))
    .run();
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
>(async ({ projectId, threadId, text, context, activeTools }, ctx) => {
  try {
    const result = await getProjectAssistantService().sendProjectAssistantMessage({
      projectId,
      threadId,
      text,
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
  handler: async ({ projectId, threadId, text, context, activeTools }, ctx) => {
    const execution = getProjectAssistantService().sendProjectAssistantMessageStream({
      projectId,
      threadId,
      text,
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
>(async ({ projectId, threadId, nodeId, text, context, activeTools }, ctx) => {
  try {
    const result = await getProjectAssistantService().editProjectAssistantMessage({
      projectId,
      threadId,
      nodeId,
      text,
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
  handler: async ({ projectId, threadId, nodeId, text, context, activeTools }, ctx) => {
    const execution = getProjectAssistantService().editProjectAssistantMessageStream({
      projectId,
      threadId,
      nodeId,
      text,
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
      }
      return result;
    } finally {
      unsubscribe();
    }
  },
});

// Warm the local catalog snapshot whenever the AI surface is touched.
void ensureAiCatalogFresh();

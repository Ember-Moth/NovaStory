import { and, desc, eq, isNull } from "drizzle-orm";

import { type DatabaseExecutor, db, schema } from "@/db";
import { createId, invariant, now } from "@/shared/lib/domain";
import type {
  AiGenerationAttemptStatus,
  AiProjectGenerationAttemptRow,
  AiProjectGenerationAttemptView,
  AiProjectHeadRow,
  AiProjectHeadView,
  AiProjectMessageRole,
  AiProjectMessageRow,
  AiProjectMessageView,
  AiSelectionCapabilitySnapshot,
  AiSelectionPricingSnapshot,
  AiSelectionSnapshotInput,
  AiSelectionSnapshotOrigin,
  AiSelectionSnapshotView,
} from "./types";

interface MessagePayloadInput {
  role: AiProjectMessageRole;
  content: unknown;
  summaryText?: string | null;
  aiSelection?: AiSelectionSnapshotInput | null;
  metadata?: unknown;
}

interface CreateHeadInput {
  projectId: string;
  name?: string | null;
  initialMessage?: MessagePayloadInput | null;
}

interface AppendMessageInput extends MessagePayloadInput {
  projectId: string;
  headId: string;
  prevMessageId: string | null;
}

interface ForkHeadFromMessageInput extends MessagePayloadInput {
  projectId: string;
  sourceHeadId: string;
  sourceMessageId: string;
  name?: string | null;
}

interface RecordGenerationAttemptInput {
  projectId: string;
  headId?: string | null;
  triggerMessageId?: string | null;
  request: unknown;
  aiSelection?: AiSelectionSnapshotInput | null;
}

interface CompleteGenerationAttemptSuccessInput {
  attemptId: string;
  assistantMessageId?: string | null;
  usage?: unknown;
}

interface CompleteGenerationAttemptErrorInput {
  attemptId: string;
  error: unknown;
  usage?: unknown;
}

function trimOptionalString(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeHeadName(name: string | null | undefined, fallback = "未命名分支") {
  return trimOptionalString(name) ?? fallback;
}

function normalizeSummaryText(summaryText: string | null | undefined) {
  return trimOptionalString(summaryText);
}

function serializeRequiredJson(value: unknown, label: string) {
  const serialized = JSON.stringify(value);
  invariant(serialized !== undefined, `${label}必须可序列化。`);
  return serialized;
}

function serializeOptionalJson(value: unknown) {
  if (value === undefined) {
    return null;
  }
  const serialized = JSON.stringify(value);
  invariant(serialized !== undefined, "可选 JSON 字段必须可序列化。");
  return serialized;
}

function parseStoredJson(raw: string | null): unknown | null {
  if (raw == null) {
    return null;
  }
  return JSON.parse(raw);
}

function normalizeCapabilities(
  capabilities: Partial<AiSelectionCapabilitySnapshot> | null | undefined,
  fallback?: Partial<AiSelectionCapabilitySnapshot> | null,
): AiSelectionCapabilitySnapshot | null {
  const source = capabilities ?? fallback;
  if (!source) {
    return null;
  }
  return {
    supportsVision: Boolean(source.supportsVision),
    supportsToolUse: Boolean(source.supportsToolUse),
    supportsReasoning: Boolean(source.supportsReasoning),
    supportsTemperature: Boolean(source.supportsTemperature),
  };
}

function normalizePricing(
  pricing: Partial<AiSelectionPricingSnapshot> | null | undefined,
  fallback?: Partial<AiSelectionPricingSnapshot> | null,
): AiSelectionPricingSnapshot | null {
  const source = pricing ?? fallback;
  if (!source) {
    return null;
  }
  return {
    inputPricePer1m: source.inputPricePer1m ?? null,
    outputPricePer1m: source.outputPricePer1m ?? null,
  };
}

function assertRole(role: string): asserts role is AiProjectMessageRole {
  invariant(
    role === "system" || role === "user" || role === "assistant" || role === "tool",
    "不支持的消息角色。",
  );
}

function assertAttemptStatus(status: string): asserts status is AiGenerationAttemptStatus {
  invariant(
    status === "pending" || status === "success" || status === "error",
    "不支持的尝试状态。",
  );
}

function getProjectOrThrow(executor: DatabaseExecutor, projectId: string) {
  const project = executor
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .get();
  invariant(project, "未找到项目。");
  return project;
}

function touchProject(executor: DatabaseExecutor, projectId: string) {
  executor
    .update(schema.projects)
    .set({ updatedAt: now() })
    .where(eq(schema.projects.id, projectId))
    .run();
}

function getHeadOrThrow(executor: DatabaseExecutor, headId: string) {
  const head = executor
    .select()
    .from(schema.aiProjectHeads)
    .where(eq(schema.aiProjectHeads.id, headId))
    .get();
  invariant(head, "未找到 AI 分支。");
  return head;
}

function getMessageById(executor: DatabaseExecutor, messageId: string) {
  return executor
    .select()
    .from(schema.aiProjectMessages)
    .where(eq(schema.aiProjectMessages.id, messageId))
    .get();
}

function getMessageOrThrow(executor: DatabaseExecutor, messageId: string) {
  const message = getMessageById(executor, messageId);
  invariant(message, "未找到 AI 消息。");
  return message;
}

function getProjectMessageOrThrow(
  executor: DatabaseExecutor,
  projectId: string,
  messageId: string,
) {
  const message = getMessageOrThrow(executor, messageId);
  invariant(message.projectId === projectId, "AI 消息不属于当前项目。");
  return message;
}

function getAttemptOrThrow(executor: DatabaseExecutor, attemptId: string) {
  const attempt = executor
    .select()
    .from(schema.aiProjectGenerationAttempts)
    .where(eq(schema.aiProjectGenerationAttempts.id, attemptId))
    .get();
  invariant(attempt, "未找到 AI 生成尝试。");
  return attempt;
}

function mapSelectionFromRow(row: {
  connectionId: string | null;
  catalogModelId: string | null;
  customModelId: string | null;
  snapshotConnectionName: string | null;
  snapshotSdkPackage: string | null;
  snapshotBaseUrl: string | null;
  snapshotModelOrigin: string | null;
  snapshotModelId: string | null;
  snapshotModelDisplayName: string | null;
  snapshotModelFamily: string | null;
  snapshotCapabilitiesJson: string | null;
  snapshotPricingJson: string | null;
}): AiSelectionSnapshotView {
  return {
    connectionId: row.connectionId,
    catalogModelId: row.catalogModelId,
    customModelId: row.customModelId,
    connectionName: row.snapshotConnectionName,
    sdkPackage: row.snapshotSdkPackage,
    baseUrl: row.snapshotBaseUrl,
    modelOrigin: (row.snapshotModelOrigin as AiSelectionSnapshotOrigin | null) ?? null,
    modelId: row.snapshotModelId,
    modelDisplayName: row.snapshotModelDisplayName,
    modelFamily: row.snapshotModelFamily,
    capabilities:
      (parseStoredJson(row.snapshotCapabilitiesJson) as AiSelectionCapabilitySnapshot | null) ??
      null,
    pricing:
      (parseStoredJson(row.snapshotPricingJson) as AiSelectionPricingSnapshot | null) ?? null,
  };
}

function mapMessageRow(row: AiProjectMessageRow): AiProjectMessageView {
  assertRole(row.role);
  return {
    id: row.id,
    projectId: row.projectId,
    prevMessageId: row.prevMessageId,
    role: row.role,
    content: JSON.parse(row.contentJson),
    summaryText: row.summaryText,
    selection: mapSelectionFromRow(row),
    metadata: parseStoredJson(row.metadataJson),
    createdAt: row.createdAt,
  };
}

function mapHeadRow(row: AiProjectHeadRow): AiProjectHeadView {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    currentMessageId: row.currentMessageId,
    forkedFromHeadId: row.forkedFromHeadId,
    forkedFromMessageId: row.forkedFromMessageId,
    isArchived: row.isArchived,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapAttemptRow(row: AiProjectGenerationAttemptRow): AiProjectGenerationAttemptView {
  assertAttemptStatus(row.status);
  return {
    id: row.id,
    projectId: row.projectId,
    headId: row.headId,
    triggerMessageId: row.triggerMessageId,
    assistantMessageId: row.assistantMessageId,
    status: row.status,
    request: JSON.parse(row.requestJson),
    usage: parseStoredJson(row.usageJson),
    error: parseStoredJson(row.errorJson),
    selection: mapSelectionFromRow(row),
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}

function normalizeSelectionInput(
  executor: DatabaseExecutor,
  input: AiSelectionSnapshotInput | null | undefined,
) {
  const connectionId = trimOptionalString(input?.connectionId);
  const catalogModelId = trimOptionalString(input?.catalogModelId);
  const customModelId = trimOptionalString(input?.customModelId);
  invariant(!(catalogModelId && customModelId), "目录模型和自定义模型引用不能同时存在。");

  let connection = connectionId
    ? executor
        .select()
        .from(schema.aiConnections)
        .where(eq(schema.aiConnections.id, connectionId))
        .get()
    : null;
  let catalogModel = catalogModelId
    ? executor
        .select()
        .from(schema.aiCatalogModels)
        .where(eq(schema.aiCatalogModels.id, catalogModelId))
        .get()
    : null;
  let customModel = customModelId
    ? executor
        .select()
        .from(schema.aiConnectionCustomModels)
        .where(eq(schema.aiConnectionCustomModels.id, customModelId))
        .get()
    : null;

  invariant(connectionId == null || connection, "未找到 AI 连接。");
  invariant(catalogModelId == null || catalogModel, "未找到目录模型。");
  invariant(customModelId == null || customModel, "未找到自定义模型。");

  if (!connection && customModel) {
    connection = executor
      .select()
      .from(schema.aiConnections)
      .where(eq(schema.aiConnections.id, customModel.connectionId))
      .get();
    invariant(connection, "未找到 AI 连接。");
  }

  if (connection && catalogModel) {
    invariant(connection.kind === "registry", "目录模型引用需要 registry 连接。");
    invariant(connection.catalogProviderId === catalogModel.providerId, "目录模型不属于当前连接。");
  }

  if (connection && customModel) {
    invariant(customModel.connectionId === connection.id, "自定义模型不属于当前连接。");
  }

  const modelOrigin =
    input?.modelOrigin ?? (catalogModel ? "catalog" : customModel ? "custom" : null);
  invariant(
    modelOrigin == null || modelOrigin === "catalog" || modelOrigin === "custom",
    "不支持的模型来源。",
  );

  if (catalogModel) {
    invariant(modelOrigin !== "custom", "目录模型引用不能标记为 custom。");
  }
  if (customModel) {
    invariant(modelOrigin !== "catalog", "自定义模型引用不能标记为 catalog。");
  }

  const capabilities = normalizeCapabilities(
    input?.capabilities,
    catalogModel ?? customModel ?? null,
  );
  const pricing = normalizePricing(input?.pricing, catalogModel ?? customModel ?? null);

  return {
    connectionId: connection?.id ?? null,
    catalogModelId: catalogModel?.id ?? null,
    customModelId: customModel?.id ?? null,
    snapshotConnectionName: trimOptionalString(input?.connectionName) ?? connection?.name ?? null,
    snapshotSdkPackage: trimOptionalString(input?.sdkPackage) ?? connection?.sdkPackage ?? null,
    snapshotBaseUrl: trimOptionalString(input?.baseUrl) ?? connection?.baseUrl ?? null,
    snapshotModelOrigin: modelOrigin,
    snapshotModelId:
      trimOptionalString(input?.modelId) ?? catalogModel?.modelId ?? customModel?.modelId ?? null,
    snapshotModelDisplayName:
      trimOptionalString(input?.modelDisplayName) ??
      catalogModel?.displayName ??
      customModel?.displayName ??
      null,
    snapshotModelFamily: trimOptionalString(input?.modelFamily) ?? catalogModel?.family ?? null,
    snapshotCapabilitiesJson: capabilities
      ? serializeRequiredJson(capabilities, "模型能力快照")
      : null,
    snapshotPricingJson: pricing ? serializeRequiredJson(pricing, "模型价格快照") : null,
  };
}

function insertMessage(
  executor: DatabaseExecutor,
  input: {
    projectId: string;
    prevMessageId: string | null;
  } & MessagePayloadInput,
) {
  const selection = normalizeSelectionInput(executor, input.aiSelection);
  const id = createId("ai_msg");
  const createdAt = now();
  executor
    .insert(schema.aiProjectMessages)
    .values({
      id,
      projectId: input.projectId,
      prevMessageId: input.prevMessageId,
      role: input.role,
      contentJson: serializeRequiredJson(input.content, "消息内容"),
      summaryText: normalizeSummaryText(input.summaryText),
      ...selection,
      metadataJson: serializeOptionalJson(input.metadata),
      createdAt,
    })
    .run();

  return mapMessageRow(getProjectMessageOrThrow(executor, input.projectId, id));
}

export function listProjectHeads(projectId: string, options?: { archived?: boolean }) {
  getProjectOrThrow(db, projectId);
  const archived = options?.archived;
  const rows = db
    .select()
    .from(schema.aiProjectHeads)
    .where(
      archived == null
        ? eq(schema.aiProjectHeads.projectId, projectId)
        : and(
            eq(schema.aiProjectHeads.projectId, projectId),
            eq(schema.aiProjectHeads.isArchived, archived),
          ),
    )
    .orderBy(desc(schema.aiProjectHeads.updatedAt), desc(schema.aiProjectHeads.createdAt))
    .all();
  return rows.map(mapHeadRow);
}

export function resolveProjectMainHead(projectId: string) {
  getProjectOrThrow(db, projectId);
  const row = db
    .select()
    .from(schema.aiProjectHeads)
    .where(
      and(
        eq(schema.aiProjectHeads.projectId, projectId),
        eq(schema.aiProjectHeads.isArchived, false),
      ),
    )
    .orderBy(desc(schema.aiProjectHeads.updatedAt), desc(schema.aiProjectHeads.createdAt))
    .get();
  return row ? mapHeadRow(row) : null;
}

export function listProjectRoots(projectId: string) {
  getProjectOrThrow(db, projectId);
  return db
    .select()
    .from(schema.aiProjectMessages)
    .where(
      and(
        eq(schema.aiProjectMessages.projectId, projectId),
        isNull(schema.aiProjectMessages.prevMessageId),
      ),
    )
    .orderBy(schema.aiProjectMessages.createdAt)
    .all()
    .map(mapMessageRow);
}

export function listHeadChildren(projectId: string, messageId: string) {
  getProjectMessageOrThrow(db, projectId, messageId);
  return db
    .select()
    .from(schema.aiProjectMessages)
    .where(
      and(
        eq(schema.aiProjectMessages.projectId, projectId),
        eq(schema.aiProjectMessages.prevMessageId, messageId),
      ),
    )
    .orderBy(schema.aiProjectMessages.createdAt)
    .all()
    .map(mapMessageRow);
}

export function getHeadOrThrowView(headId: string) {
  return mapHeadRow(getHeadOrThrow(db, headId));
}

export function createHead(input: CreateHeadInput) {
  return db.transaction((tx) => {
    getProjectOrThrow(tx, input.projectId);

    const initialMessage = input.initialMessage
      ? insertMessage(tx, {
          projectId: input.projectId,
          prevMessageId: null,
          ...input.initialMessage,
        })
      : null;
    const headId = createId("ai_head");
    const timestamp = now();
    tx.insert(schema.aiProjectHeads)
      .values({
        id: headId,
        projectId: input.projectId,
        name: normalizeHeadName(input.name, initialMessage?.summaryText ?? undefined),
        currentMessageId: initialMessage?.id ?? null,
        forkedFromHeadId: null,
        forkedFromMessageId: null,
        isArchived: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();

    touchProject(tx, input.projectId);
    return mapHeadRow(getHeadOrThrow(tx, headId));
  });
}

export function appendMessage(input: AppendMessageInput) {
  return db.transaction((tx) => {
    getProjectOrThrow(tx, input.projectId);
    const head = getHeadOrThrow(tx, input.headId);
    invariant(head.projectId === input.projectId, "AI 分支不属于当前项目。");
    invariant(
      (head.currentMessageId ?? null) === input.prevMessageId,
      "AI 分支已经推进，请基于最新叶子继续对话。",
    );

    if (input.prevMessageId) {
      getProjectMessageOrThrow(tx, input.projectId, input.prevMessageId);
    }

    const message = insertMessage(tx, input);
    tx.update(schema.aiProjectHeads)
      .set({
        currentMessageId: message.id,
        updatedAt: now(),
      })
      .where(eq(schema.aiProjectHeads.id, head.id))
      .run();

    touchProject(tx, input.projectId);
    return message;
  });
}

export function resolveHeadMessages(headId: string) {
  const head = getHeadOrThrow(db, headId);
  if (!head.currentMessageId) {
    return [] as AiProjectMessageView[];
  }

  const chain: AiProjectMessageRow[] = [];
  const seen = new Set<string>();
  let currentId: string | null = head.currentMessageId;

  while (currentId) {
    invariant(!seen.has(currentId), "AI 消息链存在循环。");
    seen.add(currentId);
    const row = getMessageOrThrow(db, currentId);
    invariant(row.projectId === head.projectId, "AI 分支引用了其他项目的消息。");
    chain.push(row);
    currentId = row.prevMessageId;
  }

  return chain.reverse().map(mapMessageRow);
}

export function listHeadGenerationAttempts(headId: string) {
  const head = getHeadOrThrow(db, headId);
  return db
    .select()
    .from(schema.aiProjectGenerationAttempts)
    .where(eq(schema.aiProjectGenerationAttempts.headId, head.id))
    .orderBy(schema.aiProjectGenerationAttempts.createdAt)
    .all()
    .map(mapAttemptRow);
}

export function hasPendingGenerationAttempt(headId: string) {
  getHeadOrThrow(db, headId);
  const pending = db
    .select({ id: schema.aiProjectGenerationAttempts.id })
    .from(schema.aiProjectGenerationAttempts)
    .where(
      and(
        eq(schema.aiProjectGenerationAttempts.headId, headId),
        eq(schema.aiProjectGenerationAttempts.status, "pending"),
      ),
    )
    .get();
  return pending != null;
}

export function forkHeadFromMessage(input: ForkHeadFromMessageInput) {
  return db.transaction((tx) => {
    getProjectOrThrow(tx, input.projectId);
    const sourceHead = getHeadOrThrow(tx, input.sourceHeadId);
    invariant(sourceHead.projectId === input.projectId, "源 AI 分支不属于当前项目。");
    const sourceMessage = getProjectMessageOrThrow(tx, input.projectId, input.sourceMessageId);
    const replacementMessage = insertMessage(tx, {
      projectId: input.projectId,
      prevMessageId: sourceMessage.prevMessageId,
      role: input.role,
      content: input.content,
      summaryText: input.summaryText,
      aiSelection: input.aiSelection,
      metadata: input.metadata,
    });
    const headId = createId("ai_head");
    const timestamp = now();

    tx.insert(schema.aiProjectHeads)
      .values({
        id: headId,
        projectId: input.projectId,
        name: normalizeHeadName(
          input.name,
          replacementMessage.summaryText ?? `${sourceHead.name} 修订`,
        ),
        currentMessageId: replacementMessage.id,
        forkedFromHeadId: sourceHead.id,
        forkedFromMessageId: sourceMessage.id,
        isArchived: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();

    touchProject(tx, input.projectId);
    return mapHeadRow(getHeadOrThrow(tx, headId));
  });
}

export function archiveHead(headId: string, archived: boolean) {
  return db.transaction((tx) => {
    const head = getHeadOrThrow(tx, headId);
    tx.update(schema.aiProjectHeads)
      .set({ isArchived: archived, updatedAt: now() })
      .where(eq(schema.aiProjectHeads.id, headId))
      .run();
    touchProject(tx, head.projectId);
    return mapHeadRow(getHeadOrThrow(tx, headId));
  });
}

export function recordGenerationAttempt(input: RecordGenerationAttemptInput) {
  return db.transaction((tx) => {
    getProjectOrThrow(tx, input.projectId);
    if (input.headId) {
      const head = getHeadOrThrow(tx, input.headId);
      invariant(head.projectId === input.projectId, "AI 分支不属于当前项目。");
    }
    if (input.triggerMessageId) {
      getProjectMessageOrThrow(tx, input.projectId, input.triggerMessageId);
    }

    const id = createId("ai_attempt");
    const selection = normalizeSelectionInput(tx, input.aiSelection);
    const createdAt = now();

    tx.insert(schema.aiProjectGenerationAttempts)
      .values({
        id,
        projectId: input.projectId,
        headId: trimOptionalString(input.headId),
        triggerMessageId: trimOptionalString(input.triggerMessageId),
        assistantMessageId: null,
        status: "pending",
        requestJson: serializeRequiredJson(input.request, "AI 请求"),
        usageJson: null,
        errorJson: null,
        ...selection,
        createdAt,
        completedAt: null,
      })
      .run();

    touchProject(tx, input.projectId);
    return mapAttemptRow(getAttemptOrThrow(tx, id));
  });
}

export function completeGenerationAttemptSuccess(input: CompleteGenerationAttemptSuccessInput) {
  return db.transaction((tx) => {
    const attempt = getAttemptOrThrow(tx, input.attemptId);
    if (input.assistantMessageId) {
      getProjectMessageOrThrow(tx, attempt.projectId, input.assistantMessageId);
    }
    tx.update(schema.aiProjectGenerationAttempts)
      .set({
        status: "success",
        assistantMessageId: trimOptionalString(input.assistantMessageId),
        usageJson: serializeOptionalJson(input.usage),
        errorJson: null,
        completedAt: now(),
      })
      .where(eq(schema.aiProjectGenerationAttempts.id, input.attemptId))
      .run();

    touchProject(tx, attempt.projectId);
    return mapAttemptRow(getAttemptOrThrow(tx, input.attemptId));
  });
}

export function completeGenerationAttemptError(input: CompleteGenerationAttemptErrorInput) {
  return db.transaction((tx) => {
    const attempt = getAttemptOrThrow(tx, input.attemptId);
    tx.update(schema.aiProjectGenerationAttempts)
      .set({
        status: "error",
        usageJson: serializeOptionalJson(input.usage),
        errorJson: serializeRequiredJson(input.error, "AI 错误"),
        completedAt: now(),
      })
      .where(eq(schema.aiProjectGenerationAttempts.id, input.attemptId))
      .run();

    touchProject(tx, attempt.projectId);
    return mapAttemptRow(getAttemptOrThrow(tx, input.attemptId));
  });
}

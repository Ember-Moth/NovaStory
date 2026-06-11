import { stepCountIs, streamText, type ModelMessage } from "ai";
import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import {
  appendAssistantTextDelta,
  appendAssistantReasoningDelta,
  appendAssistantReasoningPart,
  appendAssistantToolCallPart,
  appendRunEvent,
  appendUserNode,
  archiveThread,
  assignThreadNodeSourceStepIds,
  createArtifact,
  createReplacementNode,
  createRun,
  createRunStep,
  createStreamingAssistantNode,
  createStreamingToolResultNode,
  createThread,
  getNodeCandidates,
  getRunTrace,
  getThreadView,
  hasPendingRun,
  listChildRuns,
  listThreads,
  markRunFailed,
  markRunSucceeded,
  markThreadNodePartsDone,
  PROJECT_ASSISTANT_AGENT_PROFILE,
  renameThread,
  resolveThreadPath,
  resolveActiveThread,
  selectActiveTip,
  setActiveThread,
} from "@/modules/ai/domain/logs";
import type {
  AgentRunTraceView,
  AgentRunView,
  AgentThreadNodeView,
  AgentThreadStateView,
  AgentThreadView,
  AiConnectionRow,
  AiResolvedModelView,
  AiSelectionSnapshotInput,
  ProjectAssistantContextSnapshot,
  ProjectAssistantStreamEvent,
  ProjectAssistantStreamToolStatus,
  ProjectAssistantToolName,
} from "@/modules/ai/domain/types";
import {
  PROJECT_ASSISTANT_READ_ONLY_TOOL_NAMES,
  PROJECT_ASSISTANT_TOOL_NAMES,
} from "@/modules/ai/domain/types";
import { listResolvedModelsForConnection } from "@/modules/ai/domain/catalog";
import {
  getAiAssistantModelSelection,
  type AiAssistantModelSelection,
} from "@/modules/config/domain/ai-assistant-model-selection";
import { invariant } from "@/shared/lib/domain";

import { createAssistantTools } from "./assistant-tools";
import { createLanguageModelForConnection } from "./provider-factories";

export interface ProjectAssistantStateView extends AgentThreadStateView {}

export interface ProjectAssistantSendResult {
  thread: AgentThreadView;
  userNode: AgentThreadNodeView;
  assistantNode: AgentThreadNodeView | null;
  run: AgentRunView;
  state: AgentThreadStateView;
}

export interface ProjectAssistantRetryResult {
  thread: AgentThreadView;
  assistantNode: AgentThreadNodeView | null;
  run: AgentRunView;
  state: AgentThreadStateView;
}

export interface ProjectAssistantEditResult {
  thread: AgentThreadView;
  replacementNode: AgentThreadNodeView;
  assistantNode: AgentThreadNodeView | null;
  run: AgentRunView;
  state: AgentThreadStateView;
}

export interface ProjectAssistantOverview {
  activeThreadId: string | null;
  threads: AgentThreadView[];
  state: AgentThreadStateView;
}

export const PROJECT_ASSISTANT_SYSTEM_PROMPT_ID = "writing-assistant-v2";

const PROJECT_ASSISTANT_SYSTEM_PROMPT = [
  "你是一个小说写作助手。",
  "回答要直接、具体、可执行，优先帮助作者推进写作。",
  "默认优先结合当前编辑上下文理解问题。",
  "仅在当前请求实际启用了工具且确有必要时才调用工具。",
  "如果当前信息不足，可以读取当前项目中的上下文工具。",
  "写入工具只在用户明确要求修改项目内容时使用。",
  "严禁编造未实际读取到的项目数据。",
  "最终只输出给作者看的纯文本答复，不要暴露结构化协议或 JSON。",
].join("\n");

interface AssistantModelSelection {
  storedSelection: AiAssistantModelSelection;
  connection: AiConnectionRow;
  resolvedModel: AiResolvedModelView;
  snapshot: AiSelectionSnapshotInput;
}

type StreamProviderOptions = Parameters<typeof streamText>[0]["providerOptions"];

interface StreamAssistantTextInput {
  projectId: string;
  connection: AiConnectionRow;
  modelId: string;
  system: string | null;
  activeTools: readonly ProjectAssistantToolName[];
  context: ProjectAssistantContextSnapshot | null;
  messages: ModelMessage[];
  providerOptions?: StreamProviderOptions;
}

interface GeneratedAssistantStep {
  stepNumber: number;
  preparedMessages: ModelMessage[];
  model: {
    provider: string;
    modelId: string;
  };
  finishReason: string | undefined;
  rawFinishReason: string | undefined;
  usage: unknown;
  request: {
    body?: unknown;
  };
  response: {
    body?: unknown;
    messages: ModelMessage[];
  };
  providerMetadata: unknown;
  toolCalls: Array<Record<string, unknown>>;
  toolResults: Array<Record<string, unknown>>;
}

type GeneratedAssistantChunk =
  | {
      type: "start-step";
      stepNumber: number;
    }
  | {
      type: "reasoning-start";
      stepNumber: number;
      id: string;
      providerMetadata: unknown;
    }
  | {
      type: "reasoning-delta";
      stepNumber: number;
      id: string;
      delta: string;
      providerMetadata: unknown;
    }
  | {
      type: "reasoning-end";
      stepNumber: number;
      id: string;
      providerMetadata: unknown;
    }
  | {
      type: "text-delta";
      stepNumber: number;
      delta: string;
    }
  | {
      type: "tool-call";
      stepNumber: number;
      toolCall: Record<string, unknown>;
    }
  | {
      type: "tool-result";
      stepNumber: number;
      toolResult: Record<string, unknown>;
    }
  | {
      type: "finish-step";
      stepNumber: number;
      finishReason: string | undefined;
      usage: unknown;
    };

interface StreamAssistantTextResult {
  chunks: AsyncIterable<GeneratedAssistantChunk>;
  text: Promise<string>;
  finishReason: Promise<string | undefined>;
  usage: Promise<unknown>;
  steps: Promise<GeneratedAssistantStep[]>;
}

interface ProjectAssistantDependencies {
  streamAssistantText: (_input: StreamAssistantTextInput) => StreamAssistantTextResult;
  readStoredSelection: () => AiAssistantModelSelection | null;
}

interface StepRuntimeState {
  nodeIds: string[];
  toolCalls: Array<Record<string, unknown>>;
  toolResults: Array<Record<string, unknown>>;
}

interface PreparedProjectAssistantRun<TResult> {
  projectId: string;
  thread: AgentThreadView;
  run: AgentRunView;
  triggerNodeId: string;
  messages: ModelMessage[];
  providerOptions?: StreamProviderOptions;
  system: string;
  transportSystem: string | null;
  selection: AssistantModelSelection;
  context: ProjectAssistantContextSnapshot | null;
  activeTools: ProjectAssistantToolName[];
  initialResult: TResult;
  runStartedEvent: ProjectAssistantStreamEvent;
  buildFinalResult: (_input: {
    run: AgentRunView;
    lastAssistantNode: AgentThreadNodeView | null;
  }) => TResult;
}

interface ProjectAssistantRunHandle<TResult> {
  initialResult: TResult;
  finalResult: Promise<TResult>;
  subscribe: (_listener: (_event: ProjectAssistantStreamEvent) => void) => () => void;
}

function defaultStreamAssistantText({
  projectId,
  connection,
  modelId,
  system,
  activeTools,
  context,
  messages,
  providerOptions,
}: StreamAssistantTextInput): StreamAssistantTextResult {
  const model = createLanguageModelForConnection({ connection, modelId });
  const preparedMessagesByStep: ModelMessage[][] = [];
  const tools =
    activeTools.length > 0
      ? createAssistantTools({
          projectId,
          context,
          activeTools,
        })
      : undefined;
  const result = streamText({
    model,
    messages,
    ...(system == null ? {} : { system }),
    ...(providerOptions == null ? {} : { providerOptions }),
    ...(tools == null ? {} : { tools: tools as any }),
    stopWhen: stepCountIs(5),
    prepareStep: ({ messages: stepMessages, stepNumber }) => {
      preparedMessagesByStep[stepNumber] = stepMessages;
      return undefined;
    },
  });

  async function* chunks(): AsyncIterable<GeneratedAssistantChunk> {
    let currentStepNumber = -1;

    for await (const rawPart of result.fullStream as AsyncIterable<Record<string, unknown>>) {
      const type = Reflect.get(rawPart, "type");
      if (type === "start-step") {
        currentStepNumber += 1;
        yield {
          type: "start-step",
          stepNumber: currentStepNumber,
        };
        continue;
      }

      if (type === "text-delta") {
        yield {
          type: "text-delta",
          stepNumber: currentStepNumber,
          delta: String(Reflect.get(rawPart, "text") ?? ""),
        };
        continue;
      }

      if (type === "reasoning-start") {
        yield {
          type: "reasoning-start",
          stepNumber: currentStepNumber,
          id: String(Reflect.get(rawPart, "id") ?? ""),
          providerMetadata: Reflect.get(rawPart, "providerMetadata") ?? null,
        };
        continue;
      }

      if (type === "reasoning-delta") {
        yield {
          type: "reasoning-delta",
          stepNumber: currentStepNumber,
          id: String(Reflect.get(rawPart, "id") ?? ""),
          delta: String(Reflect.get(rawPart, "text") ?? Reflect.get(rawPart, "delta") ?? ""),
          providerMetadata: Reflect.get(rawPart, "providerMetadata") ?? null,
        };
        continue;
      }

      if (type === "reasoning-end") {
        yield {
          type: "reasoning-end",
          stepNumber: currentStepNumber,
          id: String(Reflect.get(rawPart, "id") ?? ""),
          providerMetadata: Reflect.get(rawPart, "providerMetadata") ?? null,
        };
        continue;
      }

      if (type === "tool-call") {
        yield {
          type: "tool-call",
          stepNumber: currentStepNumber,
          toolCall: rawPart,
        };
        continue;
      }

      if (type === "tool-result" && Reflect.get(rawPart, "preliminary") !== true) {
        yield {
          type: "tool-result",
          stepNumber: currentStepNumber,
          toolResult: rawPart,
        };
        continue;
      }

      if (type === "finish-step") {
        yield {
          type: "finish-step",
          stepNumber: currentStepNumber,
          finishReason:
            typeof Reflect.get(rawPart, "finishReason") === "string"
              ? (Reflect.get(rawPart, "finishReason") as string)
              : undefined,
          usage: Reflect.get(rawPart, "usage"),
        };
      }
    }
  }

  return {
    chunks: chunks(),
    text: Promise.resolve(result.text),
    finishReason: Promise.resolve(result.finishReason),
    usage: Promise.resolve(result.totalUsage),
    steps: Promise.resolve(result.steps).then((steps) =>
      steps.map((step) => ({
        stepNumber: step.stepNumber,
        preparedMessages: preparedMessagesByStep[step.stepNumber] ?? [],
        model: step.model,
        finishReason: step.finishReason,
        rawFinishReason: step.rawFinishReason,
        usage: step.usage,
        request: step.request,
        response: {
          body: step.response.body,
          messages: step.response.messages as ModelMessage[],
        },
        providerMetadata: step.providerMetadata,
        toolCalls: step.toolCalls as Array<Record<string, unknown>>,
        toolResults: step.toolResults as Array<Record<string, unknown>>,
      })),
    ),
  };
}

function normalizeUserText(text: string) {
  const normalized = text.trim();
  invariant(normalized.length > 0, "消息不能为空。");
  return normalized;
}

function normalizeOptionalString(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeProjectAssistantActiveTools(
  activeTools: readonly ProjectAssistantToolName[] | null | undefined,
) {
  if (activeTools == null) {
    return null;
  }

  const knownToolNames = new Set<string>(PROJECT_ASSISTANT_TOOL_NAMES);
  const seen = new Set<ProjectAssistantToolName>();
  const normalized: ProjectAssistantToolName[] = [];

  for (const value of activeTools) {
    invariant(
      typeof value === "string" && knownToolNames.has(value),
      `未知工具：${String(value)}。`,
    );
    const toolName = value as ProjectAssistantToolName;
    if (seen.has(toolName)) {
      continue;
    }
    seen.add(toolName);
    normalized.push(toolName);
  }

  return normalized;
}

function normalizeAssistantContextSnapshot(
  context: ProjectAssistantContextSnapshot | null | undefined,
): ProjectAssistantContextSnapshot | null {
  if (!context) {
    return null;
  }

  return {
    workspaceId: normalizeOptionalString(context.workspaceId),
    activeContentNodeId: normalizeOptionalString(context.activeContentNodeId),
    activeContentTitle: normalizeOptionalString(context.activeContentTitle),
    activeAuxNodeId: normalizeOptionalString(context.activeAuxNodeId),
    activeAuxPath: normalizeOptionalString(context.activeAuxPath),
    activeTimelinePointId: normalizeOptionalString(context.activeTimelinePointId),
    activeTimelineLabel: normalizeOptionalString(context.activeTimelineLabel),
  };
}

function buildContextSection(context: ProjectAssistantContextSnapshot | null) {
  if (!context) {
    return "当前编辑上下文：未提供明确的选中信息。";
  }

  return [
    "当前编辑上下文：",
    `- 工作区 ID：${context.workspaceId ?? "未提供"}`,
    `- 当前正文节点：${context.activeContentTitle ?? "未选中"}${context.activeContentNodeId ? ` (${context.activeContentNodeId})` : ""}`,
    `- 当前辅助资料：${context.activeAuxPath ?? "未选中"}${context.activeAuxNodeId ? ` (${context.activeAuxNodeId})` : ""}`,
    `- 当前时间点：${context.activeTimelineLabel ?? "未选中"}${context.activeTimelinePointId ? ` (${context.activeTimelinePointId})` : ""}`,
  ].join("\n");
}

function buildProjectAssistantSystemPrompt({
  context,
}: {
  context: ProjectAssistantContextSnapshot | null;
}) {
  return [PROJECT_ASSISTANT_SYSTEM_PROMPT, buildContextSection(context)].join("\n\n");
}

function resolveProjectAssistantActiveTools({
  selection,
  activeTools,
}: {
  selection: AssistantModelSelection;
  activeTools?: readonly ProjectAssistantToolName[] | null;
}) {
  const normalizedActiveTools =
    normalizeProjectAssistantActiveTools(activeTools) ??
    (selection.resolvedModel.supportsToolUse ? [...PROJECT_ASSISTANT_READ_ONLY_TOOL_NAMES] : []);
  if (normalizedActiveTools.length > 0) {
    invariant(
      selection.resolvedModel.supportsToolUse,
      "当前模型不支持工具调用，无法启用请求级工具。",
    );
  }
  return normalizedActiveTools;
}

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  return {
    message: "AI 回复生成失败。",
    detail: error,
  };
}

function isOpenAIResponsesConnection(connection: AiConnectionRow) {
  return connection.sdkPackage === "@ai-sdk/openai";
}

function extractResponseId(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const id = Reflect.get(value as Record<string, unknown>, "id");
  return typeof id === "string" && id.trim().length > 0 ? id : null;
}

function getStepResponseId(stepId: string | null | undefined) {
  const normalizedStepId = normalizeOptionalString(stepId);
  if (!normalizedStepId) {
    return null;
  }

  const step = db.query.agentRunSteps
    .findFirst({
      where: eq(schema.agentRunSteps.id, normalizedStepId),
    })
    .sync();
  if (!step?.responseBodyArtifactId) {
    return null;
  }

  const artifact = db.query.agentArtifacts
    .findFirst({
      where: eq(schema.agentArtifacts.id, step.responseBodyArtifactId),
    })
    .sync();
  if (!artifact) {
    return null;
  }

  let body: unknown;
  try {
    body = JSON.parse(artifact.contentJson);
  } catch {
    return null;
  }

  return extractResponseId(body);
}

function resolveAssistantRequest({
  threadId,
  triggerNodeId,
  system,
  selection,
}: {
  threadId: string;
  triggerNodeId: string;
  system: string;
  selection: AssistantModelSelection;
}): {
  messages: ModelMessage[];
  transportSystem: string | null;
  providerOptions?: StreamProviderOptions;
} {
  const path = resolveThreadPath(threadId, triggerNodeId);

  if (!isOpenAIResponsesConnection(selection.connection)) {
    return {
      messages: path.map((node) => node.message),
      transportSystem: system,
      providerOptions: undefined,
    };
  }

  const lastAssistantIndex = [...path].map((node) => node.role).lastIndexOf("assistant");
  const previousAssistant = lastAssistantIndex >= 0 ? path[lastAssistantIndex] : null;
  const previousResponseId = getStepResponseId(previousAssistant?.sourceStepId);
  const messages =
    previousAssistant && previousResponseId
      ? path.slice(lastAssistantIndex + 1).map((node) => node.message)
      : path.map((node) => node.message);
  const openaiOptions = {
    ...(selection.resolvedModel.supportsReasoning ? { reasoningSummary: "auto" } : {}),
    ...(previousResponseId ? { previousResponseId, instructions: system } : {}),
  };

  return {
    messages,
    transportSystem: previousResponseId ? null : system,
    providerOptions:
      Object.keys(openaiOptions).length > 0
        ? ({
            openai: openaiOptions,
          } satisfies NonNullable<StreamProviderOptions>)
        : undefined,
  };
}

function resolveProjectAssistantModelSelection(
  readStoredSelection: () => AiAssistantModelSelection | null,
): AssistantModelSelection {
  const storedSelection = readStoredSelection();
  invariant(storedSelection, "请先在 AI 助手里选择连接和模型。");

  const connection = db.query.aiConnections
    .findFirst({ where: eq(schema.aiConnections.id, storedSelection.connectionId) })
    .sync();
  invariant(connection, "未找到已选择的 AI 连接。");
  invariant(connection.isEnabled, "已选择的 AI 连接已被停用。");

  const resolvedModel = listResolvedModelsForConnection({
    connectionId: connection.id,
  }).find((model) => model.id === storedSelection.modelId);
  invariant(resolvedModel, "未找到已选择的 AI 模型。");
  invariant(resolvedModel.isEnabled, "已选择的 AI 模型已被停用。");

  return {
    storedSelection,
    connection,
    resolvedModel,
    snapshot: {
      connectionId: connection.id,
      catalogModelId: resolvedModel.catalogModelId,
      customModelId: resolvedModel.customModelId,
      connectionName: connection.name,
      sdkPackage: connection.sdkPackage,
      baseUrl: connection.baseUrl,
      modelOrigin: resolvedModel.origin,
      modelId: resolvedModel.modelId,
      modelDisplayName: resolvedModel.displayName,
      modelFamily: resolvedModel.family,
      capabilities: {
        supportsVision: resolvedModel.supportsVision,
        supportsToolUse: resolvedModel.supportsToolUse,
        supportsReasoning: resolvedModel.supportsReasoning,
        supportsTemperature: resolvedModel.supportsTemperature,
      },
      pricing: {
        inputPricePer1m: resolvedModel.inputPricePer1m,
        outputPricePer1m: resolvedModel.outputPricePer1m,
      },
    },
  };
}

function buildUserTextMessage(text: string): ModelMessage {
  return {
    role: "user",
    content: [{ type: "text", text }],
  };
}

function extractAssistantText(node: AgentThreadNodeView | null) {
  if (!node) {
    return null;
  }
  const content = (node.message as { content?: unknown }).content;
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return null;
  }
  const text = content
    .flatMap((part) => {
      if (!part || typeof part !== "object") {
        return [];
      }
      return Reflect.get(part as Record<string, unknown>, "type") === "text"
        ? [Reflect.get(part as Record<string, unknown>, "text")]
        : [];
    })
    .find((value): value is string => typeof value === "string" && value.trim().length > 0);
  return text?.trim() ?? null;
}

function summarizeToolCall(toolCall: Record<string, unknown>) {
  const toolName = Reflect.get(toolCall, "toolName");
  return typeof toolName === "string" ? `调用工具：${toolName}` : "调用工具";
}

function summarizeToolResult(toolResult: Record<string, unknown>) {
  const toolName = Reflect.get(toolResult, "toolName");
  const toolCallId = Reflect.get(toolResult, "toolCallId");
  const output = Reflect.get(toolResult, "output");
  const nestedOutput =
    output && typeof output === "object"
      ? Reflect.get(output as Record<string, unknown>, "value")
      : null;
  const isError =
    (output &&
      typeof output === "object" &&
      Reflect.get(output as Record<string, unknown>, "ok") === false) ||
    (nestedOutput &&
      typeof nestedOutput === "object" &&
      Reflect.get(nestedOutput as Record<string, unknown>, "ok") === false);
  const prefix = typeof toolName === "string" ? toolName : "工具";
  const suffix = isError ? "失败" : "完成";
  const detail = typeof toolCallId === "string" ? ` (${toolCallId})` : "";
  return `${prefix}${detail}${suffix}`;
}

function getToolStatus(toolResult: Record<string, unknown>): ProjectAssistantStreamToolStatus {
  const output = Reflect.get(toolResult, "output");
  if (
    output &&
    typeof output === "object" &&
    Reflect.get(output as Record<string, unknown>, "ok") === false
  ) {
    return "error";
  }
  const value =
    output && typeof output === "object"
      ? Reflect.get(output as Record<string, unknown>, "value")
      : null;
  if (
    value &&
    typeof value === "object" &&
    Reflect.get(value as Record<string, unknown>, "ok") === false
  ) {
    return "error";
  }
  return "success";
}

function assertNoPendingRunForThread(thread: AgentThreadView) {
  invariant(!hasPendingRun(thread.id), "当前会话正在生成回复，请稍后再试。");
}

function findLastAssistantNode(state: AgentThreadStateView) {
  for (let index = state.activePath.length - 1; index >= 0; index -= 1) {
    const node = state.activePath[index];
    if (node?.role === "assistant") {
      return node;
    }
  }
  return null;
}

class BufferedEventRelay<TResult> implements ProjectAssistantRunHandle<TResult> {
  readonly initialResult: TResult;
  readonly finalResult: Promise<TResult>;

  private readonly history: ProjectAssistantStreamEvent[] = [];
  private readonly listeners = new Set<(_event: ProjectAssistantStreamEvent) => void>();

  constructor(initialResult: TResult, finalResult: Promise<TResult>) {
    this.initialResult = initialResult;
    this.finalResult = finalResult;
  }

  emit(event: ProjectAssistantStreamEvent) {
    this.history.push(event);
    this.listeners.forEach((listener) => listener(event));
  }

  subscribe(listener: (_event: ProjectAssistantStreamEvent) => void) {
    this.history.forEach((event) => listener(event));
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

function createAbortPromise(signal: AbortSignal) {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

function ensureCurrentAssistantNode({
  prepared,
  stepRuntime,
  currentParentId,
  relay,
  stepNumber,
  assistantTextByNodeId,
}: {
  prepared: PreparedProjectAssistantRun<unknown>;
  stepRuntime: StepRuntimeState;
  currentParentId: string | null;
  relay: BufferedEventRelay<unknown>;
  stepNumber: number;
  assistantTextByNodeId: Map<string, string>;
}) {
  const assistantNode = createStreamingAssistantNode({
    threadId: prepared.thread.id,
    parentNodeId: currentParentId,
    runId: prepared.run.id,
  });
  stepRuntime.nodeIds.push(assistantNode.id);
  assistantTextByNodeId.set(assistantNode.id, "");
  appendRunEvent({
    runId: prepared.run.id,
    eventKind: "node-materialized",
    nodeId: assistantNode.id,
    summaryText: assistantNode.summaryText ?? "assistant node",
  });
  relay.emit({
    type: "assistant-message-started",
    nodeId: assistantNode.id,
    parentNodeId: assistantNode.parentNodeId,
    stepIndex: stepNumber,
  });
  return assistantNode;
}

function persistStepArtifactsAndEvents({
  run,
  system,
  steps,
  stepRuntime,
}: {
  run: AgentRunView;
  system: string;
  steps: GeneratedAssistantStep[];
  stepRuntime: Map<number, StepRuntimeState>;
}) {
  for (const step of steps) {
    const preparedMessagesArtifact = createArtifact({
      runId: run.id,
      artifactKind: "prepared-model-messages",
      visibility: "internal",
      content: step.preparedMessages,
      summaryText: `step ${step.stepNumber} 输入消息`,
    });
    const responseMessagesArtifact = createArtifact({
      runId: run.id,
      artifactKind: "response-messages",
      visibility: "internal",
      content: step.response.messages,
      summaryText: `step ${step.stepNumber} 响应消息`,
    });
    const requestBodyArtifact = createArtifact({
      runId: run.id,
      artifactKind: "request-body",
      visibility: "internal",
      content: step.request.body ?? null,
      summaryText: `step ${step.stepNumber} provider request`,
    });
    const responseBodyArtifact = createArtifact({
      runId: run.id,
      artifactKind: "response-body",
      visibility: "internal",
      content: step.response.body ?? null,
      summaryText: `step ${step.stepNumber} provider response`,
    });
    const providerMetadataArtifact = createArtifact({
      runId: run.id,
      artifactKind: "provider-metadata",
      visibility: "internal",
      content: step.providerMetadata ?? null,
      summaryText: `step ${step.stepNumber} provider metadata`,
    });

    const stepRecord = createRunStep({
      runId: run.id,
      stepIndex: step.stepNumber,
      provider: step.model.provider,
      modelId: step.model.modelId,
      finishReason: step.finishReason ?? null,
      rawFinishReason: step.rawFinishReason ?? null,
      system,
      preparedMessagesArtifactId: preparedMessagesArtifact.id,
      responseMessagesArtifactId: responseMessagesArtifact.id,
      requestBodyArtifactId: requestBodyArtifact.id,
      responseBodyArtifactId: responseBodyArtifact.id,
      providerMetadataArtifactId: providerMetadataArtifact.id,
      usage: step.usage ?? null,
    });

    const runtime = stepRuntime.get(step.stepNumber);
    assignThreadNodeSourceStepIds(runtime?.nodeIds ?? [], stepRecord.id);

    appendRunEvent({
      runId: run.id,
      stepId: stepRecord.id,
      eventKind: "step-started",
      summaryText: `step ${step.stepNumber} started`,
    });
    appendRunEvent({
      runId: run.id,
      stepId: stepRecord.id,
      eventKind: "provider-requested",
      summaryText: `step ${step.stepNumber} provider request`,
      payloadArtifactId: requestBodyArtifact.id,
    });
    appendRunEvent({
      runId: run.id,
      stepId: stepRecord.id,
      eventKind: "provider-responded",
      summaryText: `step ${step.stepNumber} provider response`,
      payloadArtifactId: responseBodyArtifact.id,
    });

    for (const toolCall of runtime?.toolCalls ?? step.toolCalls) {
      const payloadArtifact = createArtifact({
        runId: run.id,
        stepId: stepRecord.id,
        artifactKind: "tool-input",
        visibility: "internal",
        content: toolCall,
        summaryText: summarizeToolCall(toolCall),
      });
      appendRunEvent({
        runId: run.id,
        stepId: stepRecord.id,
        eventKind: "tool-call-started",
        relatedToolCallId:
          typeof Reflect.get(toolCall, "toolCallId") === "string"
            ? (Reflect.get(toolCall, "toolCallId") as string)
            : null,
        summaryText: summarizeToolCall(toolCall),
        payloadArtifactId: payloadArtifact.id,
      });
    }

    for (const toolResult of runtime?.toolResults ?? step.toolResults) {
      const payloadArtifact = createArtifact({
        runId: run.id,
        stepId: stepRecord.id,
        artifactKind: "tool-output",
        visibility: "internal",
        content: toolResult,
        summaryText: summarizeToolResult(toolResult),
      });
      appendRunEvent({
        runId: run.id,
        stepId: stepRecord.id,
        eventKind:
          getToolStatus(toolResult) === "error" ? "tool-call-failed" : "tool-call-finished",
        relatedToolCallId:
          typeof Reflect.get(toolResult, "toolCallId") === "string"
            ? (Reflect.get(toolResult, "toolCallId") as string)
            : null,
        summaryText: summarizeToolResult(toolResult),
        payloadArtifactId: payloadArtifact.id,
      });
    }
  }
}

async function executeProjectAssistantRun<TResult>({
  prepared,
  streamAssistantText,
  relay,
}: {
  prepared: PreparedProjectAssistantRun<TResult>;
  streamAssistantText: (_input: StreamAssistantTextInput) => StreamAssistantTextResult;
  relay: BufferedEventRelay<TResult>;
}) {
  let currentParentId = prepared.run.baseTipNodeId;
  let currentAssistantNode: AgentThreadNodeView | null = null;
  let lastAssistantNode: AgentThreadNodeView | null = null;
  const stepRuntime = new Map<number, StepRuntimeState>();
  const assistantTextByNodeId = new Map<string, string>();
  const reasoningPartsByStreamId = new Map<string, { nodeId: string; partIndex: number }>();

  const runtime = streamAssistantText({
    projectId: prepared.projectId,
    connection: prepared.selection.connection,
    modelId: prepared.selection.resolvedModel.modelId,
    system: prepared.transportSystem,
    activeTools: prepared.activeTools,
    context: prepared.context,
    messages: prepared.messages,
    providerOptions: prepared.providerOptions,
  });

  try {
    for await (const chunk of runtime.chunks) {
      if (!stepRuntime.has(chunk.stepNumber)) {
        stepRuntime.set(chunk.stepNumber, {
          nodeIds: [],
          toolCalls: [],
          toolResults: [],
        });
      }
      const currentStepRuntime = stepRuntime.get(chunk.stepNumber)!;

      if (chunk.type === "start-step") {
        currentAssistantNode = null;
        relay.emit({
          type: "step-started",
          stepIndex: chunk.stepNumber,
        });
        continue;
      }

      if (chunk.type === "reasoning-start") {
        if (!currentAssistantNode) {
          currentAssistantNode = ensureCurrentAssistantNode({
            prepared,
            stepRuntime: currentStepRuntime,
            currentParentId,
            relay: relay as BufferedEventRelay<unknown>,
            stepNumber: chunk.stepNumber,
            assistantTextByNodeId,
          });
          currentParentId = currentAssistantNode.id;
          lastAssistantNode = currentAssistantNode;
        }

        const appended = appendAssistantReasoningPart({
          nodeId: currentAssistantNode.id,
          providerMetadata: chunk.providerMetadata,
        });
        currentAssistantNode = appended.node;
        lastAssistantNode = appended.node;
        reasoningPartsByStreamId.set(chunk.id, {
          nodeId: appended.node.id,
          partIndex: appended.partIndex,
        });
        continue;
      }

      if (chunk.type === "reasoning-delta") {
        if (!currentAssistantNode) {
          currentAssistantNode = ensureCurrentAssistantNode({
            prepared,
            stepRuntime: currentStepRuntime,
            currentParentId,
            relay: relay as BufferedEventRelay<unknown>,
            stepNumber: chunk.stepNumber,
            assistantTextByNodeId,
          });
          currentParentId = currentAssistantNode.id;
          lastAssistantNode = currentAssistantNode;
        }

        let activeReasoning = reasoningPartsByStreamId.get(chunk.id);
        if (!activeReasoning) {
          const appended = appendAssistantReasoningPart({
            nodeId: currentAssistantNode.id,
            providerMetadata: chunk.providerMetadata,
          });
          currentAssistantNode = appended.node;
          lastAssistantNode = appended.node;
          activeReasoning = {
            nodeId: appended.node.id,
            partIndex: appended.partIndex,
          };
          reasoningPartsByStreamId.set(chunk.id, activeReasoning);
        }

        const nextAssistantNode = appendAssistantReasoningDelta({
          nodeId: activeReasoning.nodeId,
          partIndex: activeReasoning.partIndex,
          delta: chunk.delta,
          providerMetadata: chunk.providerMetadata,
        });
        currentAssistantNode = nextAssistantNode;
        lastAssistantNode = nextAssistantNode;
        const reasoningText = nextAssistantNode.parts.find(
          (part) => part.partIndex === activeReasoning.partIndex,
        )?.payload;
        const accumulatedText =
          reasoningText && typeof reasoningText === "object"
            ? String(Reflect.get(reasoningText as Record<string, unknown>, "text") ?? "")
            : chunk.delta;
        relay.emit({
          type: "assistant-reasoning-delta",
          nodeId: nextAssistantNode.id,
          reasoningId: chunk.id,
          delta: chunk.delta,
          accumulatedText,
        });
        continue;
      }

      if (chunk.type === "reasoning-end") {
        continue;
      }

      if (chunk.type === "text-delta") {
        if (!currentAssistantNode) {
          currentAssistantNode = ensureCurrentAssistantNode({
            prepared,
            stepRuntime: currentStepRuntime,
            currentParentId,
            relay: relay as BufferedEventRelay<unknown>,
            stepNumber: chunk.stepNumber,
            assistantTextByNodeId,
          });
          currentParentId = currentAssistantNode.id;
          lastAssistantNode = currentAssistantNode;
        }

        const nextAssistantNode = appendAssistantTextDelta({
          nodeId: currentAssistantNode.id,
          delta: chunk.delta,
        });
        currentAssistantNode = nextAssistantNode;
        lastAssistantNode = nextAssistantNode;
        const accumulatedText = `${assistantTextByNodeId.get(nextAssistantNode.id) ?? ""}${chunk.delta}`;
        assistantTextByNodeId.set(nextAssistantNode.id, accumulatedText);
        relay.emit({
          type: "assistant-text-delta",
          nodeId: nextAssistantNode.id,
          delta: chunk.delta,
          accumulatedText,
        });
        continue;
      }

      if (chunk.type === "tool-call") {
        if (!currentAssistantNode) {
          currentAssistantNode = ensureCurrentAssistantNode({
            prepared,
            stepRuntime: currentStepRuntime,
            currentParentId,
            relay: relay as BufferedEventRelay<unknown>,
            stepNumber: chunk.stepNumber,
            assistantTextByNodeId,
          });
          currentParentId = currentAssistantNode.id;
          lastAssistantNode = currentAssistantNode;
        }

        appendAssistantToolCallPart({
          nodeId: currentAssistantNode.id,
          toolCall: chunk.toolCall,
        });
        currentStepRuntime.toolCalls.push(chunk.toolCall);
        relay.emit({
          type: "tool-call",
          assistantNodeId: currentAssistantNode.id,
          toolCallId:
            typeof Reflect.get(chunk.toolCall, "toolCallId") === "string"
              ? (Reflect.get(chunk.toolCall, "toolCallId") as string)
              : null,
          toolName:
            typeof Reflect.get(chunk.toolCall, "toolName") === "string"
              ? (Reflect.get(chunk.toolCall, "toolName") as string)
              : "tool",
          input: Reflect.get(chunk.toolCall, "input") ?? null,
        });
        continue;
      }

      if (chunk.type === "tool-result") {
        const toolNode = createStreamingToolResultNode({
          threadId: prepared.thread.id,
          parentNodeId: currentParentId,
          runId: prepared.run.id,
          toolResult: chunk.toolResult,
        });
        currentParentId = toolNode.id;
        currentStepRuntime.nodeIds.push(toolNode.id);
        currentStepRuntime.toolResults.push(chunk.toolResult);
        appendRunEvent({
          runId: prepared.run.id,
          eventKind: "node-materialized",
          nodeId: toolNode.id,
          summaryText: toolNode.summaryText ?? "tool node",
        });
        relay.emit({
          type: "tool-result",
          toolNodeId: toolNode.id,
          toolCallId:
            typeof Reflect.get(chunk.toolResult, "toolCallId") === "string"
              ? (Reflect.get(chunk.toolResult, "toolCallId") as string)
              : null,
          toolName:
            typeof Reflect.get(chunk.toolResult, "toolName") === "string"
              ? (Reflect.get(chunk.toolResult, "toolName") as string)
              : "tool",
          output: Reflect.get(chunk.toolResult, "output") ?? null,
          status: getToolStatus(chunk.toolResult),
        });
        continue;
      }

      if (chunk.type === "finish-step") {
        if (currentAssistantNode) {
          currentAssistantNode = markThreadNodePartsDone(currentAssistantNode.id);
          lastAssistantNode = currentAssistantNode;
        }
        relay.emit({
          type: "step-finished",
          stepIndex: chunk.stepNumber,
          finishReason: chunk.finishReason,
          usage: chunk.usage,
        });
      }
    }

    const steps = await runtime.steps;
    persistStepArtifactsAndEvents({
      run: prepared.run,
      system: prepared.system,
      steps,
      stepRuntime,
    });

    if (currentParentId) {
      selectActiveTip(prepared.thread.id, currentParentId);
      appendRunEvent({
        runId: prepared.run.id,
        eventKind: "active-tip-moved",
        nodeId: currentParentId,
        summaryText: "切换到新的 active tip",
      });
    }

    const completedRun = markRunSucceeded(prepared.run.id);
    appendRunEvent({
      runId: prepared.run.id,
      eventKind: "run-succeeded",
      summaryText: completedRun.completedAt ? "run succeeded" : "run completed",
    });

    return prepared.buildFinalResult({
      run: completedRun,
      lastAssistantNode,
    });
  } catch (error) {
    const errorArtifact = createArtifact({
      runId: prepared.run.id,
      artifactKind: "error",
      visibility: "internal",
      content: normalizeError(error),
      summaryText: error instanceof Error ? error.message : "run failed",
    });
    const failedRun = markRunFailed(prepared.run.id, errorArtifact.id);
    appendRunEvent({
      runId: failedRun.id,
      eventKind: "run-failed",
      nodeId: prepared.triggerNodeId,
      summaryText: error instanceof Error ? error.message : "run failed",
      payloadArtifactId: errorArtifact.id,
    });
    throw error;
  }
}

function buildSendRun({
  projectId,
  threadId,
  text,
  context,
  activeTools,
  readStoredSelection,
}: {
  projectId: string;
  threadId: string;
  text: string;
  context?: ProjectAssistantContextSnapshot | null;
  activeTools?: readonly ProjectAssistantToolName[] | null;
  readStoredSelection: () => AiAssistantModelSelection | null;
}): PreparedProjectAssistantRun<ProjectAssistantSendResult> {
  const selection = resolveProjectAssistantModelSelection(readStoredSelection);
  const normalizedContext = normalizeAssistantContextSnapshot(context);
  const resolvedActiveTools = resolveProjectAssistantActiveTools({
    selection,
    activeTools,
  });
  const threadView = getThreadView(threadId);
  const thread = threadView.thread;
  invariant(thread, "未找到当前会话。");
  invariant(thread.projectId === projectId, "AI 会话不属于当前项目。");
  invariant(thread.archivedAt == null, "不能向已归档会话发送消息。");
  assertNoPendingRunForThread(thread);

  const userNode = appendUserNode({
    threadId: thread.id,
    parentNodeId: thread.activeTipNodeId,
    message: buildUserTextMessage(normalizeUserText(text)),
    sourceKind: "user_input",
  });
  const run = createRun({
    threadId: thread.id,
    triggerNodeId: userNode.id,
    baseTipNodeId: userNode.id,
    runMode: "send",
    agentProfile: PROJECT_ASSISTANT_AGENT_PROFILE,
    selectionSnapshot: selection.snapshot,
    contextSnapshot: normalizedContext,
  });
  appendRunEvent({
    runId: run.id,
    eventKind: "run-started",
    nodeId: userNode.id,
    summaryText: "用户消息触发新 run",
  });

  const system = buildProjectAssistantSystemPrompt({
    context: normalizedContext,
  });
  const request = resolveAssistantRequest({
    threadId: thread.id,
    triggerNodeId: userNode.id,
    system,
    selection,
  });

  return {
    projectId,
    thread,
    run,
    triggerNodeId: userNode.id,
    messages: request.messages,
    providerOptions: request.providerOptions,
    system,
    transportSystem: request.transportSystem,
    selection,
    context: normalizedContext,
    activeTools: resolvedActiveTools,
    initialResult: {
      thread: getThreadView(thread.id).thread!,
      userNode,
      assistantNode: null,
      run,
      state: getThreadView(thread.id),
    },
    runStartedEvent: {
      type: "run-started",
      run,
      threadId: thread.id,
      triggerNodeId: userNode.id,
      userNode,
    },
    buildFinalResult: ({ run: completedRun, lastAssistantNode }) => ({
      thread: getThreadView(thread.id).thread!,
      userNode,
      assistantNode: lastAssistantNode,
      run: completedRun,
      state: getThreadView(thread.id),
    }),
  };
}

function buildRetryRun({
  projectId,
  threadId,
  triggerNodeId,
  context,
  activeTools,
  readStoredSelection,
}: {
  projectId: string;
  threadId: string;
  triggerNodeId: string;
  context?: ProjectAssistantContextSnapshot | null;
  activeTools?: readonly ProjectAssistantToolName[] | null;
  readStoredSelection: () => AiAssistantModelSelection | null;
}): PreparedProjectAssistantRun<ProjectAssistantRetryResult> {
  const selection = resolveProjectAssistantModelSelection(readStoredSelection);
  const normalizedContext = normalizeAssistantContextSnapshot(context);
  const resolvedActiveTools = resolveProjectAssistantActiveTools({
    selection,
    activeTools,
  });
  const threadView = getThreadView(threadId);
  const thread = threadView.thread;
  invariant(thread, "未找到当前会话。");
  invariant(thread.projectId === projectId, "AI 会话不属于当前项目。");
  invariant(thread.archivedAt == null, "不能重试已归档会话。");
  assertNoPendingRunForThread(thread);

  const triggerNode = threadView.activePath.find((node) => node.id === triggerNodeId);
  invariant(triggerNode, "当前只支持重试 active path 上的节点。");
  invariant(triggerNode.role === "user", "当前版本只能重试用户消息的回复。");

  const run = createRun({
    threadId: thread.id,
    triggerNodeId,
    baseTipNodeId: triggerNodeId,
    runMode: "retry",
    agentProfile: PROJECT_ASSISTANT_AGENT_PROFILE,
    selectionSnapshot: selection.snapshot,
    contextSnapshot: normalizedContext,
  });
  appendRunEvent({
    runId: run.id,
    eventKind: "run-started",
    nodeId: triggerNodeId,
    summaryText: "重试 assistant 候选",
  });

  const system = buildProjectAssistantSystemPrompt({
    context: normalizedContext,
  });
  const request = resolveAssistantRequest({
    threadId: thread.id,
    triggerNodeId,
    system,
    selection,
  });

  return {
    projectId,
    thread,
    run,
    triggerNodeId,
    messages: request.messages,
    providerOptions: request.providerOptions,
    system,
    transportSystem: request.transportSystem,
    selection,
    context: normalizedContext,
    activeTools: resolvedActiveTools,
    initialResult: {
      thread: getThreadView(thread.id).thread!,
      assistantNode: null,
      run,
      state: getThreadView(thread.id),
    },
    runStartedEvent: {
      type: "run-started",
      run,
      threadId: thread.id,
      triggerNodeId,
    },
    buildFinalResult: ({ run: completedRun, lastAssistantNode }) => ({
      thread: getThreadView(thread.id).thread!,
      assistantNode: lastAssistantNode,
      run: completedRun,
      state: getThreadView(thread.id),
    }),
  };
}

function buildEditRun({
  projectId,
  threadId,
  nodeId,
  text,
  context,
  activeTools,
  readStoredSelection,
}: {
  projectId: string;
  threadId: string;
  nodeId: string;
  text: string;
  context?: ProjectAssistantContextSnapshot | null;
  activeTools?: readonly ProjectAssistantToolName[] | null;
  readStoredSelection: () => AiAssistantModelSelection | null;
}): PreparedProjectAssistantRun<ProjectAssistantEditResult> {
  const selection = resolveProjectAssistantModelSelection(readStoredSelection);
  const normalizedContext = normalizeAssistantContextSnapshot(context);
  const resolvedActiveTools = resolveProjectAssistantActiveTools({
    selection,
    activeTools,
  });
  const threadView = getThreadView(threadId);
  const thread = threadView.thread;
  invariant(thread, "未找到当前会话。");
  invariant(thread.projectId === projectId, "AI 会话不属于当前项目。");
  invariant(thread.archivedAt == null, "不能修改已归档会话。");
  assertNoPendingRunForThread(thread);

  const replacementNode = createReplacementNode({
    threadId: thread.id,
    nodeId,
    message: buildUserTextMessage(normalizeUserText(text)),
  });
  const run = createRun({
    threadId: thread.id,
    triggerNodeId: replacementNode.id,
    baseTipNodeId: replacementNode.id,
    runMode: "edit_regenerate",
    agentProfile: PROJECT_ASSISTANT_AGENT_PROFILE,
    selectionSnapshot: selection.snapshot,
    contextSnapshot: normalizedContext,
  });
  appendRunEvent({
    runId: run.id,
    eventKind: "run-started",
    nodeId: replacementNode.id,
    summaryText: "编辑消息并重新生成",
  });

  const system = buildProjectAssistantSystemPrompt({
    context: normalizedContext,
  });
  const request = resolveAssistantRequest({
    threadId: thread.id,
    triggerNodeId: replacementNode.id,
    system,
    selection,
  });

  return {
    projectId,
    thread,
    run,
    triggerNodeId: replacementNode.id,
    messages: request.messages,
    providerOptions: request.providerOptions,
    system,
    transportSystem: request.transportSystem,
    selection,
    context: normalizedContext,
    activeTools: resolvedActiveTools,
    initialResult: {
      thread: getThreadView(thread.id).thread!,
      replacementNode,
      assistantNode: null,
      run,
      state: getThreadView(thread.id),
    },
    runStartedEvent: {
      type: "run-started",
      run,
      threadId: thread.id,
      triggerNodeId: replacementNode.id,
      replacementNode,
    },
    buildFinalResult: ({ run: completedRun, lastAssistantNode }) => ({
      thread: getThreadView(thread.id).thread!,
      replacementNode,
      assistantNode: lastAssistantNode,
      run: completedRun,
      state: getThreadView(thread.id),
    }),
  };
}

export function createProjectAssistantService(
  dependencies: Partial<ProjectAssistantDependencies> = {},
) {
  const streamAssistantTextImpl = dependencies.streamAssistantText ?? defaultStreamAssistantText;
  const readStoredSelection = dependencies.readStoredSelection ?? getAiAssistantModelSelection;
  const activeExecutions = new Map<string, BufferedEventRelay<unknown>>();

  function startExecution<TResult>(prepared: PreparedProjectAssistantRun<TResult>) {
    let resolveFinal!: (_value: TResult) => void;
    let rejectFinal!: (_reason?: unknown) => void;
    const finalResult = new Promise<TResult>((resolve, reject) => {
      resolveFinal = resolve;
      rejectFinal = reject;
    });
    const relay = new BufferedEventRelay(prepared.initialResult, finalResult);
    activeExecutions.set(prepared.run.id, relay as BufferedEventRelay<unknown>);
    relay.emit(prepared.runStartedEvent);
    void executeProjectAssistantRun({
      prepared,
      streamAssistantText: streamAssistantTextImpl,
      relay,
    })
      .then(resolveFinal, rejectFinal)
      .finally(() => {
        activeExecutions.delete(prepared.run.id);
      });
    return relay;
  }

  return {
    getProjectAssistantState(projectId: string): ProjectAssistantOverview {
      const threads = listThreads(projectId, {
        agentProfile: PROJECT_ASSISTANT_AGENT_PROFILE,
      });
      const activeThread = resolveActiveThread(projectId, PROJECT_ASSISTANT_AGENT_PROFILE);
      return {
        activeThreadId: activeThread?.id ?? null,
        threads,
        state: activeThread
          ? getThreadView(activeThread.id)
          : { thread: null, activePath: [], candidateGroups: [], latestRuns: [], runSummaries: [] },
      };
    },

    createProjectAssistantThread(projectId: string) {
      return createThread({
        projectId,
        agentProfile: PROJECT_ASSISTANT_AGENT_PROFILE,
      });
    },

    setProjectAssistantActiveThread(projectId: string, threadId: string) {
      return setActiveThread(projectId, threadId);
    },

    renameProjectAssistantThread(threadId: string, title: string) {
      return renameThread(threadId, title);
    },

    archiveProjectAssistantThread(threadId: string, archived: boolean) {
      return archiveThread(threadId, archived);
    },

    getThreadView(threadId: string) {
      return getThreadView(threadId);
    },

    getRunTrace(runId: string): AgentRunTraceView {
      return getRunTrace(runId);
    },

    getNodeCandidates(parentNodeId: string) {
      return getNodeCandidates(parentNodeId);
    },

    getChildRuns(runId: string) {
      return listChildRuns(runId);
    },

    selectThreadTip(threadId: string, tipNodeId: string) {
      return selectActiveTip(threadId, tipNodeId);
    },

    sendProjectAssistantMessageStream({
      projectId,
      threadId,
      text,
      context,
      activeTools,
    }: {
      projectId: string;
      threadId: string;
      text: string;
      context?: ProjectAssistantContextSnapshot | null;
      activeTools?: readonly ProjectAssistantToolName[] | null;
    }) {
      return startExecution(
        buildSendRun({
          projectId,
          threadId,
          text,
          context,
          activeTools,
          readStoredSelection,
        }),
      );
    },

    retryProjectAssistantMessageStream({
      projectId,
      threadId,
      triggerNodeId,
      context,
      activeTools,
    }: {
      projectId: string;
      threadId: string;
      triggerNodeId: string;
      context?: ProjectAssistantContextSnapshot | null;
      activeTools?: readonly ProjectAssistantToolName[] | null;
    }) {
      return startExecution(
        buildRetryRun({
          projectId,
          threadId,
          triggerNodeId,
          context,
          activeTools,
          readStoredSelection,
        }),
      );
    },

    editProjectAssistantMessageStream({
      projectId,
      threadId,
      nodeId,
      text,
      context,
      activeTools,
    }: {
      projectId: string;
      threadId: string;
      nodeId: string;
      text: string;
      context?: ProjectAssistantContextSnapshot | null;
      activeTools?: readonly ProjectAssistantToolName[] | null;
    }) {
      return startExecution(
        buildEditRun({
          projectId,
          threadId,
          nodeId,
          text,
          context,
          activeTools,
          readStoredSelection,
        }),
      );
    },

    async sendProjectAssistantMessage(args: {
      projectId: string;
      threadId: string;
      text: string;
      context?: ProjectAssistantContextSnapshot | null;
      activeTools?: readonly ProjectAssistantToolName[] | null;
    }): Promise<ProjectAssistantSendResult> {
      return this.sendProjectAssistantMessageStream(args).finalResult;
    },

    async retryProjectAssistantMessage(args: {
      projectId: string;
      threadId: string;
      triggerNodeId: string;
      context?: ProjectAssistantContextSnapshot | null;
      activeTools?: readonly ProjectAssistantToolName[] | null;
    }): Promise<ProjectAssistantRetryResult> {
      return this.retryProjectAssistantMessageStream(args).finalResult;
    },

    async editProjectAssistantMessage(args: {
      projectId: string;
      threadId: string;
      nodeId: string;
      text: string;
      context?: ProjectAssistantContextSnapshot | null;
      activeTools?: readonly ProjectAssistantToolName[] | null;
    }): Promise<ProjectAssistantEditResult> {
      return this.editProjectAssistantMessageStream(args).finalResult;
    },
  };
}

export type ProjectAssistantService = ReturnType<typeof createProjectAssistantService>;

let activeProjectAssistantService: ProjectAssistantService = createProjectAssistantService();

export function getProjectAssistantService() {
  return activeProjectAssistantService;
}

export function setProjectAssistantServiceForTests(service: ProjectAssistantService) {
  activeProjectAssistantService = service;
}

export { createAbortPromise, extractAssistantText, findLastAssistantNode };

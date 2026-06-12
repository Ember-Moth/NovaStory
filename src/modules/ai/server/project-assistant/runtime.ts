import type { ModelMessage } from "ai";
import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { resolveThreadPath } from "@/modules/ai/domain/logs";
import type {
  AgentRunTraceView,
  AgentThreadNodeView,
  AgentThreadStateView,
  AiConnectionRow,
  ProjectAssistantContextSnapshot,
  ProjectAssistantToolName,
} from "@/modules/ai/domain/types";
import {
  PROJECT_ASSISTANT_MAX_STEPS,
  PROJECT_ASSISTANT_READ_ONLY_TOOL_NAMES,
  PROJECT_ASSISTANT_TOOL_NAMES,
} from "@/modules/ai/domain/types";
import { listResolvedModelsForConnection } from "@/modules/ai/domain/catalog";
import {
  getAiAssistantModelSelection,
  type AiAssistantModelSelection,
} from "@/modules/config/domain/ai-assistant-model-selection";
import { invariant } from "@/shared/lib/domain";

import type { ToolRuntimeContext } from "../assistant-tools/context";
import type { AssistantModelSelection, StreamProviderOptions } from "./types-internal";

export const PROJECT_ASSISTANT_SYSTEM_PROMPT_ID = "writing-assistant-v3";

const PROJECT_ASSISTANT_SYSTEM_PROMPT = [
  "你是一个小说写作助手。",
  "回答要直接、具体、可执行，优先帮助作者推进写作。",
  "仅在当前请求实际启用了工具且确有必要时才调用工具。",
  "如果需要了解当前编辑位置、当前正文、辅助资料或当前时间点，请调用当前项目中的上下文或读取工具获取，不要自行假设。",
  "写入工具只在用户明确要求修改项目内容时使用。",
  "严禁编造未实际读取到的项目数据。",
  "最终只输出给作者看的纯文本答复，不要暴露结构化协议或 JSON。",
].join("\n");

export function createToolRuntimeContext(
  snapshot: ProjectAssistantContextSnapshot | null,
): ToolRuntimeContext {
  let currentSnapshot = snapshot;
  return {
    get snapshot() {
      return currentSnapshot;
    },
    updateSnapshot(updater) {
      currentSnapshot = updater(currentSnapshot);
    },
  };
}

export function normalizeUserText(text: string) {
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

export function normalizeAssistantContextSnapshot(
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

export function buildProjectAssistantSystemPrompt() {
  return PROJECT_ASSISTANT_SYSTEM_PROMPT;
}

export function resolveProjectAssistantActiveTools({
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

export function normalizeError(error: unknown) {
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

export function resolveAssistantRequest({
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

export function resolveProjectAssistantModelSelection(
  readStoredSelection: () => AiAssistantModelSelection | null = getAiAssistantModelSelection,
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

export function resolveProjectAssistantModelSelectionFromSnapshot(
  snapshot: unknown,
): AssistantModelSelection {
  invariant(snapshot && typeof snapshot === "object", "原 run 缺少模型选择快照，无法继续。");
  const snapshotRecord = snapshot as AssistantModelSelection["snapshot"];
  const connectionId = normalizeOptionalString(snapshotRecord.connectionId);
  const catalogModelId = normalizeOptionalString(snapshotRecord.catalogModelId);
  const customModelId = normalizeOptionalString(snapshotRecord.customModelId);
  invariant(connectionId, "原 run 缺少连接信息，无法继续。");

  const connection = db.query.aiConnections
    .findFirst({ where: eq(schema.aiConnections.id, connectionId) })
    .sync();
  invariant(connection, "原 run 使用的 AI 连接已不存在，无法继续。");
  invariant(connection.isEnabled, "原 run 使用的 AI 连接已停用，无法继续。");

  const resolvedModel = listResolvedModelsForConnection({
    connectionId: connection.id,
  }).find((model) => {
    if (customModelId) {
      return model.customModelId === customModelId;
    }
    if (catalogModelId) {
      return model.catalogModelId === catalogModelId;
    }
    return model.modelId === normalizeOptionalString(snapshotRecord.modelId);
  });
  invariant(resolvedModel, "原 run 使用的 AI 模型已不存在，无法继续。");
  invariant(resolvedModel.isEnabled, "原 run 使用的 AI 模型已停用，无法继续。");

  return {
    storedSelection: {
      connectionId: connection.id,
      modelId: resolvedModel.id,
    },
    connection,
    resolvedModel,
    snapshot: {
      ...snapshotRecord,
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

export function buildUserTextMessage(text: string): ModelMessage {
  return {
    role: "user",
    content: [{ type: "text", text }],
  };
}

export function extractAssistantText(node: AgentThreadNodeView | null) {
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

export function findLastAssistantNode(state: AgentThreadStateView) {
  for (let index = state.activePath.length - 1; index >= 0; index -= 1) {
    const node = state.activePath[index];
    if (node?.role === "assistant") {
      return node;
    }
  }
  return null;
}

export function createAbortPromise(signal: AbortSignal) {
  if (signal.aborted) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

export function runNeedsContinuation(trace: AgentRunTraceView) {
  const lastStep = trace.steps.at(-1);
  return (
    trace.run.status === "succeeded" &&
    trace.run.activeTools != null &&
    trace.steps.length >= PROJECT_ASSISTANT_MAX_STEPS &&
    lastStep?.finishReason === "tool-calls"
  );
}

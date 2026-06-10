import { generateText } from "ai";
import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { listResolvedModelsForConnection } from "@/modules/ai/domain/catalog";
import {
  appendMessage,
  completeGenerationAttemptError,
  completeGenerationAttemptSuccess,
  createHead,
  hasPendingGenerationAttempt,
  listHeadGenerationAttempts,
  recordGenerationAttempt,
  resolveHeadMessages,
  resolveProjectMainHead,
} from "@/modules/ai/domain/logs";
import type {
  AiConnectionRow,
  AiProjectGenerationAttemptView,
  AiProjectHeadView,
  AiProjectMessageView,
  AiResolvedModelView,
  AiSelectionSnapshotInput,
} from "@/modules/ai/domain/types";
import {
  getAiAssistantModelSelection,
  type AiAssistantModelSelection,
} from "@/modules/config/domain/ai-assistant-model-selection";
import { invariant } from "@/shared/lib/domain";

import { createLanguageModelForConnection } from "./provider-factories";

export interface AiAssistantTextMessageContent {
  text: string;
}

export interface ProjectAssistantStateView {
  head: AiProjectHeadView | null;
  messages: AiProjectMessageView[];
  attempts: AiProjectGenerationAttemptView[];
}

export interface ProjectAssistantSendResult {
  head: AiProjectHeadView;
  userMessage: AiProjectMessageView;
  assistantMessage: AiProjectMessageView;
  attempt: AiProjectGenerationAttemptView;
}

export interface ProjectAssistantRetryResult {
  head: AiProjectHeadView;
  assistantMessage: AiProjectMessageView;
  attempt: AiProjectGenerationAttemptView;
}

export const PROJECT_ASSISTANT_SYSTEM_PROMPT_ID = "writing-assistant-v1";

const PROJECT_ASSISTANT_SYSTEM_PROMPT = [
  "你是一个小说写作助手。",
  "回答要直接、具体、可执行，优先帮助作者推进写作。",
  "当前版本只需要输出纯文本，不要使用工具调用，也不要返回结构化协议。",
].join("\n");

interface AssistantModelSelection {
  storedSelection: AiAssistantModelSelection;
  connection: AiConnectionRow;
  resolvedModel: AiResolvedModelView;
  snapshot: AiSelectionSnapshotInput;
}

interface GenerateAssistantTextInput {
  connection: AiConnectionRow;
  modelId: string;
  system: string;
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
}

interface GenerateAssistantTextResult {
  text: string;
  usage: unknown;
  finishReason: string | undefined;
}

interface ProjectAssistantDependencies {
  generateAssistantText: (
    _input: GenerateAssistantTextInput,
  ) => Promise<GenerateAssistantTextResult>;
  readStoredSelection: () => AiAssistantModelSelection | null;
}

function defaultGenerateAssistantText({
  connection,
  modelId,
  system,
  messages,
}: GenerateAssistantTextInput): Promise<GenerateAssistantTextResult> {
  return generateText({
    model: createLanguageModelForConnection({ connection, modelId }),
    system,
    messages,
  }).then((result) => ({
    text: result.text,
    usage: result.usage,
    finishReason: result.finishReason,
  }));
}

function getTextMessageContent(content: unknown): string {
  invariant(content != null && typeof content === "object", "AI 消息内容格式不支持。");
  const text = Reflect.get(content as Record<string, unknown>, "text");
  invariant(typeof text === "string", "AI 消息内容缺少文本字段。");
  return text;
}

function buildSummaryText(text: string) {
  const summary = text.trim().replace(/\s+/g, " ");
  return summary.length <= 80 ? summary : `${summary.slice(0, 80)}…`;
}

function normalizeUserText(text: string) {
  const normalized = text.trim();
  invariant(normalized.length > 0, "消息不能为空。");
  return normalized;
}

function normalizeAssistantText(text: string) {
  const normalized = text.trim();
  invariant(normalized.length > 0, "AI 没有返回可显示的文本。");
  return normalized;
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

function resolveOrCreateMainHead(projectId: string) {
  return (
    resolveProjectMainHead(projectId) ??
    createHead({
      projectId,
      name: "主会话",
    })
  );
}

function getHeadState(head: AiProjectHeadView | null): ProjectAssistantStateView {
  if (!head) {
    return {
      head: null,
      messages: [],
      attempts: [],
    };
  }

  return {
    head,
    messages: resolveHeadMessages(head.id),
    attempts: listHeadGenerationAttempts(head.id),
  };
}

function toPromptMessages(messages: AiProjectMessageView[]) {
  return messages.map((message) => {
    invariant(message.role !== "tool", "当前版本不支持包含工具消息的对话。");
    return {
      role: message.role,
      content: getTextMessageContent(message.content),
    };
  });
}

function buildAttemptRequest({
  mode,
  headId,
  triggerMessageId,
  selection,
}: {
  mode: "send" | "retry";
  headId: string;
  triggerMessageId: string;
  selection: AssistantModelSelection;
}) {
  return {
    mode,
    triggerMessageId,
    headId,
    systemPromptId: PROJECT_ASSISTANT_SYSTEM_PROMPT_ID,
    toolMode: "none" as const,
    contextMode: "none" as const,
    modelSelection: {
      connectionId: selection.connection.id,
      resolvedModelId: selection.storedSelection.modelId,
      providerModelId: selection.resolvedModel.modelId,
      modelOrigin: selection.resolvedModel.origin,
    },
  };
}

function assertNoPendingAttempt(head: AiProjectHeadView) {
  invariant(!hasPendingGenerationAttempt(head.id), "当前会话正在生成回复，请稍后再试。");
}

export function createProjectAssistantService(
  dependencies: Partial<ProjectAssistantDependencies> = {},
) {
  const generateAssistantTextImpl =
    dependencies.generateAssistantText ?? defaultGenerateAssistantText;
  const readStoredSelection = dependencies.readStoredSelection ?? getAiAssistantModelSelection;

  return {
    getProjectAssistantState(projectId: string): ProjectAssistantStateView {
      return getHeadState(resolveProjectMainHead(projectId));
    },

    async sendProjectAssistantMessage({
      projectId,
      text,
    }: {
      projectId: string;
      text: string;
    }): Promise<ProjectAssistantSendResult> {
      const selection = resolveProjectAssistantModelSelection(readStoredSelection);
      const head = resolveOrCreateMainHead(projectId);
      assertNoPendingAttempt(head);

      const normalizedText = normalizeUserText(text);
      const userMessage = appendMessage({
        projectId,
        headId: head.id,
        prevMessageId: head.currentMessageId,
        role: "user",
        content: { text: normalizedText },
        summaryText: buildSummaryText(normalizedText),
        aiSelection: selection.snapshot,
      });

      const attempt = recordGenerationAttempt({
        projectId,
        headId: head.id,
        triggerMessageId: userMessage.id,
        request: buildAttemptRequest({
          mode: "send",
          headId: head.id,
          triggerMessageId: userMessage.id,
          selection,
        }),
        aiSelection: selection.snapshot,
      });

      try {
        const result = await generateAssistantTextImpl({
          connection: selection.connection,
          modelId: selection.resolvedModel.modelId,
          system: PROJECT_ASSISTANT_SYSTEM_PROMPT,
          messages: toPromptMessages(resolveHeadMessages(head.id)),
        });
        const assistantText = normalizeAssistantText(result.text);
        const assistantMessage = appendMessage({
          projectId,
          headId: head.id,
          prevMessageId: userMessage.id,
          role: "assistant",
          content: { text: assistantText },
          summaryText: buildSummaryText(assistantText),
          aiSelection: selection.snapshot,
          metadata: {
            finishReason: result.finishReason,
          },
        });
        const completedAttempt = completeGenerationAttemptSuccess({
          attemptId: attempt.id,
          assistantMessageId: assistantMessage.id,
          usage: result.usage,
        });

        return {
          head: resolveProjectMainHead(projectId)!,
          userMessage,
          assistantMessage,
          attempt: completedAttempt,
        };
      } catch (error) {
        completeGenerationAttemptError({
          attemptId: attempt.id,
          error: normalizeError(error),
        });
        throw error;
      }
    },

    async retryProjectAssistantMessage({
      projectId,
      triggerMessageId,
    }: {
      projectId: string;
      triggerMessageId: string;
    }): Promise<ProjectAssistantRetryResult> {
      const selection = resolveProjectAssistantModelSelection(readStoredSelection);
      const head = resolveProjectMainHead(projectId);
      invariant(head, "当前项目还没有 AI 会话可供重试。");
      assertNoPendingAttempt(head);
      invariant(head.currentMessageId === triggerMessageId, "当前版本只能重试会话末尾的失败请求。");

      const messages = resolveHeadMessages(head.id);
      const triggerMessage = messages.at(-1);
      invariant(triggerMessage?.id === triggerMessageId, "未找到要重试的触发消息。");
      invariant(triggerMessage.role === "user", "当前版本只能重试用户消息的回复。");

      const attempt = recordGenerationAttempt({
        projectId,
        headId: head.id,
        triggerMessageId,
        request: buildAttemptRequest({
          mode: "retry",
          headId: head.id,
          triggerMessageId,
          selection,
        }),
        aiSelection: selection.snapshot,
      });

      try {
        const result = await generateAssistantTextImpl({
          connection: selection.connection,
          modelId: selection.resolvedModel.modelId,
          system: PROJECT_ASSISTANT_SYSTEM_PROMPT,
          messages: toPromptMessages(messages),
        });
        const assistantText = normalizeAssistantText(result.text);
        const assistantMessage = appendMessage({
          projectId,
          headId: head.id,
          prevMessageId: triggerMessageId,
          role: "assistant",
          content: { text: assistantText },
          summaryText: buildSummaryText(assistantText),
          aiSelection: selection.snapshot,
          metadata: {
            finishReason: result.finishReason,
          },
        });
        const completedAttempt = completeGenerationAttemptSuccess({
          attemptId: attempt.id,
          assistantMessageId: assistantMessage.id,
          usage: result.usage,
        });

        return {
          head: resolveProjectMainHead(projectId)!,
          assistantMessage,
          attempt: completedAttempt,
        };
      } catch (error) {
        completeGenerationAttemptError({
          attemptId: attempt.id,
          error: normalizeError(error),
        });
        throw error;
      }
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

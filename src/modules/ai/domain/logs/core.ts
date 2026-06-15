import type { ModelMessage } from "ai";

import {
  findProjectIdForNodeSync,
  findProjectIdForRunSync,
  findProjectIdForThreadSync,
  readAiIndexSync,
} from "@/modules/ai/domain/ai-index-store";
import { getAiAssistantMaxSteps } from "@/modules/config/domain/ai-assistant-options";
import { createId, invariant, now } from "@/shared/lib/domain";
import {
  listProjectRowsSync,
  readProjectMetaSync,
  updateProjectMetaSync,
} from "@/modules/workspace/domain/git-storage/project-meta-store";
import {
  aiRunsRef,
  commitCustomRefSync,
  readFilesAtRefSync,
} from "@/modules/workspace/domain/git-storage/git-store";
import { parseJsonl, stringifyJsonl } from "@/modules/workspace/domain/git-storage/jsonl";
import type { AiIndexPayload } from "../ai-index-store";
import type {
  AgentArtifactKind,
  AgentArtifactRow,
  AgentArtifactView,
  AgentCandidateGroupView,
  AgentMessagePartRow,
  AgentPartState,
  AgentProjectStateRow,
  AgentProjectStateView,
  AgentRunEventKind,
  AgentRunEventRow,
  AgentRunEventView,
  AgentRunInputRefRow,
  AgentRunMode,
  AgentRunRow,
  AgentRunStatus,
  AgentRunStepRow,
  AgentRunStepView,
  AgentRunSummaryView,
  AgentRunTraceView,
  AgentRunView,
  AssistantInputRefSnapshot,
  AgentThreadNodePartKind,
  AgentThreadNodePartView,
  AgentThreadNodeRow,
  AgentThreadNodeSourceKind,
  AgentThreadNodeView,
  AgentThreadRole,
  AgentThreadRow,
  AgentThreadView,
  AgentVisibility,
  ProjectAssistantContextSnapshot,
  ProjectAssistantToolName,
} from "../types";

export const PROJECT_ASSISTANT_AGENT_PROFILE = "project-assistant";

export interface CreateThreadInput {
  projectId: string;
  agentProfile?: string;
  title?: string | null;
}

export interface CreateNodeInput {
  threadId: string;
  parentNodeId: string | null;
  message: ModelMessage;
  sourceKind: AgentThreadNodeSourceKind;
  createdByRunId?: string | null;
  sourceStepId?: string | null;
  summaryText?: string | null;
  extraParts?: CreateNodeExtraPartInput[];
}

export interface CreateNodeExtraPartInput {
  partKind: AgentThreadNodePartKind;
  visibility?: AgentVisibility;
  state?: AgentPartState;
  providerOptions?: unknown;
  providerMetadata?: unknown;
  payload: unknown;
}

export interface CreateRunInput {
  threadId: string;
  parentRunId?: string | null;
  parentEventId?: string | null;
  triggerNodeId?: string | null;
  baseTipNodeId?: string | null;
  runMode: AgentRunMode;
  status?: AgentRunStatus;
  agentProfile: string;
  selectionSnapshot?: unknown;
  contextSnapshot?: ProjectAssistantContextSnapshot | null;
  inputRefsSnapshot?: readonly AssistantInputRefSnapshot[] | null;
  activeTools?: readonly ProjectAssistantToolName[] | null;
}

export interface CreateArtifactInput {
  runId?: string | null;
  stepId?: string | null;
  artifactKind: AgentArtifactKind;
  visibility: AgentVisibility;
  mimeType?: string | null;
  content: unknown;
  summaryText?: string | null;
}

export interface CreateRunStepInput {
  runId: string;
  stepIndex: number;
  provider: string;
  modelId: string;
  finishReason?: string | null;
  rawFinishReason?: string | null;
  system?: unknown;
  preparedMessagesArtifactId?: string | null;
  responseMessagesArtifactId?: string | null;
  requestBodyArtifactId?: string | null;
  responseBodyArtifactId?: string | null;
  providerMetadataArtifactId?: string | null;
  usage?: unknown;
}

export interface CreateRunEventInput {
  runId: string;
  stepId?: string | null;
  eventKind: AgentRunEventKind;
  nodeId?: string | null;
  relatedToolCallId?: string | null;
  relatedRunId?: string | null;
  summaryText?: string | null;
  payloadArtifactId?: string | null;
}

export interface MaterializeResponseMessagesInput {
  threadId: string;
  parentNodeId: string | null;
  runId: string;
  stepId: string;
  messages: ModelMessage[];
}

export interface ProjectAiStorage {
  index: AiIndexPayload;
  files: Record<string, string>;
}

interface RunTraceCacheFields {
  selectionSnapshotJson: string;
  contextSnapshotJson: string | null;
  inputRefsSnapshotJson: string | null;
  activeToolsJson: string | null;
  stepCount: number;
  totalTokens: number | null;
  lastFinishReason: string | null;
  errorSummary: string | null;
  traceUpdatedAt: number | null;
}

export interface RunTraceRows {
  run: AgentRunView;
  inputRefs: AgentRunInputRefRow[];
  steps: AgentRunStepRow[];
  events: AgentRunEventRow[];
  artifacts: AgentArtifactRow[];
  childRuns: AgentRunView[];
}

export function trimOptionalString(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function normalizeThreadTitle(title: string | null | undefined, fallback: string) {
  return trimOptionalString(title) ?? fallback;
}

export function normalizeSummaryText(summaryText: string | null | undefined) {
  return trimOptionalString(summaryText);
}

export function serializeRequiredJson(value: unknown, label: string) {
  const serialized = JSON.stringify(value);
  invariant(serialized !== undefined, `${label}必须可序列化。`);
  return serialized;
}

export function serializeOptionalJson(value: unknown) {
  if (value === undefined) {
    return null;
  }
  const serialized = JSON.stringify(value);
  invariant(serialized !== undefined, "可选 JSON 字段必须可序列化。");
  return serialized;
}

export function parseStoredJson<T>(raw: string | null): T | null {
  if (raw == null) {
    return null;
  }
  return JSON.parse(raw) as T;
}

export function parseStoredArray<T>(raw: string | null | undefined): T[] {
  if (!raw) {
    return [];
  }
  const parsed = JSON.parse(raw) as unknown;
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

export function stringifyStoredArray<T>(items: readonly T[]) {
  return serializeRequiredJson(items, "缓存数组");
}

function assertThreadRole(role: string): asserts role is AgentThreadRole {
  invariant(
    role === "system" || role === "user" || role === "assistant" || role === "tool",
    "不支持的线程节点角色。",
  );
}

function assertRunMode(mode: string): asserts mode is AgentRunMode {
  invariant(
    mode === "send" ||
      mode === "retry" ||
      mode === "regenerate" ||
      mode === "edit_regenerate" ||
      mode === "continue" ||
      mode === "subagent",
    "不支持的 run 模式。",
  );
}

function assertRunStatus(status: string): asserts status is AgentRunStatus {
  invariant(
    status === "queued" ||
      status === "running" ||
      status === "waiting_for_input" ||
      status === "succeeded" ||
      status === "failed" ||
      status === "cancelled",
    "不支持的 run 状态。",
  );
}

function assertPartKind(kind: string): asserts kind is AgentThreadNodePartKind {
  invariant(
    kind === "text" ||
      kind === "data-assistant-ref" ||
      kind === "reasoning" ||
      kind === "tool-call" ||
      kind === "tool-result" ||
      kind === "tool-approval-request" ||
      kind === "tool-approval-response" ||
      kind === "tool-error" ||
      kind === "file" ||
      kind === "source-url" ||
      kind === "source-document" ||
      kind === "data" ||
      kind === "step-start",
    "不支持的节点 part 类型。",
  );
}

function assertVisibility(visibility: string): asserts visibility is AgentVisibility {
  invariant(
    visibility === "public" || visibility === "hidden" || visibility === "internal",
    "不支持的可见性。",
  );
}

function assertPartState(state: string): asserts state is AgentPartState {
  invariant(state === "streaming" || state === "done", "不支持的 part 状态。");
}

function assertEventKind(kind: string): asserts kind is AgentRunEventKind {
  invariant(
    kind === "run-started" ||
      kind === "step-started" ||
      kind === "provider-requested" ||
      kind === "provider-responded" ||
      kind === "tool-call-started" ||
      kind === "tool-call-finished" ||
      kind === "tool-call-failed" ||
      kind === "user-input-requested" ||
      kind === "user-input-submitted" ||
      kind === "node-materialized" ||
      kind === "active-tip-moved" ||
      kind === "child-run-started" ||
      kind === "run-failed" ||
      kind === "run-succeeded",
    "不支持的 run 事件类型。",
  );
}

function assertArtifactKind(kind: string): asserts kind is AgentArtifactKind {
  invariant(
    kind === "prepared-model-messages" ||
      kind === "response-messages" ||
      kind === "request-body" ||
      kind === "response-body" ||
      kind === "provider-metadata" ||
      kind === "tool-input" ||
      kind === "tool-output" ||
      kind === "reasoning-raw" ||
      kind === "ui-projection" ||
      kind === "error",
    "不支持的 artifact 类型。",
  );
}

function assertSourceKind(kind: string): asserts kind is AgentThreadNodeSourceKind {
  invariant(
    kind === "user_input" ||
      kind === "model_response" ||
      kind === "tool_result" ||
      kind === "system_seed" ||
      kind === "edit_rewrite",
    "不支持的节点来源类型。",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function withProviderOptions<T extends Record<string, unknown>>(
  target: T,
  source: Record<string, unknown>,
) {
  const providerOptions =
    Reflect.get(source, "providerOptions") ?? Reflect.get(source, "providerMetadata");
  return providerOptions == null
    ? target
    : ({
        ...target,
        providerOptions,
      } satisfies Record<string, unknown>);
}

function normalizeToolResultOutput(output: unknown): Record<string, unknown> {
  if (isRecord(output)) {
    const type = Reflect.get(output, "type");
    if (type === "text") {
      return withProviderOptions(
        {
          type: "text",
          value:
            typeof Reflect.get(output, "value") === "string"
              ? (Reflect.get(output, "value") as string)
              : String(Reflect.get(output, "value") ?? ""),
        },
        output,
      );
    }
    if (type === "json") {
      return withProviderOptions(
        {
          type: "json",
          value: Reflect.get(output, "value") ?? null,
        },
        output,
      );
    }
    if (type === "execution-denied") {
      return withProviderOptions(
        {
          type: "execution-denied",
          ...(typeof Reflect.get(output, "reason") === "string"
            ? { reason: Reflect.get(output, "reason") as string }
            : {}),
        },
        output,
      );
    }
    if (type === "error-text") {
      return withProviderOptions(
        {
          type: "error-text",
          value:
            typeof Reflect.get(output, "value") === "string"
              ? (Reflect.get(output, "value") as string)
              : String(Reflect.get(output, "value") ?? ""),
        },
        output,
      );
    }
    if (type === "error-json") {
      return withProviderOptions(
        {
          type: "error-json",
          value: Reflect.get(output, "value") ?? null,
        },
        output,
      );
    }
    if (type === "content") {
      const rawValue = Reflect.get(output, "value");
      const value = Array.isArray(rawValue)
        ? rawValue.flatMap((part) => {
            if (!isRecord(part)) {
              return [];
            }
            const partType = Reflect.get(part, "type");
            if (partType === "text") {
              return [
                withProviderOptions(
                  {
                    type: "text",
                    text:
                      typeof Reflect.get(part, "text") === "string"
                        ? (Reflect.get(part, "text") as string)
                        : String(Reflect.get(part, "text") ?? ""),
                  },
                  part,
                ),
              ];
            }
            if (partType === "media") {
              const data = Reflect.get(part, "data");
              const mediaType = Reflect.get(part, "mediaType");
              if (typeof data !== "string" || typeof mediaType !== "string") {
                return [];
              }
              return [{ type: "media", data, mediaType }];
            }
            if (partType === "file-data") {
              const data = Reflect.get(part, "data");
              const mediaType = Reflect.get(part, "mediaType");
              if (typeof data !== "string" || typeof mediaType !== "string") {
                return [];
              }
              return [
                withProviderOptions(
                  {
                    type: "file-data",
                    data,
                    mediaType,
                    ...(typeof Reflect.get(part, "filename") === "string"
                      ? { filename: Reflect.get(part, "filename") as string }
                      : {}),
                  },
                  part,
                ),
              ];
            }
            if (partType === "file-url") {
              const url = Reflect.get(part, "url");
              if (typeof url !== "string") {
                return [];
              }
              return [withProviderOptions({ type: "file-url", url }, part)];
            }
            if (partType === "file-id") {
              const fileId = Reflect.get(part, "fileId");
              if (typeof fileId !== "string" && !isRecord(fileId)) {
                return [];
              }
              return [withProviderOptions({ type: "file-id", fileId }, part)];
            }
            if (partType === "image-data") {
              const data = Reflect.get(part, "data");
              const mediaType = Reflect.get(part, "mediaType");
              if (typeof data !== "string" || typeof mediaType !== "string") {
                return [];
              }
              return [withProviderOptions({ type: "image-data", data, mediaType }, part)];
            }
            if (partType === "image-url") {
              const url = Reflect.get(part, "url");
              if (typeof url !== "string") {
                return [];
              }
              return [withProviderOptions({ type: "image-url", url }, part)];
            }
            if (partType === "image-file-id") {
              const fileId = Reflect.get(part, "fileId");
              if (typeof fileId !== "string" && !isRecord(fileId)) {
                return [];
              }
              return [withProviderOptions({ type: "image-file-id", fileId }, part)];
            }
            if (partType === "custom") {
              return [withProviderOptions({ type: "custom" }, part)];
            }
            return [];
          })
        : [];
      return withProviderOptions({ type: "content", value }, output);
    }
  }

  if (typeof output === "string") {
    return { type: "text", value: output };
  }

  return {
    type: "json",
    value: output ?? null,
  };
}

function normalizeMessagePartForRole(
  role: ModelMessage["role"],
  rawPart: unknown,
): Record<string, unknown> | null {
  const part = isRecord(rawPart)
    ? rawPart
    : {
        type: "text",
        text: String(rawPart ?? ""),
      };
  const type = Reflect.get(part, "type");

  if (type === "text") {
    return withProviderOptions(
      {
        type: "text",
        text:
          typeof Reflect.get(part, "text") === "string"
            ? (Reflect.get(part, "text") as string)
            : String(Reflect.get(part, "text") ?? ""),
      },
      part,
    );
  }

  if (role === "user") {
    if (type === "image") {
      const image = Reflect.get(part, "image");
      if (image == null) {
        return null;
      }
      return withProviderOptions(
        {
          type: "image",
          image,
          ...(typeof Reflect.get(part, "mediaType") === "string"
            ? { mediaType: Reflect.get(part, "mediaType") as string }
            : {}),
        },
        part,
      );
    }
    if (type === "file") {
      const data = Reflect.get(part, "data");
      const mediaType = Reflect.get(part, "mediaType");
      if (data == null || typeof mediaType !== "string") {
        return null;
      }
      return withProviderOptions(
        {
          type: "file",
          data,
          mediaType,
          ...(typeof Reflect.get(part, "filename") === "string"
            ? { filename: Reflect.get(part, "filename") as string }
            : {}),
        },
        part,
      );
    }
    return null;
  }

  if (role === "assistant") {
    if (type === "reasoning") {
      return withProviderOptions(
        {
          type: "reasoning",
          text:
            typeof Reflect.get(part, "text") === "string"
              ? (Reflect.get(part, "text") as string)
              : String(Reflect.get(part, "text") ?? ""),
        },
        part,
      );
    }
    if (type === "file") {
      const data = Reflect.get(part, "data");
      const mediaType = Reflect.get(part, "mediaType");
      if (data == null || typeof mediaType !== "string") {
        return null;
      }
      return withProviderOptions(
        {
          type: "file",
          data,
          mediaType,
          ...(typeof Reflect.get(part, "filename") === "string"
            ? { filename: Reflect.get(part, "filename") as string }
            : {}),
        },
        part,
      );
    }
    if (type === "tool-call") {
      const toolCallId = Reflect.get(part, "toolCallId");
      const toolName = Reflect.get(part, "toolName");
      if (typeof toolCallId !== "string" || typeof toolName !== "string") {
        return null;
      }
      return {
        ...withProviderOptions(
          {
            type: "tool-call",
            toolCallId,
            toolName,
            input: Reflect.get(part, "input"),
          },
          part,
        ),
        ...(typeof Reflect.get(part, "providerExecuted") === "boolean"
          ? { providerExecuted: Reflect.get(part, "providerExecuted") as boolean }
          : {}),
      };
    }
    if (type === "tool-result") {
      const toolCallId = Reflect.get(part, "toolCallId");
      const toolName = Reflect.get(part, "toolName");
      if (typeof toolCallId !== "string" || typeof toolName !== "string") {
        return null;
      }
      return withProviderOptions(
        {
          type: "tool-result",
          toolCallId,
          toolName,
          output: normalizeToolResultOutput(Reflect.get(part, "output")),
        },
        part,
      );
    }
    if (type === "tool-approval-request") {
      const approvalId = Reflect.get(part, "approvalId");
      const toolCallId = Reflect.get(part, "toolCallId");
      if (typeof approvalId !== "string" || typeof toolCallId !== "string") {
        return null;
      }
      return {
        type: "tool-approval-request",
        approvalId,
        toolCallId,
      };
    }
    return null;
  }

  if (role === "tool") {
    if (type === "tool-result") {
      const toolCallId = Reflect.get(part, "toolCallId");
      const toolName = Reflect.get(part, "toolName");
      if (typeof toolCallId !== "string" || typeof toolName !== "string") {
        return null;
      }
      return withProviderOptions(
        {
          type: "tool-result",
          toolCallId,
          toolName,
          output: normalizeToolResultOutput(Reflect.get(part, "output")),
        },
        part,
      );
    }
    if (type === "tool-approval-response") {
      const approvalId = Reflect.get(part, "approvalId");
      const approved = Reflect.get(part, "approved");
      if (typeof approvalId !== "string" || typeof approved !== "boolean") {
        return null;
      }
      return {
        type: "tool-approval-response",
        approvalId,
        approved,
        ...(typeof Reflect.get(part, "reason") === "string"
          ? { reason: Reflect.get(part, "reason") as string }
          : {}),
      };
    }
  }

  return null;
}

function normalizeModelMessage(message: ModelMessage): ModelMessage {
  const providerOptions = Reflect.get(message as Record<string, unknown>, "providerOptions");

  if (message.role === "system") {
    return {
      role: "system",
      content:
        typeof message.content === "string" ? message.content : (getTextishSummary(message) ?? ""),
      ...(providerOptions == null ? {} : { providerOptions }),
    } as ModelMessage;
  }

  const rawContent = (message as { content?: unknown }).content;
  const parts =
    typeof rawContent === "string"
      ? [{ type: "text", text: rawContent }]
      : Array.isArray(rawContent)
        ? rawContent
        : [];

  const normalizedContent = parts.flatMap((part) => {
    const normalizedPart = normalizeMessagePartForRole(message.role, part);
    return normalizedPart ? [normalizedPart] : [];
  });

  return {
    role: message.role,
    content:
      message.role === "tool"
        ? normalizedContent
        : typeof rawContent === "string"
          ? rawContent
          : normalizedContent,
    ...(providerOptions == null ? {} : { providerOptions }),
  } as ModelMessage;
}

function inferPartKind(rawPart: Record<string, unknown>): AgentThreadNodePartKind {
  const type = rawPart.type;
  if (type === "text") return "text";
  if (type === "reasoning") return "reasoning";
  if (type === "tool-call") return "tool-call";
  if (type === "tool-result") return "tool-result";
  if (type === "tool-approval-request") return "tool-approval-request";
  if (type === "tool-approval-response") return "tool-approval-response";
  if (type === "tool-error") return "tool-error";
  if (type === "file") return "file";
  if (type === "step-start") return "step-start";
  if (type === "source") {
    return typeof rawPart.url === "string" ? "source-url" : "source-document";
  }
  if (typeof type === "string" && type.startsWith("data-")) {
    return "data";
  }
  return "data";
}

function inferVisibility(partKind: AgentThreadNodePartKind): AgentVisibility {
  if (partKind === "reasoning") {
    return "hidden";
  }
  if (
    partKind === "tool-call" ||
    partKind === "tool-result" ||
    partKind === "tool-approval-request" ||
    partKind === "tool-approval-response" ||
    partKind === "tool-error"
  ) {
    return "internal";
  }
  return "public";
}

function normalizeMessageParts(message: ModelMessage) {
  const role = message.role;
  const rawContent = (message as { content?: unknown }).content;
  const normalized =
    typeof rawContent === "string"
      ? [{ type: "text", text: rawContent }]
      : Array.isArray(rawContent)
        ? rawContent
        : [];

  return normalized.map((part, partIndex) => {
    const rawPart =
      part && typeof part === "object"
        ? ({ ...(part as Record<string, unknown>) } satisfies Record<string, unknown>)
        : { type: "text", text: String(part ?? "") };
    const partKind =
      role === "tool" && !("type" in rawPart) ? "tool-result" : inferPartKind(rawPart);
    return {
      partIndex,
      partKind,
      visibility: inferVisibility(partKind),
      state:
        Reflect.get(rawPart, "state") === "streaming" || Reflect.get(rawPart, "state") === "done"
          ? (Reflect.get(rawPart, "state") as AgentPartState)
          : ("done" as AgentPartState),
      providerOptions: Reflect.get(rawPart, "providerOptions"),
      providerMetadata: Reflect.get(rawPart, "providerMetadata"),
      payload: rawPart,
    };
  });
}

function normalizeExtraNodeParts(parts: CreateNodeExtraPartInput[], startIndex: number) {
  return parts.map((part, offset) => ({
    partIndex: startIndex + offset,
    partKind: part.partKind,
    visibility: part.visibility ?? inferVisibility(part.partKind),
    state: part.state ?? "done",
    providerOptions: part.providerOptions,
    providerMetadata: part.providerMetadata,
    payload: part.payload,
  }));
}

function isModelMessagePart(part: AgentThreadNodePartView) {
  return part.partKind !== "data-assistant-ref";
}

export function buildModelMessageFromParts(
  role: AgentThreadRole,
  parts: AgentThreadNodePartView[],
): ModelMessage {
  const contentParts = parts
    .filter(isModelMessagePart)
    .sort((a, b) => a.partIndex - b.partIndex)
    .map((part) => projectStoredPartPayload(part.payload));

  if (role === "system") {
    return {
      role,
      content: contentParts
        .flatMap((part) => {
          if (!part || typeof part !== "object") {
            return [];
          }
          const text = Reflect.get(part as Record<string, unknown>, "text");
          return typeof text === "string" ? [text] : [];
        })
        .join("\n"),
    } as ModelMessage;
  }

  return {
    role,
    content: contentParts,
  } as ModelMessage;
}

function projectStoredPartPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  const record = { ...(payload as Record<string, unknown>) };
  delete record.state;
  if (record.providerOptions == null && record.providerMetadata != null) {
    record.providerOptions = record.providerMetadata;
  }
  delete record.providerMetadata;
  return record;
}

export function getMessageContentParts(message: ModelMessage): unknown[] {
  const rawContent = (message as { content?: unknown }).content;
  return typeof rawContent === "string"
    ? [{ type: "text", text: rawContent }]
    : Array.isArray(rawContent)
      ? [...rawContent]
      : [];
}

function getTextishSummary(message: ModelMessage) {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return null;
  }

  const texts = content.flatMap((part) => {
    if (!part || typeof part !== "object") {
      return [];
    }
    const type = Reflect.get(part as Record<string, unknown>, "type");
    if (type === "text" || type === "reasoning") {
      const text = Reflect.get(part as Record<string, unknown>, "text");
      return typeof text === "string" ? [text] : [];
    }
    return [];
  });

  return texts.length > 0 ? texts.join(" ").trim() : null;
}

export function buildMessageSummary(message: ModelMessage) {
  const textSummary = getTextishSummary(message);
  if (textSummary) {
    const normalized = textSummary.replace(/\s+/g, " ").trim();
    return normalized.length <= 80 ? normalized : `${normalized.slice(0, 80)}…`;
  }

  if (message.role === "tool") {
    const content = (message as { content?: unknown }).content;
    const first = Array.isArray(content) ? content[0] : null;
    const toolName =
      first && typeof first === "object"
        ? Reflect.get(first as Record<string, unknown>, "toolName")
        : null;
    return typeof toolName === "string" ? `工具结果：${toolName}` : "工具结果";
  }

  if (message.role === "assistant") {
    const content = (message as { content?: unknown }).content;
    const first = Array.isArray(content) ? content[0] : null;
    const toolName =
      first && typeof first === "object"
        ? Reflect.get(first as Record<string, unknown>, "toolName")
        : null;
    return typeof toolName === "string" ? `调用工具：${toolName}` : "助手回复";
  }

  return message.role === "system" ? "系统消息" : "消息";
}

export function mapProjectStateRow(row: AgentProjectStateRow): AgentProjectStateView {
  return {
    id: row.id,
    projectId: row.projectId,
    agentProfile: row.agentProfile,
    activeThreadId: row.activeThreadId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function mapThreadRow(row: AgentThreadRow): AgentThreadView {
  return {
    id: row.id,
    projectId: row.projectId,
    agentProfile: row.agentProfile,
    title: row.title,
    activeTipNodeId: row.activeTipNodeId,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapNodePartRow(row: AgentMessagePartRow): AgentThreadNodePartView {
  assertPartKind(row.partKind);
  assertVisibility(row.visibility);
  assertPartState(row.state);
  return {
    id: row.id,
    nodeId: row.nodeId,
    partIndex: row.partIndex,
    partKind: row.partKind,
    visibility: row.visibility,
    state: row.state,
    providerOptions: parseStoredJson(row.providerOptionsJson),
    providerMetadata: parseStoredJson(row.providerMetadataJson),
    payload: JSON.parse(row.payloadJson),
    createdAt: row.createdAt,
  };
}

function listNodePartViews(node: AgentThreadNodeRow) {
  return parseStoredArray<AgentMessagePartRow>(node.partsJson)
    .sort((left, right) => left.partIndex - right.partIndex)
    .map(mapNodePartRow);
}

export function mapNodeRow(row: AgentThreadNodeRow): AgentThreadNodeView {
  assertThreadRole(row.role);
  assertSourceKind(row.sourceKind);
  const parts = listNodePartViews(row);
  return {
    id: row.id,
    threadId: row.threadId,
    parentNodeId: row.parentNodeId,
    role: row.role,
    createdByRunId: row.createdByRunId,
    sourceStepId: row.sourceStepId,
    sourceKind: row.sourceKind,
    summaryText: row.summaryText,
    message: buildModelMessageFromParts(row.role, parts),
    parts,
    createdAt: row.createdAt,
  };
}

export function getNodeModelMessage(node: AgentThreadNodeRow): ModelMessage {
  assertThreadRole(node.role);
  return buildModelMessageFromParts(node.role, listNodePartViews(node));
}

export function mapArtifactRow(row: AgentArtifactRow): AgentArtifactView {
  assertArtifactKind(row.artifactKind);
  assertVisibility(row.visibility);
  return {
    id: row.id,
    runId: row.runId,
    stepId: row.stepId,
    artifactKind: row.artifactKind,
    visibility: row.visibility,
    mimeType: row.mimeType,
    content: JSON.parse(row.contentJson),
    summaryText: row.summaryText,
    createdAt: row.createdAt,
  };
}

export function mapRunInputRefRow(row: AgentRunInputRefRow): AssistantInputRefSnapshot {
  invariant(row.kind === "global-prompt", "不支持的 run input ref 类型。");
  invariant(row.mode === "snapshot-ref", "不支持的 run input ref 模式。");
  const display = JSON.parse(row.displayJson) as { refId?: unknown };
  const refId = typeof display.refId === "string" ? display.refId : row.id;
  return {
    refId,
    kind: row.kind,
    mode: row.mode,
    label: row.label,
    source: JSON.parse(row.sourceJson) as AssistantInputRefSnapshot["source"],
    snapshot: JSON.parse(row.snapshotJson) as AssistantInputRefSnapshot["snapshot"],
  };
}

export function mapRunRow(row: AgentRunRow): AgentRunView {
  assertRunMode(row.runMode);
  assertRunStatus(row.status);
  return {
    id: row.id,
    threadId: row.threadId,
    parentRunId: row.parentRunId,
    parentEventId: row.parentEventId,
    triggerNodeId: row.triggerNodeId,
    baseTipNodeId: row.baseTipNodeId,
    runMode: row.runMode,
    status: row.status,
    agentProfile: row.agentProfile,
    selectionSnapshot: parseStoredJson<unknown>(row.selectionSnapshotJson) ?? {},
    contextSnapshot: parseStoredJson<ProjectAssistantContextSnapshot>(row.contextSnapshotJson),
    inputRefsSnapshot: row.inputRefsSnapshotJson
      ? parseStoredArray<AssistantInputRefSnapshot>(row.inputRefsSnapshotJson)
      : null,
    activeTools: row.activeToolsJson
      ? parseStoredArray<ProjectAssistantToolName>(row.activeToolsJson)
      : null,
    errorArtifactId: row.errorArtifactId,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function mapRunStepRow(row: AgentRunStepRow): AgentRunStepView {
  return {
    id: row.id,
    runId: row.runId,
    stepIndex: row.stepIndex,
    provider: row.provider,
    modelId: row.modelId,
    finishReason: row.finishReason,
    rawFinishReason: row.rawFinishReason,
    system: parseStoredJson(row.systemJson),
    preparedMessagesArtifactId: row.preparedMessagesArtifactId,
    responseMessagesArtifactId: row.responseMessagesArtifactId,
    requestBodyArtifactId: row.requestBodyArtifactId,
    responseBodyArtifactId: row.responseBodyArtifactId,
    providerMetadataArtifactId: row.providerMetadataArtifactId,
    usage: parseStoredJson(row.usageJson),
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
  };
}

export function mapRunEventRow(row: AgentRunEventRow): AgentRunEventView {
  assertEventKind(row.eventKind);
  return {
    id: row.id,
    runId: row.runId,
    stepId: row.stepId,
    seq: row.seq,
    eventKind: row.eventKind,
    nodeId: row.nodeId,
    relatedToolCallId: row.relatedToolCallId,
    relatedRunId: row.relatedRunId,
    summaryText: row.summaryText,
    payloadArtifactId: row.payloadArtifactId,
    createdAt: row.createdAt,
  };
}

export function sortByCreatedAt<T extends { createdAt: number }>(rows: readonly T[]) {
  return [...rows].sort((left, right) => left.createdAt - right.createdAt);
}

export function sortByUpdatedDescCreatedDesc<T extends { updatedAt: number; createdAt: number }>(
  rows: readonly T[],
) {
  return [...rows].sort((left, right) => {
    if (left.updatedAt !== right.updatedAt) {
      return right.updatedAt - left.updatedAt;
    }
    return right.createdAt - left.createdAt;
  });
}

function normalizeIndexPayload(index: AiIndexPayload): AiIndexPayload {
  return {
    threads: sortByCreatedAt(index.threads),
    projectState: sortByCreatedAt(index.projectState),
    nodes: sortByCreatedAt(index.nodes),
    runs: sortByCreatedAt(index.runs),
  };
}

export function replaceRowById<T extends { id: string }>(rows: T[], nextRow: T) {
  const index = rows.findIndex((row) => row.id === nextRow.id);
  if (index >= 0) {
    rows[index] = nextRow;
  } else {
    rows.push(nextRow);
  }
}

export function getProjectOrThrow(projectId: string) {
  return readProjectMetaSync(projectId).project;
}

export function touchProject(projectId: string) {
  updateProjectMetaSync(
    projectId,
    (payload) => ({
      ...payload,
      project: {
        ...payload.project,
        updatedAt: now(),
      },
    }),
    "Touch project metadata",
  );
}

function readAiRunFilesOrEmpty(projectId: string) {
  try {
    return readFilesAtRefSync({ projectId, ref: aiRunsRef(projectId) });
  } catch {
    return {};
  }
}

export function readProjectAiStorage(projectId: string): ProjectAiStorage {
  readProjectMetaSync(projectId);
  return {
    index: normalizeIndexPayload(readAiIndexSync(projectId)),
    files: readAiRunFilesOrEmpty(projectId),
  };
}

function writeProjectAiStorage(projectId: string, storage: ProjectAiStorage, message: string) {
  const index = normalizeIndexPayload(storage.index);
  const files = {
    ...storage.files,
    "threads.jsonl": stringifyJsonl(index.threads),
    "project-state.jsonl": stringifyJsonl(index.projectState),
    "nodes.jsonl": stringifyJsonl(index.nodes),
    "runs.jsonl": stringifyJsonl(index.runs),
  };
  commitCustomRefSync({
    projectId,
    ref: aiRunsRef(projectId),
    message,
    replace: true,
    files,
  });
  return {
    index,
    files,
  } satisfies ProjectAiStorage;
}

export function updateProjectAiStorage<T>(
  projectId: string,
  message: string,
  updater: (_storage: ProjectAiStorage) => T,
) {
  const storage = readProjectAiStorage(projectId);
  const result = updater(storage);
  writeProjectAiStorage(projectId, storage, message);
  return result;
}

export function getProjectIdForThreadOrThrow(threadId: string) {
  const projectId = findProjectIdForThreadSync(threadId);
  invariant(projectId, "未找到 agent thread。");
  return projectId;
}

export function getProjectIdForNodeOrThrow(nodeId: string) {
  const projectId = findProjectIdForNodeSync(nodeId);
  invariant(projectId, "未找到 agent 节点。");
  return projectId;
}

export function getProjectIdForRunOrThrow(runId: string) {
  const projectId = findProjectIdForRunSync(runId);
  invariant(projectId, "未找到 agent run。");
  return projectId;
}

export function getThreadOrThrow(index: AiIndexPayload, threadId: string) {
  const thread = index.threads.find((entry) => entry.id === threadId);
  invariant(thread, "未找到 agent thread。");
  return thread;
}

export function getNodeOrThrow(index: AiIndexPayload, nodeId: string) {
  const node = index.nodes.find((entry) => entry.id === nodeId);
  invariant(node, "未找到 agent 节点。");
  return node;
}

export function getRunOrThrow(index: AiIndexPayload, runId: string) {
  const run = index.runs.find((entry) => entry.id === runId);
  invariant(run, "未找到 agent run。");
  return run;
}

export function getProjectStateRow(index: AiIndexPayload, projectId: string, agentProfile: string) {
  return index.projectState.find(
    (entry) => entry.projectId === projectId && entry.agentProfile === agentProfile,
  );
}

export function getNodeRowsByThread(
  index: AiIndexPayload,
  threadId: string,
  parentNodeId: string | null,
) {
  return sortByCreatedAt(
    index.nodes.filter(
      (entry) => entry.threadId === threadId && entry.parentNodeId === parentNodeId,
    ),
  );
}

export function touchThread(index: AiIndexPayload, threadId: string, timestamp = now()) {
  const thread = getThreadOrThrow(index, threadId);
  replaceRowById(index.threads, {
    ...thread,
    updatedAt: timestamp,
  });
}

export function upsertProjectState(
  index: AiIndexPayload,
  projectId: string,
  agentProfile: string,
  activeThreadId: string | null,
) {
  getProjectOrThrow(projectId);
  const stateId = `${projectId}:${agentProfile}`;
  const timestamp = now();
  const existing = getProjectStateRow(index, projectId, agentProfile);
  const next: AgentProjectStateRow = existing
    ? {
        ...existing,
        activeThreadId,
        updatedAt: timestamp,
      }
    : {
        id: stateId,
        projectId,
        agentProfile,
        activeThreadId,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
  replaceRowById(index.projectState, next);
  return mapProjectStateRow(next);
}

export function getLatestUnarchivedThreadRow(
  index: AiIndexPayload,
  projectId: string,
  agentProfile: string,
) {
  return sortByUpdatedDescCreatedDesc(
    index.threads.filter(
      (entry) =>
        entry.projectId === projectId &&
        entry.agentProfile === agentProfile &&
        entry.archivedAt == null,
    ),
  )[0];
}

function buildStoredMessagePartRows(
  nodeId: string,
  createdAt: number,
  message: ModelMessage,
  extraParts: CreateNodeExtraPartInput[] | undefined,
) {
  const messageParts = normalizeMessageParts(message);
  const normalizedExtraParts = normalizeExtraNodeParts(extraParts ?? [], messageParts.length);
  return [...messageParts, ...normalizedExtraParts].map((part) => ({
    id: createId("agent_part"),
    nodeId,
    partIndex: part.partIndex,
    partKind: part.partKind,
    visibility: part.visibility,
    state: part.state,
    providerOptionsJson: serializeOptionalJson(part.providerOptions),
    providerMetadataJson: serializeOptionalJson(part.providerMetadata),
    payloadJson: serializeRequiredJson(part.payload, "节点 part"),
    createdAt,
  })) satisfies AgentMessagePartRow[];
}

export function insertNode(storage: ProjectAiStorage, input: CreateNodeInput) {
  const thread = getThreadOrThrow(storage.index, input.threadId);
  if (input.parentNodeId) {
    const parent = getNodeOrThrow(storage.index, input.parentNodeId);
    invariant(parent.threadId === thread.id, "父节点不属于当前 thread。");
  }
  if (input.createdByRunId) {
    const run = getRunOrThrow(storage.index, input.createdByRunId);
    invariant(run.threadId === thread.id, "节点来源 run 不属于当前 thread。");
  }
  if (input.sourceStepId) {
    const step = getStepOrThrow(input.sourceStepId);
    const run = getRunOrThrow(storage.index, step.runId);
    invariant(run.threadId === thread.id, "节点来源 step 不属于当前 thread。");
  }

  const storedMessage = normalizeModelMessage(input.message);
  const id = createId("agent_node");
  const createdAt = now();
  const row: AgentThreadNodeRow = {
    id,
    threadId: thread.id,
    parentNodeId: input.parentNodeId,
    role: storedMessage.role,
    createdByRunId: trimOptionalString(input.createdByRunId),
    sourceStepId: trimOptionalString(input.sourceStepId),
    sourceKind: input.sourceKind,
    summaryText: normalizeSummaryText(input.summaryText) ?? buildMessageSummary(storedMessage),
    partsJson: stringifyStoredArray(
      buildStoredMessagePartRows(id, createdAt, storedMessage, input.extraParts),
    ),
    createdAt,
  };
  storage.index.nodes.push(row);
  touchThread(storage.index, thread.id);
  return mapNodeRow(row);
}

export function updateNodePart(
  storage: ProjectAiStorage,
  nodeId: string,
  partIndex: number,
  {
    payload,
    state,
    providerOptions,
    providerMetadata,
  }: {
    payload: unknown;
    state: AgentPartState;
    providerOptions?: unknown;
    providerMetadata?: unknown;
  },
) {
  const node = getNodeOrThrow(storage.index, nodeId);
  const rows = parseStoredArray<AgentMessagePartRow>(node.partsJson);
  const rowIndex = rows.findIndex((row) => row.partIndex === partIndex);
  invariant(rowIndex >= 0, "未找到节点 part。");
  rows[rowIndex] = {
    ...rows[rowIndex]!,
    state,
    providerOptionsJson: serializeOptionalJson(providerOptions),
    providerMetadataJson: serializeOptionalJson(providerMetadata),
    payloadJson: serializeRequiredJson(payload, "节点 part"),
  };
  replaceRowById(storage.index.nodes, {
    ...node,
    partsJson: stringifyStoredArray(rows),
  });
  touchThread(storage.index, node.threadId);
}

export function appendNodePart(
  storage: ProjectAiStorage,
  nodeId: string,
  part: {
    partKind: AgentThreadNodePartKind;
    visibility: AgentVisibility;
    state: AgentPartState;
    payload: unknown;
    providerOptions?: unknown;
    providerMetadata?: unknown;
  },
) {
  const node = getNodeOrThrow(storage.index, nodeId);
  const rows = parseStoredArray<AgentMessagePartRow>(node.partsJson);
  const nextPartIndex = Math.max(-1, ...rows.map((row) => row.partIndex)) + 1;
  rows.push({
    id: createId("agent_part"),
    nodeId,
    partIndex: nextPartIndex,
    partKind: part.partKind,
    visibility: part.visibility,
    state: part.state,
    providerOptionsJson: serializeOptionalJson(part.providerOptions),
    providerMetadataJson: serializeOptionalJson(part.providerMetadata),
    payloadJson: serializeRequiredJson(part.payload, "节点 part"),
    createdAt: now(),
  });
  replaceRowById(storage.index.nodes, {
    ...node,
    partsJson: stringifyStoredArray(rows),
  });
  touchThread(storage.index, node.threadId);
}

export function updateNodeSummary(
  storage: ProjectAiStorage,
  nodeId: string,
  summaryText: string | null | undefined,
) {
  const node = getNodeOrThrow(storage.index, nodeId);
  replaceRowById(storage.index.nodes, {
    ...node,
    summaryText: normalizeSummaryText(summaryText),
  });
  touchThread(storage.index, node.threadId);
}

export function normalizeUsageTotalTokens(usage: unknown): number | null {
  if (!usage || typeof usage !== "object") {
    return null;
  }

  const totalTokens = Reflect.get(usage as Record<string, unknown>, "totalTokens");
  if (typeof totalTokens === "number" && Number.isFinite(totalTokens)) {
    return Math.max(0, Math.round(totalTokens));
  }

  const inputTokens = Reflect.get(usage as Record<string, unknown>, "inputTokens");
  const outputTokens = Reflect.get(usage as Record<string, unknown>, "outputTokens");
  if (
    typeof inputTokens === "number" &&
    Number.isFinite(inputTokens) &&
    typeof outputTokens === "number" &&
    Number.isFinite(outputTokens)
  ) {
    return Math.max(0, Math.round(inputTokens + outputTokens));
  }

  return null;
}

function summarizeRunTraceRows(rows: RunTraceRows): RunTraceCacheFields {
  const totalTokens = rows.steps.reduce<number | null>((sum, step) => {
    const value = normalizeUsageTotalTokens(parseStoredJson(step.usageJson));
    if (value == null) {
      return sum;
    }
    return (sum ?? 0) + value;
  }, null);
  const errorArtifact = rows.run.errorArtifactId
    ? (rows.artifacts.find((artifact) => artifact.id === rows.run.errorArtifactId) ?? null)
    : null;
  const lastStep = rows.steps.at(-1);

  return {
    selectionSnapshotJson: serializeRequiredJson(rows.run.selectionSnapshot ?? {}, "run 选择快照"),
    contextSnapshotJson: serializeOptionalJson(rows.run.contextSnapshot),
    inputRefsSnapshotJson: serializeOptionalJson(rows.run.inputRefsSnapshot ?? null),
    activeToolsJson: serializeOptionalJson(rows.run.activeTools ?? null),
    stepCount: rows.steps.length,
    totalTokens,
    lastFinishReason: lastStep?.finishReason ?? null,
    errorSummary: errorArtifact?.summaryText ?? null,
    traceUpdatedAt: rows.run.updatedAt,
  };
}

export function buildAgentRunCacheFieldsFromTrace(rows: RunTraceRows) {
  return summarizeRunTraceRows(rows);
}

export function normalizeGitStepRow(
  row: AgentRunStepRow | Record<string, unknown>,
): AgentRunStepRow {
  if ("systemJson" in row) return row as AgentRunStepRow;
  return {
    id: String(row.id),
    runId: String(row.runId),
    stepIndex: Number(row.stepIndex),
    provider: String(row.provider),
    modelId: String(row.modelId),
    finishReason: typeof row.finishReason === "string" ? row.finishReason : null,
    rawFinishReason: typeof row.rawFinishReason === "string" ? row.rawFinishReason : null,
    systemJson: serializeOptionalJson(Reflect.get(row, "system")),
    preparedMessagesArtifactId:
      typeof row.preparedMessagesArtifactId === "string" ? row.preparedMessagesArtifactId : null,
    responseMessagesArtifactId:
      typeof row.responseMessagesArtifactId === "string" ? row.responseMessagesArtifactId : null,
    requestBodyArtifactId:
      typeof row.requestBodyArtifactId === "string" ? row.requestBodyArtifactId : null,
    responseBodyArtifactId:
      typeof row.responseBodyArtifactId === "string" ? row.responseBodyArtifactId : null,
    providerMetadataArtifactId:
      typeof row.providerMetadataArtifactId === "string" ? row.providerMetadataArtifactId : null,
    usageJson: serializeOptionalJson(Reflect.get(row, "usage")),
    startedAt: Number(row.startedAt),
    completedAt: Number(row.completedAt),
    createdAt: Number(row.createdAt),
  };
}

export function normalizeGitArtifactRow(
  row: AgentArtifactRow | AgentArtifactView | Record<string, unknown>,
): AgentArtifactRow {
  if ("contentJson" in row) return row as AgentArtifactRow;
  return {
    id: String(row.id),
    runId: typeof row.runId === "string" ? row.runId : null,
    stepId: typeof row.stepId === "string" ? row.stepId : null,
    artifactKind: String(row.artifactKind) as AgentArtifactKind,
    visibility: String(row.visibility) as AgentVisibility,
    mimeType: typeof row.mimeType === "string" ? row.mimeType : null,
    contentJson: serializeRequiredJson(Reflect.get(row, "content") ?? null, "artifact 内容"),
    summaryText: typeof row.summaryText === "string" ? row.summaryText : null,
    createdAt: Number(row.createdAt),
  };
}

export function parseRunTraceRowsFromStorage(
  storage: ProjectAiStorage,
  run: AgentRunRow,
): RunTraceRows {
  const runJson = storage.files[`runs/${run.id}/run.json`];
  const runView = runJson ? (JSON.parse(runJson) as AgentRunView) : mapRunRow(run);
  const inputRefs = parseJsonl<AgentRunInputRefRow>(
    storage.files[`runs/${run.id}/input-refs.jsonl`],
  ).sort((left, right) => left.refIndex - right.refIndex);
  const steps = parseJsonl<AgentRunStepRow | Record<string, unknown>>(
    storage.files[`runs/${run.id}/steps.jsonl`],
  )
    .map(normalizeGitStepRow)
    .sort((left, right) => left.stepIndex - right.stepIndex);
  const events = parseJsonl<AgentRunEventRow>(storage.files[`runs/${run.id}/events.jsonl`]).sort(
    (left, right) => left.seq - right.seq,
  );
  const artifacts = parseJsonl<AgentArtifactRow | AgentArtifactView | Record<string, unknown>>(
    storage.files[`runs/${run.id}/artifacts.jsonl`],
  )
    .map(normalizeGitArtifactRow)
    .sort((left, right) => left.createdAt - right.createdAt);
  const childRuns = sortByCreatedAt(
    storage.index.runs.filter((entry) => entry.parentRunId === run.id),
  ).map(mapRunRow);

  return {
    run: runView,
    inputRefs,
    steps,
    events,
    artifacts,
    childRuns,
  };
}

export function mapTraceRows(rows: RunTraceRows): AgentRunTraceView {
  return {
    run: rows.run,
    steps: rows.steps.map(mapRunStepRow),
    events: rows.events.map(mapRunEventRow),
    artifacts: rows.artifacts.map(mapArtifactRow),
    childRuns: rows.childRuns,
  };
}

export function applyRunTraceRowsToStorage(storage: ProjectAiStorage, rows: RunTraceRows) {
  storage.files[`runs/${rows.run.id}/run.json`] = `${JSON.stringify(rows.run, null, 2)}\n`;
  storage.files[`runs/${rows.run.id}/input-refs.jsonl`] = stringifyJsonl(rows.inputRefs);
  storage.files[`runs/${rows.run.id}/steps.jsonl`] = stringifyJsonl(rows.steps);
  storage.files[`runs/${rows.run.id}/events.jsonl`] = stringifyJsonl(rows.events);
  storage.files[`runs/${rows.run.id}/artifacts.jsonl`] = stringifyJsonl(rows.artifacts);
  storage.files[`runs/${rows.run.id}/child-runs.jsonl`] = stringifyJsonl(rows.childRuns);

  const cache = buildAgentRunCacheFieldsFromTrace(rows);
  const current = getRunOrThrow(storage.index, rows.run.id);
  replaceRowById(storage.index.runs, {
    ...current,
    status: rows.run.status,
    errorArtifactId: rows.run.errorArtifactId,
    selectionSnapshotJson: cache.selectionSnapshotJson,
    contextSnapshotJson: cache.contextSnapshotJson,
    inputRefsSnapshotJson: cache.inputRefsSnapshotJson,
    activeToolsJson: cache.activeToolsJson,
    stepCount: cache.stepCount,
    totalTokens: cache.totalTokens,
    lastFinishReason: cache.lastFinishReason,
    errorSummary: cache.errorSummary,
    traceUpdatedAt: cache.traceUpdatedAt,
    completedAt: rows.run.completedAt,
    updatedAt: rows.run.updatedAt,
  });
}

export function getStepOrThrow(stepId: string) {
  for (const project of listProjectRowsSync()) {
    const storage = readProjectAiStorage(project.id);
    for (const run of storage.index.runs) {
      const step = parseRunTraceRowsFromStorage(storage, run).steps.find(
        (entry) => entry.id === stepId,
      );
      if (step) {
        return step;
      }
    }
  }
  invariant(false, "未找到 run step。");
}

export function getArtifactOrThrow(artifactId: string) {
  for (const project of listProjectRowsSync()) {
    const storage = readProjectAiStorage(project.id);
    for (const run of storage.index.runs) {
      const artifact = parseRunTraceRowsFromStorage(storage, run).artifacts.find(
        (entry) => entry.id === artifactId,
      );
      if (artifact) {
        return artifact;
      }
    }
  }
  invariant(false, "未找到 artifact。");
}

export function resolveCandidateLeafTip(
  index: AiIndexPayload,
  threadId: string,
  candidateNodeId: string,
) {
  let currentId = candidateNodeId;
  while (true) {
    const children = getNodeRowsByThread(index, threadId, currentId);
    if (children.length !== 1) {
      return currentId;
    }
    currentId = children[0]!.id;
  }
}

export function buildCandidateGroups(
  index: AiIndexPayload,
  threadId: string,
  activePath: AgentThreadNodeView[],
) {
  const activeNodeByParent = new Map<string | null, string>();
  activePath.forEach((node) => {
    activeNodeByParent.set(node.parentNodeId, node.id);
  });

  const groups: AgentCandidateGroupView[] = [];
  for (const [parentNodeId, activeNodeId] of activeNodeByParent.entries()) {
    const candidates = getNodeRowsByThread(index, threadId, parentNodeId);
    if (candidates.length <= 1) {
      continue;
    }
    groups.push({
      parentNodeId,
      activeNodeId,
      nodes: candidates.map((row) => ({
        id: row.id,
        tipNodeId: resolveCandidateLeafTip(index, row.threadId, row.id),
        role: row.role as AgentThreadRole,
        summaryText: row.summaryText,
        createdAt: row.createdAt,
        createdByRunId: row.createdByRunId,
      })),
    });
  }
  return groups;
}

export function buildRunSummaries(
  index: AiIndexPayload,
  threadId: string,
  activePath: AgentThreadNodeView[],
) {
  const activeNodeIds = new Set(activePath.map((node) => node.id));
  const activeIndexByNodeId = new Map(activePath.map((node, entryIndex) => [node.id, entryIndex]));
  const includedRunIds = new Set(
    activePath.flatMap((node) => (node.createdByRunId ? [node.createdByRunId] : [])),
  );
  const assistantDisplayNodeByRunId = new Map<string, string>();

  activePath.forEach((node) => {
    if (node.role === "assistant" && node.createdByRunId) {
      assistantDisplayNodeByRunId.set(node.createdByRunId, node.id);
    }
  });

  const runRows = sortByCreatedAt(index.runs.filter((row) => row.threadId === threadId));
  const relevantRunRows = runRows.filter((row) => {
    if (includedRunIds.has(row.id)) {
      return true;
    }
    return (
      (row.status === "failed" &&
        row.triggerNodeId != null &&
        activeNodeIds.has(row.triggerNodeId)) ||
      row.status === "waiting_for_input"
    );
  });
  const relevantRuns = relevantRunRows.map(mapRunRow);

  if (relevantRuns.length === 0) {
    return [] as AgentRunSummaryView[];
  }

  const continuedByRunId = new Map<string, string>();
  relevantRuns.forEach((row) => {
    if (row.parentRunId && row.runMode === "continue") {
      continuedByRunId.set(row.parentRunId, row.id);
    }
  });

  return relevantRuns
    .flatMap((row) => {
      const maxSteps = getAiAssistantMaxSteps();
      const displayNodeId =
        assistantDisplayNodeByRunId.get(row.id) ??
        (row.triggerNodeId && activeNodeIds.has(row.triggerNodeId) ? row.triggerNodeId : null);
      if (!displayNodeId) {
        return [];
      }

      const cachedRun = relevantRunRows.find((entry) => entry.id === row.id)!;
      const continuationReason =
        row.status === "succeeded" &&
        row.activeTools != null &&
        cachedRun.stepCount >= maxSteps &&
        cachedRun.lastFinishReason === "tool-calls"
          ? "step-limit"
          : null;

      return [
        {
          runId: row.id,
          triggerNodeId: row.triggerNodeId,
          displayNodeId,
          status: row.status,
          stepCount: cachedRun.stepCount,
          totalTokens: cachedRun.totalTokens,
          durationMs:
            typeof row.completedAt === "number"
              ? Math.max(0, row.completedAt - row.startedAt)
              : null,
          errorMessage:
            row.status === "failed" ? (cachedRun.errorSummary ?? "AI 回复失败。") : null,
          needsContinuation: continuationReason != null && !continuedByRunId.has(row.id),
          continuationReason,
          continuedByRunId: continuedByRunId.get(row.id) ?? null,
        } satisfies AgentRunSummaryView,
      ];
    })
    .sort((left, right) => {
      const leftIndex = activeIndexByNodeId.get(left.displayNodeId) ?? Number.MAX_SAFE_INTEGER;
      const rightIndex = activeIndexByNodeId.get(right.displayNodeId) ?? Number.MAX_SAFE_INTEGER;
      if (leftIndex !== rightIndex) {
        return leftIndex - rightIndex;
      }
      const leftRun = relevantRuns.find((row) => row.id === left.runId)!;
      const rightRun = relevantRuns.find((row) => row.id === right.runId)!;
      return leftRun.createdAt - rightRun.createdAt;
    });
}

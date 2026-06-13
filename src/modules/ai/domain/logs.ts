import type { ModelMessage } from "ai";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { type DatabaseExecutor, db, schema } from "@/db";
import { createId, invariant, now } from "@/shared/lib/domain";

import { PROJECT_ASSISTANT_MAX_STEPS, PROJECT_ASSISTANT_TOOL_NAMES } from "./types";
import type {
  AgentArtifactKind,
  AgentArtifactRow,
  AgentArtifactView,
  AgentCandidateGroupView,
  AgentCandidateNodeView,
  AgentPartState,
  AgentProjectStateRow,
  AgentProjectStateView,
  AgentRunEventKind,
  AgentRunEventRow,
  AgentRunEventView,
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
  AgentThreadNodePartRow,
  AgentThreadNodePartView,
  AgentThreadRole,
  AgentThreadNodeRow,
  AgentThreadNodeSourceKind,
  AgentThreadNodeView,
  AgentThreadRow,
  AgentThreadStateView,
  AgentThreadView,
  AgentVisibility,
  ProjectAssistantContextSnapshot,
  ProjectAssistantToolName,
} from "./types";

export const PROJECT_ASSISTANT_AGENT_PROFILE = "project-assistant";

interface CreateThreadInput {
  projectId: string;
  agentProfile?: string;
  title?: string | null;
}

interface CreateNodeInput {
  threadId: string;
  parentNodeId: string | null;
  message: ModelMessage;
  sourceKind: AgentThreadNodeSourceKind;
  createdByRunId?: string | null;
  sourceStepId?: string | null;
  summaryText?: string | null;
  extraParts?: CreateNodeExtraPartInput[];
}

interface CreateNodeExtraPartInput {
  partKind: AgentThreadNodePartKind;
  visibility?: AgentVisibility;
  state?: AgentPartState;
  providerOptions?: unknown;
  providerMetadata?: unknown;
  payload: unknown;
}

interface CreateRunInput {
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

interface CreateArtifactInput {
  runId?: string | null;
  stepId?: string | null;
  artifactKind: AgentArtifactKind;
  visibility: AgentVisibility;
  mimeType?: string | null;
  content: unknown;
  summaryText?: string | null;
}

interface CreateRunStepInput {
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

interface CreateRunEventInput {
  runId: string;
  stepId?: string | null;
  eventKind: AgentRunEventKind;
  nodeId?: string | null;
  relatedToolCallId?: string | null;
  relatedRunId?: string | null;
  summaryText?: string | null;
  payloadArtifactId?: string | null;
}

interface MaterializeResponseMessagesInput {
  threadId: string;
  parentNodeId: string | null;
  runId: string;
  stepId: string;
  messages: ModelMessage[];
}

function trimOptionalString(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeThreadTitle(title: string | null | undefined, fallback: string) {
  return trimOptionalString(title) ?? fallback;
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

function parseStoredJson<T>(raw: string | null): T | null {
  if (raw == null) {
    return null;
  }
  return JSON.parse(raw) as T;
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

function getThreadOrThrow(executor: DatabaseExecutor, threadId: string) {
  const thread = executor
    .select()
    .from(schema.agentThreads)
    .where(eq(schema.agentThreads.id, threadId))
    .get();
  invariant(thread, "未找到 agent thread。");
  return thread;
}

function getNodeOrThrow(executor: DatabaseExecutor, nodeId: string) {
  const node = executor
    .select()
    .from(schema.agentThreadNodes)
    .where(eq(schema.agentThreadNodes.id, nodeId))
    .get();
  invariant(node, "未找到 agent 节点。");
  return node;
}

function getRunOrThrow(executor: DatabaseExecutor, runId: string) {
  const run = executor.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, runId)).get();
  invariant(run, "未找到 agent run。");
  return run;
}

function getStepOrThrow(executor: DatabaseExecutor, stepId: string) {
  const step = executor
    .select()
    .from(schema.agentRunSteps)
    .where(eq(schema.agentRunSteps.id, stepId))
    .get();
  invariant(step, "未找到 run step。");
  return step;
}

function getArtifactOrThrow(executor: DatabaseExecutor, artifactId: string) {
  const artifact = executor
    .select()
    .from(schema.agentArtifacts)
    .where(eq(schema.agentArtifacts.id, artifactId))
    .get();
  invariant(artifact, "未找到 artifact。");
  return artifact;
}

function getProjectStateRow(executor: DatabaseExecutor, projectId: string, agentProfile: string) {
  return executor
    .select()
    .from(schema.agentProjectState)
    .where(
      and(
        eq(schema.agentProjectState.projectId, projectId),
        eq(schema.agentProjectState.agentProfile, agentProfile),
      ),
    )
    .get();
}

function getNodeRowsByThread(
  executor: DatabaseExecutor,
  threadId: string,
  parentNodeId: string | null,
) {
  return executor
    .select()
    .from(schema.agentThreadNodes)
    .where(
      parentNodeId == null
        ? and(
            eq(schema.agentThreadNodes.threadId, threadId),
            isNull(schema.agentThreadNodes.parentNodeId),
          )
        : and(
            eq(schema.agentThreadNodes.threadId, threadId),
            eq(schema.agentThreadNodes.parentNodeId, parentNodeId),
          ),
    )
    .orderBy(schema.agentThreadNodes.createdAt)
    .all();
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
  if (type === "text") {
    return "text";
  }
  if (type === "reasoning") {
    return "reasoning";
  }
  if (type === "tool-call") {
    return "tool-call";
  }
  if (type === "tool-result") {
    return "tool-result";
  }
  if (type === "tool-error") {
    return "tool-error";
  }
  if (type === "file") {
    return "file";
  }
  if (type === "step-start") {
    return "step-start";
  }
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
  if (partKind === "tool-call" || partKind === "tool-result" || partKind === "tool-error") {
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

function buildMessageSummary(message: ModelMessage) {
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

function mapProjectStateRow(row: AgentProjectStateRow): AgentProjectStateView {
  return {
    id: row.id,
    projectId: row.projectId,
    agentProfile: row.agentProfile,
    activeThreadId: row.activeThreadId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapThreadRow(row: AgentThreadRow): AgentThreadView {
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

function mapNodePartRow(row: AgentThreadNodePartRow): AgentThreadNodePartView {
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

function listNodePartViews(executor: DatabaseExecutor, nodeId: string) {
  return executor
    .select()
    .from(schema.agentThreadNodeParts)
    .where(eq(schema.agentThreadNodeParts.nodeId, nodeId))
    .orderBy(schema.agentThreadNodeParts.partIndex)
    .all()
    .map(mapNodePartRow);
}

function mapNodeRow(executor: DatabaseExecutor, row: AgentThreadNodeRow): AgentThreadNodeView {
  assertThreadRole(row.role);
  assertSourceKind(row.sourceKind);
  return {
    id: row.id,
    threadId: row.threadId,
    parentNodeId: row.parentNodeId,
    role: row.role,
    createdByRunId: row.createdByRunId,
    sourceStepId: row.sourceStepId,
    sourceKind: row.sourceKind,
    summaryText: row.summaryText,
    message: JSON.parse(row.messageJson) as ModelMessage,
    parts: listNodePartViews(executor, row.id),
    createdAt: row.createdAt,
  };
}

function mapArtifactRow(row: AgentArtifactRow): AgentArtifactView {
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

function mapRunRow(row: AgentRunRow): AgentRunView {
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
    selectionSnapshot: JSON.parse(row.selectionSnapshotJson),
    contextSnapshot: parseStoredJson<ProjectAssistantContextSnapshot>(row.contextSnapshotJson),
    inputRefsSnapshot: parseStoredJson<AssistantInputRefSnapshot[]>(row.inputRefsSnapshotJson),
    activeTools: parseStoredActiveTools(row.activeToolsJson),
    errorArtifactId: row.errorArtifactId,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function parseStoredActiveTools(value: string | null): ProjectAssistantToolName[] | null {
  const parsed = parseStoredJson<unknown>(value);
  if (!Array.isArray(parsed)) {
    return null;
  }

  const seen = new Set<ProjectAssistantToolName>();
  const tools: ProjectAssistantToolName[] = [];
  for (const entry of parsed) {
    if (
      typeof entry !== "string" ||
      !(PROJECT_ASSISTANT_TOOL_NAMES as readonly string[]).includes(entry)
    ) {
      continue;
    }
    const toolName = entry as ProjectAssistantToolName;
    if (seen.has(toolName)) {
      continue;
    }
    seen.add(toolName);
    tools.push(toolName);
  }
  return tools;
}

function mapRunStepRow(row: AgentRunStepRow): AgentRunStepView {
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

function normalizeUsageTotalTokens(usage: unknown): number | null {
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

function mapRunEventRow(row: AgentRunEventRow): AgentRunEventView {
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

function upsertProjectState(
  executor: DatabaseExecutor,
  projectId: string,
  agentProfile: string,
  activeThreadId: string | null,
) {
  getProjectOrThrow(executor, projectId);
  const stateId = `${projectId}:${agentProfile}`;
  const timestamp = now();
  const existing = getProjectStateRow(executor, projectId, agentProfile);

  if (existing) {
    executor
      .update(schema.agentProjectState)
      .set({
        activeThreadId,
        updatedAt: timestamp,
      })
      .where(eq(schema.agentProjectState.id, existing.id))
      .run();
  } else {
    executor
      .insert(schema.agentProjectState)
      .values({
        id: stateId,
        projectId,
        agentProfile,
        activeThreadId,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
  }

  return mapProjectStateRow(getProjectStateRow(executor, projectId, agentProfile)!);
}

function touchThread(executor: DatabaseExecutor, threadId: string) {
  executor
    .update(schema.agentThreads)
    .set({ updatedAt: now() })
    .where(eq(schema.agentThreads.id, threadId))
    .run();
}

function insertNode(executor: DatabaseExecutor, input: CreateNodeInput) {
  const thread = getThreadOrThrow(executor, input.threadId);
  if (input.parentNodeId) {
    const parent = getNodeOrThrow(executor, input.parentNodeId);
    invariant(parent.threadId === thread.id, "父节点不属于当前 thread。");
  }
  if (input.createdByRunId) {
    const run = getRunOrThrow(executor, input.createdByRunId);
    invariant(run.threadId === thread.id, "节点来源 run 不属于当前 thread。");
  }
  if (input.sourceStepId) {
    const step = getStepOrThrow(executor, input.sourceStepId);
    const run = getRunOrThrow(executor, step.runId);
    invariant(run.threadId === thread.id, "节点来源 step 不属于当前 thread。");
  }

  const id = createId("agent_node");
  const createdAt = now();
  const storedMessage = normalizeModelMessage(input.message);
  executor
    .insert(schema.agentThreadNodes)
    .values({
      id,
      threadId: thread.id,
      parentNodeId: input.parentNodeId,
      role: storedMessage.role,
      createdByRunId: trimOptionalString(input.createdByRunId),
      sourceStepId: trimOptionalString(input.sourceStepId),
      sourceKind: input.sourceKind,
      summaryText: normalizeSummaryText(input.summaryText) ?? buildMessageSummary(storedMessage),
      messageJson: serializeRequiredJson(storedMessage, "线程消息"),
      createdAt,
    })
    .run();

  const messageParts = normalizeMessageParts(input.message);
  const extraParts = normalizeExtraNodeParts(input.extraParts ?? [], messageParts.length);
  const parts = [...messageParts, ...extraParts];
  parts.forEach((part) => {
    executor
      .insert(schema.agentThreadNodeParts)
      .values({
        id: createId("agent_part"),
        nodeId: id,
        partIndex: part.partIndex,
        partKind: part.partKind,
        visibility: part.visibility,
        state: part.state,
        providerOptionsJson: serializeOptionalJson(part.providerOptions),
        providerMetadataJson: serializeOptionalJson(part.providerMetadata),
        payloadJson: serializeRequiredJson(part.payload, "节点 part"),
        createdAt,
      })
      .run();
  });

  touchThread(executor, thread.id);
  touchProject(executor, thread.projectId);
  return mapNodeRow(executor, getNodeOrThrow(executor, id));
}

function updateNodeMessage(
  executor: DatabaseExecutor,
  nodeId: string,
  message: ModelMessage,
  summaryText?: string | null,
) {
  const node = getNodeOrThrow(executor, nodeId);
  const storedMessage = normalizeModelMessage(message);
  executor
    .update(schema.agentThreadNodes)
    .set({
      messageJson: serializeRequiredJson(storedMessage, "线程消息"),
      summaryText:
        normalizeSummaryText(summaryText) ??
        normalizeSummaryText(buildMessageSummary(storedMessage)),
    })
    .where(eq(schema.agentThreadNodes.id, node.id))
    .run();
  touchThread(executor, node.threadId);
  return mapNodeRow(executor, getNodeOrThrow(executor, node.id));
}

function updateNodePart(
  executor: DatabaseExecutor,
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
  const row = executor
    .select()
    .from(schema.agentThreadNodeParts)
    .where(
      and(
        eq(schema.agentThreadNodeParts.nodeId, nodeId),
        eq(schema.agentThreadNodeParts.partIndex, partIndex),
      ),
    )
    .get();
  invariant(row, "未找到节点 part。");
  executor
    .update(schema.agentThreadNodeParts)
    .set({
      state,
      providerOptionsJson: serializeOptionalJson(providerOptions),
      providerMetadataJson: serializeOptionalJson(providerMetadata),
      payloadJson: serializeRequiredJson(payload, "节点 part"),
    })
    .where(eq(schema.agentThreadNodeParts.id, row.id))
    .run();
}

function appendNodePart(
  executor: DatabaseExecutor,
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
  const latest = executor
    .select({ partIndex: schema.agentThreadNodeParts.partIndex })
    .from(schema.agentThreadNodeParts)
    .where(eq(schema.agentThreadNodeParts.nodeId, nodeId))
    .orderBy(desc(schema.agentThreadNodeParts.partIndex))
    .get();
  const partIndex = (latest?.partIndex ?? -1) + 1;
  executor
    .insert(schema.agentThreadNodeParts)
    .values({
      id: createId("agent_part"),
      nodeId,
      partIndex,
      partKind: part.partKind,
      visibility: part.visibility,
      state: part.state,
      providerOptionsJson: serializeOptionalJson(part.providerOptions),
      providerMetadataJson: serializeOptionalJson(part.providerMetadata),
      payloadJson: serializeRequiredJson(part.payload, "节点 part"),
      createdAt: now(),
    })
    .run();
}

function getLatestUnarchivedThreadRow(
  executor: DatabaseExecutor,
  projectId: string,
  agentProfile: string,
) {
  return executor
    .select()
    .from(schema.agentThreads)
    .where(
      and(
        eq(schema.agentThreads.projectId, projectId),
        eq(schema.agentThreads.agentProfile, agentProfile),
        isNull(schema.agentThreads.archivedAt),
      ),
    )
    .orderBy(desc(schema.agentThreads.updatedAt), desc(schema.agentThreads.createdAt))
    .get();
}

export function listThreads(
  projectId: string,
  options?: { agentProfile?: string; archived?: boolean },
) {
  getProjectOrThrow(db, projectId);
  const agentProfile = trimOptionalString(options?.agentProfile);
  const archived = options?.archived;
  return db
    .select()
    .from(schema.agentThreads)
    .where(
      and(
        eq(schema.agentThreads.projectId, projectId),
        agentProfile ? eq(schema.agentThreads.agentProfile, agentProfile) : undefined,
        archived == null
          ? undefined
          : archived
            ? sql`${schema.agentThreads.archivedAt} IS NOT NULL`
            : isNull(schema.agentThreads.archivedAt),
      ),
    )
    .orderBy(desc(schema.agentThreads.updatedAt), desc(schema.agentThreads.createdAt))
    .all()
    .map(mapThreadRow);
}

export function getProjectState(projectId: string, agentProfile = PROJECT_ASSISTANT_AGENT_PROFILE) {
  getProjectOrThrow(db, projectId);
  const row = getProjectStateRow(db, projectId, agentProfile);
  return row ? mapProjectStateRow(row) : null;
}

export function resolveActiveThread(
  projectId: string,
  agentProfile = PROJECT_ASSISTANT_AGENT_PROFILE,
) {
  return db.transaction((tx) => {
    getProjectOrThrow(tx, projectId);
    const state = getProjectStateRow(tx, projectId, agentProfile);

    if (state?.activeThreadId) {
      const activeThread = tx
        .select()
        .from(schema.agentThreads)
        .where(eq(schema.agentThreads.id, state.activeThreadId))
        .get();
      if (
        activeThread &&
        activeThread.projectId === projectId &&
        activeThread.agentProfile === agentProfile &&
        activeThread.archivedAt == null
      ) {
        return mapThreadRow(activeThread);
      }
    }

    const fallback = getLatestUnarchivedThreadRow(tx, projectId, agentProfile);
    upsertProjectState(tx, projectId, agentProfile, fallback?.id ?? null);
    return fallback ? mapThreadRow(fallback) : null;
  });
}

export function createThread(input: CreateThreadInput) {
  return db.transaction((tx) => {
    getProjectOrThrow(tx, input.projectId);
    const agentProfile = trimOptionalString(input.agentProfile) ?? PROJECT_ASSISTANT_AGENT_PROFILE;
    const existingCount = tx
      .select({ id: schema.agentThreads.id })
      .from(schema.agentThreads)
      .where(
        and(
          eq(schema.agentThreads.projectId, input.projectId),
          eq(schema.agentThreads.agentProfile, agentProfile),
        ),
      )
      .all().length;
    const timestamp = now();
    const id = createId("agent_thread");
    tx.insert(schema.agentThreads)
      .values({
        id,
        projectId: input.projectId,
        agentProfile,
        title: normalizeThreadTitle(input.title, `新会话 ${existingCount + 1}`),
        activeTipNodeId: null,
        archivedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
    upsertProjectState(tx, input.projectId, agentProfile, id);
    touchProject(tx, input.projectId);
    return mapThreadRow(getThreadOrThrow(tx, id));
  });
}

export function renameThread(threadId: string, title: string) {
  return db.transaction((tx) => {
    const thread = getThreadOrThrow(tx, threadId);
    const normalizedTitle = trimOptionalString(title);
    invariant(normalizedTitle, "名称不能为空。");
    tx.update(schema.agentThreads)
      .set({
        title: normalizedTitle,
        updatedAt: now(),
      })
      .where(eq(schema.agentThreads.id, threadId))
      .run();
    touchProject(tx, thread.projectId);
    return mapThreadRow(getThreadOrThrow(tx, threadId));
  });
}

export function setActiveThread(projectId: string, threadId: string) {
  return db.transaction((tx) => {
    const thread = getThreadOrThrow(tx, threadId);
    invariant(thread.projectId === projectId, "thread 不属于当前项目。");
    invariant(thread.archivedAt == null, "不能激活已归档 thread。");
    upsertProjectState(tx, projectId, thread.agentProfile, thread.id);
    return mapThreadRow(thread);
  });
}

export function archiveThread(threadId: string, archived: boolean) {
  return db.transaction((tx) => {
    const thread = getThreadOrThrow(tx, threadId);
    tx.update(schema.agentThreads)
      .set({
        archivedAt: archived ? now() : null,
        updatedAt: now(),
      })
      .where(eq(schema.agentThreads.id, threadId))
      .run();
    const updated = getThreadOrThrow(tx, threadId);
    const state = getProjectStateRow(tx, thread.projectId, thread.agentProfile);
    if (archived && state?.activeThreadId === threadId) {
      const fallback = getLatestUnarchivedThreadRow(tx, thread.projectId, thread.agentProfile);
      upsertProjectState(tx, thread.projectId, thread.agentProfile, fallback?.id ?? null);
    }
    if (!archived && !state?.activeThreadId) {
      upsertProjectState(tx, thread.projectId, thread.agentProfile, threadId);
    }
    touchProject(tx, thread.projectId);
    return mapThreadRow(updated);
  });
}

export function resolveThreadPath(threadId: string, tipNodeId?: string | null) {
  const thread = getThreadOrThrow(db, threadId);
  const currentTipId = trimOptionalString(tipNodeId) ?? thread.activeTipNodeId;
  if (!currentTipId) {
    return [] as AgentThreadNodeView[];
  }

  const chain: AgentThreadNodeRow[] = [];
  const seen = new Set<string>();
  let currentId: string | null = currentTipId;

  while (currentId) {
    invariant(!seen.has(currentId), "thread 节点链存在循环。");
    seen.add(currentId);
    const row = getNodeOrThrow(db, currentId);
    invariant(row.threadId === thread.id, "thread 引用了其他会话的节点。");
    chain.push(row);
    currentId = row.parentNodeId;
  }

  return chain.reverse().map((row) => mapNodeRow(db, row));
}

export function buildThreadModelMessages(threadId: string, tipNodeId?: string | null) {
  return resolveThreadPath(threadId, tipNodeId).map((node) => node.message);
}

function resolveCandidateLeafTip(
  executor: DatabaseExecutor,
  threadId: string,
  candidateNodeId: string,
): string {
  let currentId = candidateNodeId;

  while (true) {
    const children = getNodeRowsByThread(executor, threadId, currentId);
    if (children.length !== 1) {
      return currentId;
    }
    currentId = children[0]!.id;
  }
}

export function getNodeCandidates(parentNodeId: string) {
  const parent = getNodeOrThrow(db, parentNodeId);
  return getNodeRowsByThread(db, parent.threadId, parentNodeId).map(
    (row): AgentCandidateNodeView => ({
      id: row.id,
      tipNodeId: resolveCandidateLeafTip(db, row.threadId, row.id),
      role: row.role as AgentThreadRole,
      summaryText: row.summaryText,
      createdAt: row.createdAt,
      createdByRunId: row.createdByRunId,
    }),
  );
}

function buildCandidateGroups(threadId: string, activePath: AgentThreadNodeView[]) {
  const activeNodeByParent = new Map<string | null, string>();
  activePath.forEach((node) => {
    activeNodeByParent.set(node.parentNodeId, node.id);
  });

  const groups: AgentCandidateGroupView[] = [];
  for (const [parentNodeId, activeNodeId] of activeNodeByParent.entries()) {
    const candidates = getNodeRowsByThread(db, threadId, parentNodeId);
    if (candidates.length <= 1) {
      continue;
    }
    groups.push({
      parentNodeId,
      activeNodeId,
      nodes: candidates.map((row) => ({
        id: row.id,
        tipNodeId: resolveCandidateLeafTip(db, row.threadId, row.id),
        role: row.role as AgentThreadRole,
        summaryText: row.summaryText,
        createdAt: row.createdAt,
        createdByRunId: row.createdByRunId,
      })),
    });
  }
  return groups;
}

function buildRunSummaries(threadId: string, activePath: AgentThreadNodeView[]) {
  const activeNodeIds = new Set(activePath.map((node) => node.id));
  const activeIndexByNodeId = new Map(activePath.map((node, index) => [node.id, index]));
  const includedRunIds = new Set(
    activePath.flatMap((node) => (node.createdByRunId ? [node.createdByRunId] : [])),
  );
  const assistantDisplayNodeByRunId = new Map<string, string>();

  activePath.forEach((node) => {
    if (node.role === "assistant" && node.createdByRunId) {
      assistantDisplayNodeByRunId.set(node.createdByRunId, node.id);
    }
  });

  const runRows = db
    .select()
    .from(schema.agentRuns)
    .where(eq(schema.agentRuns.threadId, threadId))
    .orderBy(schema.agentRuns.createdAt)
    .all();
  const relevantRunRows = runRows.filter((row) => {
    if (includedRunIds.has(row.id)) {
      return true;
    }
    return (
      row.status === "failed" && row.triggerNodeId != null && activeNodeIds.has(row.triggerNodeId)
    );
  });
  const relevantRuns = relevantRunRows.map(mapRunRow);

  if (relevantRuns.length === 0) {
    return [] as AgentRunSummaryView[];
  }

  const runIds = relevantRuns.map((run) => run.id);
  const stepRows =
    runIds.length > 0
      ? db
          .select()
          .from(schema.agentRunSteps)
          .where(inArray(schema.agentRunSteps.runId, runIds))
          .orderBy(schema.agentRunSteps.runId, schema.agentRunSteps.stepIndex)
          .all()
      : [];
  const errorArtifactIds = relevantRuns.flatMap((row) =>
    row.errorArtifactId ? [row.errorArtifactId] : [],
  );
  const errorArtifacts =
    errorArtifactIds.length > 0
      ? db
          .select()
          .from(schema.agentArtifacts)
          .where(inArray(schema.agentArtifacts.id, errorArtifactIds))
          .all()
      : [];
  const stepsByRunId = new Map<string, AgentRunStepRow[]>();
  const errorArtifactById = new Map(errorArtifacts.map((artifact) => [artifact.id, artifact]));
  const continuedByRunId = new Map<string, string>();

  stepRows.forEach((row) => {
    const entries = stepsByRunId.get(row.runId) ?? [];
    entries.push(row);
    stepsByRunId.set(row.runId, entries);
  });
  relevantRuns.forEach((row) => {
    if (row.parentRunId && row.runMode === "continue") {
      continuedByRunId.set(row.parentRunId, row.id);
    }
  });

  return relevantRuns
    .flatMap((row) => {
      const displayNodeId =
        assistantDisplayNodeByRunId.get(row.id) ??
        (row.triggerNodeId && activeNodeIds.has(row.triggerNodeId) ? row.triggerNodeId : null);
      if (!displayNodeId) {
        return [];
      }

      const stepEntries = stepsByRunId.get(row.id) ?? [];
      const totalTokens = stepEntries.reduce<number | null>((sum, step) => {
        const value = normalizeUsageTotalTokens(parseStoredJson(step.usageJson));
        if (value == null) {
          return sum;
        }
        return (sum ?? 0) + value;
      }, null);
      const errorArtifact = row.errorArtifactId
        ? (errorArtifactById.get(row.errorArtifactId) ?? null)
        : null;
      const lastStep = stepEntries.at(-1);
      const continuationReason =
        row.status === "succeeded" &&
        row.activeTools != null &&
        stepEntries.length >= PROJECT_ASSISTANT_MAX_STEPS &&
        lastStep?.finishReason === "tool-calls"
          ? "step-limit"
          : null;

      return [
        {
          runId: row.id,
          triggerNodeId: row.triggerNodeId,
          displayNodeId,
          status: row.status,
          stepCount: stepEntries.length,
          totalTokens,
          durationMs:
            typeof row.completedAt === "number"
              ? Math.max(0, row.completedAt - row.startedAt)
              : null,
          errorMessage:
            row.status === "failed" ? (errorArtifact?.summaryText ?? "AI 回复失败。") : null,
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

export function listLatestRuns(threadId: string, limit = 10) {
  getThreadOrThrow(db, threadId);
  return db
    .select()
    .from(schema.agentRuns)
    .where(eq(schema.agentRuns.threadId, threadId))
    .orderBy(desc(schema.agentRuns.createdAt))
    .limit(limit)
    .all()
    .map(mapRunRow);
}

export function getLatestRunForTriggerNode(threadId: string, triggerNodeId: string) {
  getThreadOrThrow(db, threadId);
  return (
    db
      .select()
      .from(schema.agentRuns)
      .where(
        and(
          eq(schema.agentRuns.threadId, threadId),
          eq(schema.agentRuns.triggerNodeId, triggerNodeId),
        ),
      )
      .orderBy(desc(schema.agentRuns.createdAt))
      .limit(1)
      .all()
      .map(mapRunRow)[0] ?? null
  );
}

export function getThreadView(threadId: string): AgentThreadStateView {
  const thread = getThreadOrThrow(db, threadId);
  const activePath = resolveThreadPath(thread.id);
  return {
    thread: mapThreadRow(thread),
    activePath,
    candidateGroups: buildCandidateGroups(thread.id, activePath),
    latestRuns: listLatestRuns(thread.id),
    runSummaries: buildRunSummaries(thread.id, activePath),
  };
}

export function hasPendingRun(threadId: string) {
  getThreadOrThrow(db, threadId);
  const row = db
    .select({ id: schema.agentRuns.id })
    .from(schema.agentRuns)
    .where(
      and(
        eq(schema.agentRuns.threadId, threadId),
        sql`${schema.agentRuns.status} IN ('queued', 'running')`,
      ),
    )
    .get();
  return row != null;
}

export function selectActiveTip(threadId: string, tipNodeId: string) {
  return db.transaction((tx) => {
    const thread = getThreadOrThrow(tx, threadId);
    const node = getNodeOrThrow(tx, tipNodeId);
    invariant(node.threadId === thread.id, "候选节点不属于当前 thread。");
    tx.update(schema.agentThreads)
      .set({
        activeTipNodeId: node.id,
        updatedAt: now(),
      })
      .where(eq(schema.agentThreads.id, thread.id))
      .run();
    touchProject(tx, thread.projectId);
    return mapThreadRow(getThreadOrThrow(tx, thread.id));
  });
}

export function appendUserNode(input: {
  threadId: string;
  parentNodeId: string | null;
  message: ModelMessage;
  sourceKind?: Extract<AgentThreadNodeSourceKind, "user_input" | "edit_rewrite">;
  extraParts?: CreateNodeExtraPartInput[];
}) {
  return db.transaction((tx) => {
    const node = insertNode(tx, {
      threadId: input.threadId,
      parentNodeId: input.parentNodeId,
      message: input.message,
      sourceKind: input.sourceKind ?? "user_input",
      extraParts: input.extraParts,
    });
    tx.update(schema.agentThreads)
      .set({
        activeTipNodeId: node.id,
        updatedAt: now(),
      })
      .where(eq(schema.agentThreads.id, input.threadId))
      .run();
    return node;
  });
}

export function createReplacementNode(input: {
  threadId: string;
  nodeId: string;
  message: ModelMessage;
  extraParts?: CreateNodeExtraPartInput[];
}) {
  return db.transaction((tx) => {
    const node = getNodeOrThrow(tx, input.nodeId);
    invariant(node.threadId === input.threadId, "待修改节点不属于当前 thread。");
    const replacement = insertNode(tx, {
      threadId: input.threadId,
      parentNodeId: node.parentNodeId,
      message: input.message,
      sourceKind: "edit_rewrite",
      extraParts: input.extraParts,
    });
    tx.update(schema.agentThreads)
      .set({
        activeTipNodeId: replacement.id,
        updatedAt: now(),
      })
      .where(eq(schema.agentThreads.id, input.threadId))
      .run();
    return replacement;
  });
}

export function createRun(input: CreateRunInput) {
  return db.transaction((tx) => {
    const thread = getThreadOrThrow(tx, input.threadId);
    const status = input.status ?? "running";
    if (input.parentRunId) {
      const parentRun = getRunOrThrow(tx, input.parentRunId);
      invariant(parentRun.threadId === thread.id, "父 run 不属于当前 thread。");
    }
    if (input.triggerNodeId) {
      const triggerNode = getNodeOrThrow(tx, input.triggerNodeId);
      invariant(triggerNode.threadId === thread.id, "触发节点不属于当前 thread。");
    }
    if (input.baseTipNodeId) {
      const baseTipNode = getNodeOrThrow(tx, input.baseTipNodeId);
      invariant(baseTipNode.threadId === thread.id, "base tip 不属于当前 thread。");
    }
    const id = createId("agent_run");
    const timestamp = now();
    tx.insert(schema.agentRuns)
      .values({
        id,
        threadId: thread.id,
        parentRunId: trimOptionalString(input.parentRunId),
        parentEventId: trimOptionalString(input.parentEventId),
        triggerNodeId: trimOptionalString(input.triggerNodeId),
        baseTipNodeId: trimOptionalString(input.baseTipNodeId),
        runMode: input.runMode,
        status,
        agentProfile: input.agentProfile,
        selectionSnapshotJson: serializeRequiredJson(input.selectionSnapshot ?? {}, "run 选择快照"),
        contextSnapshotJson: serializeOptionalJson(input.contextSnapshot),
        inputRefsSnapshotJson: serializeOptionalJson(input.inputRefsSnapshot),
        activeToolsJson: serializeOptionalJson(input.activeTools),
        errorArtifactId: null,
        startedAt: timestamp,
        completedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
    touchThread(tx, thread.id);
    touchProject(tx, thread.projectId);
    return mapRunRow(getRunOrThrow(tx, id));
  });
}

export function createArtifact(input: CreateArtifactInput) {
  return db.transaction((tx) => {
    if (input.runId) {
      getRunOrThrow(tx, input.runId);
    }
    if (input.stepId) {
      getStepOrThrow(tx, input.stepId);
    }
    const id = createId("agent_artifact");
    tx.insert(schema.agentArtifacts)
      .values({
        id,
        runId: trimOptionalString(input.runId),
        stepId: trimOptionalString(input.stepId),
        artifactKind: input.artifactKind,
        visibility: input.visibility,
        mimeType: trimOptionalString(input.mimeType),
        contentJson: serializeRequiredJson(input.content, "artifact 内容"),
        summaryText: normalizeSummaryText(input.summaryText),
        createdAt: now(),
      })
      .run();
    return mapArtifactRow(getArtifactOrThrow(tx, id));
  });
}

export function createRunStep(input: CreateRunStepInput) {
  return db.transaction((tx) => {
    const run = getRunOrThrow(tx, input.runId);
    const id = createId("agent_step");
    const timestamp = now();
    tx.insert(schema.agentRunSteps)
      .values({
        id,
        runId: run.id,
        stepIndex: input.stepIndex,
        provider: input.provider,
        modelId: input.modelId,
        finishReason: trimOptionalString(input.finishReason),
        rawFinishReason: trimOptionalString(input.rawFinishReason),
        systemJson: serializeOptionalJson(input.system),
        preparedMessagesArtifactId: trimOptionalString(input.preparedMessagesArtifactId),
        responseMessagesArtifactId: trimOptionalString(input.responseMessagesArtifactId),
        requestBodyArtifactId: trimOptionalString(input.requestBodyArtifactId),
        responseBodyArtifactId: trimOptionalString(input.responseBodyArtifactId),
        providerMetadataArtifactId: trimOptionalString(input.providerMetadataArtifactId),
        usageJson: serializeOptionalJson(input.usage),
        startedAt: timestamp,
        completedAt: timestamp,
        createdAt: timestamp,
      })
      .run();
    tx.update(schema.agentRuns)
      .set({ updatedAt: timestamp })
      .where(eq(schema.agentRuns.id, run.id))
      .run();
    return mapRunStepRow(getStepOrThrow(tx, id));
  });
}

function nextRunEventSeq(executor: DatabaseExecutor, runId: string) {
  const latest = executor
    .select({ seq: schema.agentRunEvents.seq })
    .from(schema.agentRunEvents)
    .where(eq(schema.agentRunEvents.runId, runId))
    .orderBy(desc(schema.agentRunEvents.seq))
    .get();
  return (latest?.seq ?? 0) + 1;
}

export function appendRunEvent(input: CreateRunEventInput) {
  return db.transaction((tx) => {
    const run = getRunOrThrow(tx, input.runId);
    if (input.stepId) {
      const step = getStepOrThrow(tx, input.stepId);
      invariant(step.runId === run.id, "事件 step 不属于当前 run。");
    }
    if (input.nodeId) {
      const node = getNodeOrThrow(tx, input.nodeId);
      invariant(node.threadId === run.threadId, "事件节点不属于当前 run 所在 thread。");
    }
    if (input.relatedRunId) {
      getRunOrThrow(tx, input.relatedRunId);
    }
    const id = createId("agent_event");
    tx.insert(schema.agentRunEvents)
      .values({
        id,
        runId: run.id,
        stepId: trimOptionalString(input.stepId),
        seq: nextRunEventSeq(tx, run.id),
        eventKind: input.eventKind,
        nodeId: trimOptionalString(input.nodeId),
        relatedToolCallId: trimOptionalString(input.relatedToolCallId),
        relatedRunId: trimOptionalString(input.relatedRunId),
        summaryText: normalizeSummaryText(input.summaryText),
        payloadArtifactId: trimOptionalString(input.payloadArtifactId),
        createdAt: now(),
      })
      .run();
    tx.update(schema.agentRuns)
      .set({ updatedAt: now() })
      .where(eq(schema.agentRuns.id, run.id))
      .run();
    return mapRunEventRow(
      tx.select().from(schema.agentRunEvents).where(eq(schema.agentRunEvents.id, id)).get()!,
    );
  });
}

export function materializeResponseMessages(input: MaterializeResponseMessagesInput) {
  return db.transaction((tx) => {
    const thread = getThreadOrThrow(tx, input.threadId);
    let parentNodeId = input.parentNodeId;
    const nodes: AgentThreadNodeView[] = [];

    input.messages.forEach((message) => {
      const node = insertNode(tx, {
        threadId: thread.id,
        parentNodeId,
        message,
        sourceKind: message.role === "tool" ? "tool_result" : "model_response",
        createdByRunId: input.runId,
        sourceStepId: input.stepId,
      });
      parentNodeId = node.id;
      nodes.push(node);
    });

    return {
      nodes,
      tipNodeId: parentNodeId,
    };
  });
}

export function createStreamingAssistantNode(input: {
  threadId: string;
  parentNodeId: string | null;
  runId: string;
  stepId?: string | null;
}) {
  return db.transaction((tx) => {
    const node = insertNode(tx, {
      threadId: input.threadId,
      parentNodeId: input.parentNodeId,
      message: {
        role: "assistant",
        content: [],
      } as unknown as ModelMessage,
      sourceKind: "model_response",
      createdByRunId: input.runId,
      sourceStepId: trimOptionalString(input.stepId),
      summaryText: "助手回复",
    });
    tx.update(schema.agentThreads)
      .set({
        activeTipNodeId: node.id,
        updatedAt: now(),
      })
      .where(eq(schema.agentThreads.id, input.threadId))
      .run();
    return node;
  });
}

export function appendAssistantTextDelta(input: { nodeId: string; delta: string }) {
  return db.transaction((tx) => {
    const node = getNodeOrThrow(tx, input.nodeId);
    invariant(node.role === "assistant", "只能向 assistant 节点追加文本。");
    const message = JSON.parse(node.messageJson) as ModelMessage;
    const rawContent = (message as { content?: unknown }).content;
    const content =
      typeof rawContent === "string"
        ? [{ type: "text", text: rawContent }]
        : Array.isArray(rawContent)
          ? [...rawContent]
          : [];

    let textPartIndex = content.findIndex(
      (part) =>
        part &&
        typeof part === "object" &&
        Reflect.get(part as Record<string, unknown>, "type") === "text",
    );
    const hadExistingTextPart = textPartIndex >= 0;

    if (!hadExistingTextPart) {
      content.push({ type: "text", text: "", state: "streaming" });
      textPartIndex = content.length - 1;
    }

    const existingPart = content[textPartIndex];
    const nextPart = {
      ...(existingPart as Record<string, unknown>),
      type: "text",
      text: `${String(Reflect.get(existingPart as Record<string, unknown>, "text") ?? "")}${input.delta}`,
      state: "streaming",
    };
    content[textPartIndex] = nextPart;

    const nextMessage = {
      ...message,
      content,
    } as ModelMessage;
    updateNodeMessage(tx, node.id, nextMessage);
    if (hadExistingTextPart) {
      updateNodePart(tx, node.id, textPartIndex, {
        payload: nextPart,
        state: "streaming",
        providerOptions: Reflect.get(nextPart, "providerOptions"),
        providerMetadata: Reflect.get(nextPart, "providerMetadata"),
      });
    } else {
      appendNodePart(tx, node.id, {
        partKind: "text",
        visibility: "public",
        state: "streaming",
        payload: nextPart,
        providerOptions: Reflect.get(nextPart, "providerOptions"),
        providerMetadata: Reflect.get(nextPart, "providerMetadata"),
      });
    }
    return mapNodeRow(tx, getNodeOrThrow(tx, node.id));
  });
}

export function appendAssistantReasoningPart(input: {
  nodeId: string;
  providerMetadata?: unknown;
}) {
  return db.transaction((tx) => {
    const node = getNodeOrThrow(tx, input.nodeId);
    invariant(node.role === "assistant", "只能向 assistant 节点追加 reasoning。");
    const message = JSON.parse(node.messageJson) as ModelMessage;
    const rawContent = (message as { content?: unknown }).content;
    const content =
      typeof rawContent === "string"
        ? [{ type: "text", text: rawContent }]
        : Array.isArray(rawContent)
          ? [...rawContent]
          : [];
    const nextPart = {
      type: "reasoning",
      text: "",
      state: "streaming",
      ...(input.providerMetadata == null ? {} : { providerMetadata: input.providerMetadata }),
    };
    const partIndex = content.length;
    content.push(nextPart);
    const nextMessage = {
      ...message,
      content,
    } as ModelMessage;
    const nextNode = updateNodeMessage(tx, node.id, nextMessage);
    appendNodePart(tx, node.id, {
      partKind: "reasoning",
      visibility: "hidden",
      state: "streaming",
      payload: nextPart,
      providerOptions: Reflect.get(nextPart, "providerOptions"),
      providerMetadata: input.providerMetadata,
    });
    return {
      node: nextNode,
      partIndex,
    };
  });
}

export function appendAssistantReasoningDelta(input: {
  nodeId: string;
  partIndex: number;
  delta: string;
  providerMetadata?: unknown;
}) {
  return db.transaction((tx) => {
    const node = getNodeOrThrow(tx, input.nodeId);
    invariant(node.role === "assistant", "只能向 assistant 节点追加 reasoning。");
    const message = JSON.parse(node.messageJson) as ModelMessage;
    const rawContent = (message as { content?: unknown }).content;
    const content =
      typeof rawContent === "string"
        ? [{ type: "text", text: rawContent }]
        : Array.isArray(rawContent)
          ? [...rawContent]
          : [];
    const existingPart = content[input.partIndex];
    invariant(existingPart && typeof existingPart === "object", "未找到 reasoning part。");
    invariant(
      Reflect.get(existingPart as Record<string, unknown>, "type") === "reasoning",
      "目标 part 不是 reasoning。",
    );

    const nextPart = {
      ...(existingPart as Record<string, unknown>),
      type: "reasoning",
      text: `${String(Reflect.get(existingPart as Record<string, unknown>, "text") ?? "")}${input.delta}`,
      state: "streaming",
      ...(input.providerMetadata == null ? {} : { providerMetadata: input.providerMetadata }),
    };
    content[input.partIndex] = nextPart;

    const nextMessage = {
      ...message,
      content,
    } as ModelMessage;
    updateNodeMessage(tx, node.id, nextMessage);
    updateNodePart(tx, node.id, input.partIndex, {
      payload: nextPart,
      state: "streaming",
      providerOptions: Reflect.get(nextPart, "providerOptions"),
      providerMetadata: input.providerMetadata ?? Reflect.get(nextPart, "providerMetadata"),
    });
    return mapNodeRow(tx, getNodeOrThrow(tx, node.id));
  });
}

export function appendAssistantToolCallPart(input: {
  nodeId: string;
  toolCall: Record<string, unknown>;
}) {
  return db.transaction((tx) => {
    const node = getNodeOrThrow(tx, input.nodeId);
    invariant(node.role === "assistant", "只能向 assistant 节点追加工具调用。");
    const message = JSON.parse(node.messageJson) as ModelMessage;
    const rawContent = (message as { content?: unknown }).content;
    const content =
      typeof rawContent === "string"
        ? [{ type: "text", text: rawContent }]
        : Array.isArray(rawContent)
          ? [...rawContent]
          : [];
    const nextPart = {
      type: "tool-call",
      ...input.toolCall,
    };
    content.push(nextPart);
    const nextMessage = {
      ...message,
      content,
    } as ModelMessage;
    const nextNode = updateNodeMessage(tx, node.id, nextMessage);
    appendNodePart(tx, node.id, {
      partKind: "tool-call",
      visibility: "internal",
      state: "done",
      payload: nextPart,
      providerOptions: Reflect.get(nextPart, "providerOptions"),
      providerMetadata: Reflect.get(nextPart, "providerMetadata"),
    });
    return nextNode;
  });
}

export function createStreamingToolResultNode(input: {
  threadId: string;
  parentNodeId: string | null;
  runId: string;
  stepId?: string | null;
  toolResult: Record<string, unknown>;
}) {
  return db.transaction((tx) => {
    const node = insertNode(tx, {
      threadId: input.threadId,
      parentNodeId: input.parentNodeId,
      message: {
        role: "tool",
        content: [{ type: "tool-result", ...input.toolResult }],
      } as unknown as ModelMessage,
      sourceKind: "tool_result",
      createdByRunId: input.runId,
      sourceStepId: trimOptionalString(input.stepId),
    });
    tx.update(schema.agentThreads)
      .set({
        activeTipNodeId: node.id,
        updatedAt: now(),
      })
      .where(eq(schema.agentThreads.id, input.threadId))
      .run();
    return node;
  });
}

export function markThreadNodePartsDone(nodeId: string) {
  return db.transaction((tx) => {
    const node = getNodeOrThrow(tx, nodeId);
    const message = JSON.parse(node.messageJson) as ModelMessage;
    const rawContent = (message as { content?: unknown }).content;
    const content =
      typeof rawContent === "string"
        ? [{ type: "text", text: rawContent }]
        : Array.isArray(rawContent)
          ? rawContent.map((part) => {
              if (!part || typeof part !== "object") {
                return part;
              }
              if (
                Reflect.get(part as Record<string, unknown>, "state") === "streaming" ||
                Reflect.get(part as Record<string, unknown>, "state") === "done"
              ) {
                return {
                  ...(part as Record<string, unknown>),
                  state: "done",
                };
              }
              return part;
            })
          : [];
    const nextMessage = {
      ...message,
      content,
    } as ModelMessage;
    tx.update(schema.agentThreadNodeParts)
      .set({ state: "done" })
      .where(eq(schema.agentThreadNodeParts.nodeId, node.id))
      .run();
    return updateNodeMessage(tx, node.id, nextMessage);
  });
}

export function assignThreadNodeSourceStepIds(nodeIds: string[], stepId: string) {
  if (nodeIds.length === 0) {
    return;
  }

  db.transaction((tx) => {
    getStepOrThrow(tx, stepId);
    nodeIds.forEach((nodeId) => {
      getNodeOrThrow(tx, nodeId);
      tx.update(schema.agentThreadNodes)
        .set({ sourceStepId: stepId })
        .where(eq(schema.agentThreadNodes.id, nodeId))
        .run();
    });
  });
}

export function updateRunStep(input: {
  stepId: string;
  finishReason?: string | null;
  rawFinishReason?: string | null;
  preparedMessagesArtifactId?: string | null;
  responseMessagesArtifactId?: string | null;
  requestBodyArtifactId?: string | null;
  responseBodyArtifactId?: string | null;
  providerMetadataArtifactId?: string | null;
  usage?: unknown;
}) {
  return db.transaction((tx) => {
    const step = getStepOrThrow(tx, input.stepId);
    tx.update(schema.agentRunSteps)
      .set({
        finishReason: trimOptionalString(input.finishReason),
        rawFinishReason: trimOptionalString(input.rawFinishReason),
        preparedMessagesArtifactId: trimOptionalString(input.preparedMessagesArtifactId),
        responseMessagesArtifactId: trimOptionalString(input.responseMessagesArtifactId),
        requestBodyArtifactId: trimOptionalString(input.requestBodyArtifactId),
        responseBodyArtifactId: trimOptionalString(input.responseBodyArtifactId),
        providerMetadataArtifactId: trimOptionalString(input.providerMetadataArtifactId),
        usageJson: serializeOptionalJson(input.usage),
        completedAt: now(),
      })
      .where(eq(schema.agentRunSteps.id, step.id))
      .run();
    return mapRunStepRow(getStepOrThrow(tx, step.id));
  });
}

export function markRunSucceeded(runId: string) {
  return db.transaction((tx) => {
    const run = getRunOrThrow(tx, runId);
    tx.update(schema.agentRuns)
      .set({
        status: "succeeded",
        completedAt: now(),
        updatedAt: now(),
      })
      .where(eq(schema.agentRuns.id, run.id))
      .run();
    return mapRunRow(getRunOrThrow(tx, run.id));
  });
}

export function markRunFailed(runId: string, errorArtifactId?: string | null) {
  return db.transaction((tx) => {
    const run = getRunOrThrow(tx, runId);
    if (errorArtifactId) {
      getArtifactOrThrow(tx, errorArtifactId);
    }
    tx.update(schema.agentRuns)
      .set({
        status: "failed",
        errorArtifactId: trimOptionalString(errorArtifactId),
        completedAt: now(),
        updatedAt: now(),
      })
      .where(eq(schema.agentRuns.id, run.id))
      .run();
    return mapRunRow(getRunOrThrow(tx, run.id));
  });
}

export function markRunCancelled(runId: string) {
  return db.transaction((tx) => {
    const run = getRunOrThrow(tx, runId);
    tx.update(schema.agentRuns)
      .set({
        status: "cancelled",
        completedAt: now(),
        updatedAt: now(),
      })
      .where(eq(schema.agentRuns.id, run.id))
      .run();
    return mapRunRow(getRunOrThrow(tx, run.id));
  });
}

export function updateRunContextSnapshot(
  runId: string,
  contextSnapshot: ProjectAssistantContextSnapshot | null,
) {
  return db.transaction((tx) => {
    const run = getRunOrThrow(tx, runId);
    tx.update(schema.agentRuns)
      .set({
        contextSnapshotJson: serializeOptionalJson(contextSnapshot),
        updatedAt: now(),
      })
      .where(eq(schema.agentRuns.id, run.id))
      .run();
    return mapRunRow(getRunOrThrow(tx, run.id));
  });
}

export function getRunTrace(runId: string): AgentRunTraceView {
  const run = getRunOrThrow(db, runId);
  const steps = db
    .select()
    .from(schema.agentRunSteps)
    .where(eq(schema.agentRunSteps.runId, run.id))
    .orderBy(schema.agentRunSteps.stepIndex)
    .all()
    .map(mapRunStepRow);
  const events = db
    .select()
    .from(schema.agentRunEvents)
    .where(eq(schema.agentRunEvents.runId, run.id))
    .orderBy(schema.agentRunEvents.seq)
    .all()
    .map(mapRunEventRow);
  const artifacts = db
    .select()
    .from(schema.agentArtifacts)
    .where(eq(schema.agentArtifacts.runId, run.id))
    .orderBy(schema.agentArtifacts.createdAt)
    .all()
    .map(mapArtifactRow);
  const childRuns = db
    .select()
    .from(schema.agentRuns)
    .where(eq(schema.agentRuns.parentRunId, run.id))
    .orderBy(schema.agentRuns.createdAt)
    .all()
    .map(mapRunRow);

  return {
    run: mapRunRow(run),
    steps,
    events,
    artifacts,
    childRuns,
  };
}

export function listChildRuns(runId: string) {
  getRunOrThrow(db, runId);
  return db
    .select()
    .from(schema.agentRuns)
    .where(eq(schema.agentRuns.parentRunId, runId))
    .orderBy(schema.agentRuns.createdAt)
    .all()
    .map(mapRunRow);
}

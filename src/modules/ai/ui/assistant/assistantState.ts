import type {
  AgentCandidateGroupView,
  AgentRunSummaryView,
  AgentRunView,
  AgentThreadNodeView,
  AgentThreadStateView,
  AgentThreadView,
  AgentToolTraceStatus,
  AssistantInputRefDisplay,
  AssistantMentionInput,
  ProjectAssistantContextSnapshot,
} from "@/modules/ai/domain/types";

export type AssistantState = AgentThreadStateView;

export type EditingThreadState = {
  threadId: string;
  title: string;
};

export type PendingAssistantAction =
  | {
      kind: "send";
      text: string;
      mentions: AssistantMentionInput[];
    }
  | {
      kind: "retry";
      triggerNodeId: string;
    }
  | {
      kind: "continue";
      runId: string;
    }
  | {
      kind: "tool-input";
      runId: string;
      toolCallId: string;
    };

export const EMPTY_ASSISTANT_STATE: AssistantState = {
  thread: null,
  activePath: [],
  candidateGroups: [],
  latestRuns: [],
  runSummaries: [],
};

export const EMPTY_THREADS: AgentThreadView[] = [];

export interface AssistantToolTraceEntry {
  toolCallId: string | null;
  toolName: string;
  status: AgentToolTraceStatus | "pending";
  summary: string;
  nodeId: string;
  runId: string | null;
  requestPayload: unknown | null;
  responsePayload: unknown | null;
}

export interface AssistantAskUserOption {
  id: string;
  label: string;
  description?: string;
}

export type AssistantAskUserQuestion =
  | {
      id: string;
      prompt: string;
      kind: "single_choice";
      options: AssistantAskUserOption[];
    }
  | {
      id: string;
      prompt: string;
      kind: "free_text";
    };

export type AssistantAskUserAnswer =
  | {
      questionId: string;
      type: "single_choice";
      optionId: string;
    }
  | {
      questionId: string;
      type: "single_choice";
      text: string;
    }
  | {
      questionId: string;
      type: "free_text";
      text: string;
    };

export interface AssistantAskUserEntry {
  toolCallId: string;
  title: string | null;
  questions: AssistantAskUserQuestion[];
  answers: AssistantAskUserAnswer[] | null;
}

export interface AssistantReasoningEntry {
  partId: string;
  text: string;
}

export interface AssistantContentBlock {
  kind: "text" | "reasoning";
  blockId: string;
  text: string;
}

export function getRunSummaryByDisplayNode(
  summaries: AgentRunSummaryView[],
  displayNodeId: string,
) {
  return summaries.filter((summary) => summary.displayNodeId === displayNodeId);
}

export function getUsageTotalTokens(usage: unknown) {
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

export function getMessageText(node: AgentThreadNodeView | null | undefined) {
  const content = (node?.message as { content?: unknown } | undefined)?.content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .flatMap((part) => {
      if (!part || typeof part !== "object") {
        return [];
      }
      return Reflect.get(part as Record<string, unknown>, "type") === "text"
        ? [Reflect.get(part as Record<string, unknown>, "text")]
        : [];
    })
    .filter((value): value is string => typeof value === "string")
    .join("\n");
}

export function getAssistantRefDisplays(
  node: AgentThreadNodeView | null | undefined,
): AssistantInputRefDisplay[] {
  if (!node || node.role !== "user") {
    return [];
  }

  return node.parts.flatMap((part) => {
    if (part.partKind !== "data-assistant-ref") {
      return [];
    }
    const payload = part.payload;
    if (!payload || typeof payload !== "object") {
      return [];
    }
    const refId = Reflect.get(payload, "refId");
    const kind = Reflect.get(payload, "kind");
    const mode = Reflect.get(payload, "mode");
    const label = Reflect.get(payload, "label");
    if (
      typeof refId !== "string" ||
      kind !== "global-prompt" ||
      mode !== "snapshot-ref" ||
      typeof label !== "string"
    ) {
      return [];
    }
    return [
      {
        refId,
        kind,
        mode,
        label,
      },
    ];
  });
}

export function getAssistantContentBlocks(node: AgentThreadNodeView | null | undefined) {
  if (!node || node.role !== "assistant") {
    return [] as AssistantContentBlock[];
  }

  const blocks: AssistantContentBlock[] = [];

  node.parts.forEach((part) => {
    if (part.partKind !== "text" && part.partKind !== "reasoning") {
      return;
    }

    const payload = part.payload;
    if (!payload || typeof payload !== "object") {
      return;
    }

    const text = Reflect.get(payload as Record<string, unknown>, "text");
    if (typeof text !== "string" || text.length === 0) {
      return;
    }

    const kind = part.partKind;
    const previousBlock = blocks.at(-1);
    if (previousBlock?.kind === kind) {
      previousBlock.text = `${previousBlock.text}\n${text}`;
      return;
    }

    blocks.push({
      kind,
      blockId: part.id,
      text,
    });
  });

  return blocks;
}

export function getAssistantReasoning(node: AgentThreadNodeView | null | undefined) {
  if (!node || node.role !== "assistant") {
    return [] as AssistantReasoningEntry[];
  }

  return node.parts
    .filter((part) => part.partKind === "reasoning")
    .flatMap((part) => {
      const payload = part.payload;
      if (!payload || typeof payload !== "object") {
        return [];
      }
      const text = Reflect.get(payload as Record<string, unknown>, "text");
      if (typeof text !== "string" || text.trim().length === 0) {
        return [];
      }
      return [
        {
          partId: part.id,
          text,
        } satisfies AssistantReasoningEntry,
      ];
    });
}

function getToolPayloadField(payload: unknown, key: string) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  return Reflect.get(payload as Record<string, unknown>, key) ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNonNullable<T>(value: T | null | undefined): value is T {
  return value != null;
}

function getRecordField(payload: unknown, key: string) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  return Reflect.get(payload as Record<string, unknown>, key) ?? null;
}

function getRecordString(payload: unknown, key: string) {
  const value = getRecordField(payload, key);
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function formatToolTarget(value: string | null, fallback: string) {
  if (value == null) {
    return fallback;
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= 80) {
    return normalized;
  }

  return `${normalized.slice(0, 79)}…`;
}

function getTimelinePointCount(input: unknown) {
  const points = getRecordField(input, "points");
  return Array.isArray(points) ? points.length : null;
}

function getFirstTimelinePointLabel(input: unknown) {
  const points = getRecordField(input, "points");
  if (!Array.isArray(points) || points.length !== 1) {
    return null;
  }

  return getRecordString(points[0], "label");
}

function getToolResponseData(payload: unknown) {
  const value = getRecordField(payload, "value");
  const envelope = value && typeof value === "object" ? value : payload;
  const data = getRecordField(envelope, "data");
  return data && typeof data === "object" ? data : null;
}

function getToolResponseTitle(payload: unknown) {
  const data = getToolResponseData(payload);
  const node = getRecordField(data, "node");
  return getRecordString(data, "title") ?? getRecordString(node, "title");
}

function getToolResponseTimelineLabel(payload: unknown) {
  const data = getToolResponseData(payload);
  return getRecordString(data, "timelineLabel") ?? getRecordString(data, "label");
}

function getToolResponsePointCount(payload: unknown) {
  const points = getRecordField(getToolResponseData(payload), "points");
  return Array.isArray(points) ? points.length : null;
}

function getFirstToolResponsePointLabel(payload: unknown) {
  const points = getRecordField(getToolResponseData(payload), "points");
  if (!Array.isArray(points) || points.length !== 1) {
    return null;
  }

  return getRecordString(points[0], "label");
}

export function buildAssistantToolTraceSummary({
  toolName,
  requestPayload,
  responsePayload,
  status = "pending",
}: {
  toolName: string;
  requestPayload: unknown;
  responsePayload?: unknown;
  status?: AgentToolTraceStatus | "pending";
}) {
  const fallback = status === "error" ? `${toolName} 执行失败` : `调用 ${toolName}`;
  const responseTitle = getToolResponseTitle(responsePayload);
  const responseTimelineLabel = getToolResponseTimelineLabel(responsePayload);

  switch (toolName) {
    case "list_files":
      return `查看辅助信息 ${formatToolTarget(getRecordString(requestPayload, "path"), "/")}`;
    case "read_file":
      return `读取辅助信息 ${formatToolTarget(
        getRecordString(requestPayload, "path"),
        "当前选中",
      )}`;
    case "create_dir":
      return `创建辅助目录 ${formatToolTarget(getRecordString(requestPayload, "path"), "")}`;
    case "write_file":
      return `写入辅助信息 ${formatToolTarget(getRecordString(requestPayload, "path"), "")}`;
    case "move_path":
      return `移动辅助信息 ${formatToolTarget(
        getRecordString(requestPayload, "path"),
        "",
      )} -> ${formatToolTarget(getRecordString(requestPayload, "newPath"), "")}`;
    case "delete_path":
      return `删除辅助信息 ${formatToolTarget(getRecordString(requestPayload, "path"), "")}`;
    case "create_symlink":
      return `创建辅助链接 ${formatToolTarget(
        getRecordString(requestPayload, "path"),
        "",
      )} -> ${formatToolTarget(getRecordString(requestPayload, "targetPath"), "")}`;
    case "retarget_symlink":
      return `重定向辅助链接 ${formatToolTarget(
        getRecordString(requestPayload, "path"),
        "",
      )} -> ${formatToolTarget(getRecordString(requestPayload, "targetPath"), "")}`;
    case "list_manuscript_nodes":
      return "查看正文目录";
    case "read_manuscript_node": {
      const nodeId = getRecordString(requestPayload, "nodeId");
      return `读取正文 ${formatToolTarget(
        responseTitle ?? nodeId,
        nodeId == null ? "当前正文" : "",
      )}`;
    }
    case "create_manuscript_node":
      return `创建正文 ${formatToolTarget(
        responseTitle ?? getRecordString(requestPayload, "title"),
        "",
      )}`.trim();
    case "update_manuscript_node":
      return `更新正文 ${formatToolTarget(
        responseTitle ??
          getRecordString(requestPayload, "title") ??
          getRecordString(requestPayload, "nodeId"),
        "",
      )}`.trim();
    case "move_manuscript_node":
      return `移动正文 ${formatToolTarget(
        responseTitle ?? getRecordString(requestPayload, "nodeId"),
        "",
      )}`.trim();
    case "delete_manuscript_node":
      return `删除正文 ${formatToolTarget(
        responseTitle ?? getRecordString(requestPayload, "nodeId"),
        "",
      )}`.trim();
    case "list_story_timeline_points":
      return "查看故事时间线";
    case "list_current_timeline_aux_changes":
      return `查看时间点辅助变更 ${formatToolTarget(
        responseTimelineLabel ?? getRecordString(requestPayload, "timelinePointId"),
        "当前",
      )}`;
    case "set_current_timeline":
      return `切换时间点 ${formatToolTarget(
        responseTimelineLabel ?? getRecordString(requestPayload, "timelinePointId"),
        "",
      )}`.trim();
    case "create_story_timeline_points": {
      const label =
        getFirstToolResponsePointLabel(responsePayload) ??
        getFirstTimelinePointLabel(requestPayload);
      if (label != null) {
        return `创建时间点 ${formatToolTarget(label, "")}`;
      }

      const count =
        getToolResponsePointCount(responsePayload) ?? getTimelinePointCount(requestPayload);
      return count == null ? "创建时间点" : `创建时间点 ${count} 个`;
    }
    case "update_story_timeline_point":
      return `更新时间点 ${formatToolTarget(
        responseTimelineLabel ??
          getRecordString(requestPayload, "label") ??
          getRecordString(requestPayload, "pointId"),
        "",
      )}`.trim();
    case "move_story_timeline_point":
      return `移动时间点 ${formatToolTarget(
        responseTimelineLabel ?? getRecordString(requestPayload, "pointId"),
        "",
      )}`.trim();
    case "delete_story_timeline_point":
      return `删除时间点 ${formatToolTarget(
        responseTimelineLabel ?? getRecordString(requestPayload, "pointId"),
        "",
      )}`.trim();
    default:
      return fallback;
  }
}

function getToolPayloadString(payload: unknown, key: string) {
  const value = getToolPayloadField(payload, key);
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function parseAskUserQuestionOption(input: unknown): AssistantAskUserOption | null {
  if (!isRecord(input)) {
    return null;
  }
  const id = getRecordString(input, "id");
  const label = getRecordString(input, "label");
  if (!id || !label) {
    return null;
  }
  const description = getRecordString(input, "description");
  return {
    id,
    label,
    ...(description ? { description } : {}),
  };
}

function parseAskUserQuestion(input: unknown): AssistantAskUserQuestion | null {
  if (!isRecord(input)) {
    return null;
  }
  const id = getRecordString(input, "id");
  const prompt = getRecordString(input, "prompt");
  const kind = getRecordField(input, "kind");
  if (!id || !prompt || (kind !== "single_choice" && kind !== "free_text")) {
    return null;
  }
  if (kind === "free_text") {
    return { id, prompt, kind };
  }
  const rawOptions = getRecordField(input, "options");
  if (!Array.isArray(rawOptions) || rawOptions.length === 0) {
    return null;
  }
  const options = rawOptions.map(parseAskUserQuestionOption).filter(isNonNullable);
  if (options.length !== rawOptions.length) {
    return null;
  }
  return {
    id,
    prompt,
    kind,
    options,
  };
}

function parseAskUserInput(payload: unknown): {
  title: string | null;
  questions: AssistantAskUserQuestion[];
} | null {
  if (!isRecord(payload)) {
    return null;
  }
  const rawQuestions = getRecordField(payload, "questions");
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
    return null;
  }
  const questions = rawQuestions.map(parseAskUserQuestion).filter(isNonNullable);
  if (questions.length !== rawQuestions.length) {
    return null;
  }
  return {
    title: getRecordString(payload, "title"),
    questions,
  };
}

function parseAskUserAnswer(input: unknown): AssistantAskUserAnswer | null {
  if (!isRecord(input)) {
    return null;
  }
  const questionId = getRecordString(input, "questionId");
  const type = getRecordField(input, "type");
  if (!questionId || (type !== "single_choice" && type !== "free_text")) {
    return null;
  }
  if (type === "single_choice") {
    const optionId = getRecordString(input, "optionId");
    const text = getRecordString(input, "text");
    if ((optionId ? 1 : 0) + (text ? 1 : 0) !== 1) {
      return null;
    }
    return optionId
      ? {
          questionId,
          type,
          optionId,
        }
      : {
          questionId,
          type,
          text: text!,
        };
  }
  const text = getRecordString(input, "text");
  return text
    ? {
        questionId,
        type,
        text,
      }
    : null;
}

function unwrapToolOutput(output: unknown) {
  if (!isRecord(output)) {
    return null;
  }
  if (getRecordField(output, "type") === "json") {
    const value = getRecordField(output, "value");
    return isRecord(value) ? value : null;
  }
  return output;
}

function parseAskUserAnswersFromOutput(output: unknown): AssistantAskUserAnswer[] | null {
  const unwrapped = unwrapToolOutput(output);
  const data = unwrapped ? getRecordField(unwrapped, "data") : null;
  if (!isRecord(data)) {
    return null;
  }
  const rawAnswers = getRecordField(data, "answers");
  if (!Array.isArray(rawAnswers)) {
    return null;
  }
  const answers = rawAnswers.map(parseAskUserAnswer).filter(isNonNullable);
  return answers.length === rawAnswers.length ? answers : null;
}

function getToolResultStatus(payload: unknown, partKind: "tool-result" | "tool-error") {
  if (partKind === "tool-error") {
    return "error" as const;
  }

  const output = getToolPayloadField(payload, "output");
  if (output && typeof output === "object") {
    if (Reflect.get(output as Record<string, unknown>, "ok") === false) {
      return "error" as const;
    }

    const nestedValue = Reflect.get(output as Record<string, unknown>, "value");
    if (nestedValue && typeof nestedValue === "object") {
      if (Reflect.get(nestedValue as Record<string, unknown>, "ok") === false) {
        return "error" as const;
      }
    }
  }

  return "success" as const;
}

function createToolTraceEntry({
  node,
  payload,
}: {
  node: AgentThreadNodeView;
  payload: unknown;
}): AssistantToolTraceEntry {
  const toolName = getToolPayloadString(payload, "toolName") ?? "tool";
  const requestPayload = getToolPayloadField(payload, "input");
  return {
    toolCallId: getToolPayloadString(payload, "toolCallId"),
    toolName,
    status: "pending",
    summary: buildAssistantToolTraceSummary({ toolName, requestPayload }),
    nodeId: node.id,
    runId: node.createdByRunId ?? null,
    requestPayload,
    responsePayload: null,
  };
}

export function getAssistantToolTrace(
  messages: AgentThreadNodeView[],
  messageIndex: number,
): AssistantToolTraceEntry[] {
  const node = messages[messageIndex];
  if (!node || node.role !== "assistant") {
    return [];
  }

  const entries: AssistantToolTraceEntry[] = [];
  const entryByCallId = new Map<string, AssistantToolTraceEntry>();

  node.parts.forEach((part) => {
    if (part.partKind !== "tool-call") {
      return;
    }

    const entry = createToolTraceEntry({
      node,
      payload: part.payload,
    });
    entries.push(entry);
    if (entry.toolCallId) {
      entryByCallId.set(entry.toolCallId, entry);
    }
  });

  for (let index = messageIndex + 1; index < messages.length; index += 1) {
    const toolNode = messages[index];
    if (!toolNode || toolNode.role !== "tool") {
      break;
    }

    toolNode.parts.forEach((part) => {
      if (part.partKind !== "tool-result" && part.partKind !== "tool-error") {
        return;
      }

      const toolCallId = getToolPayloadString(part.payload, "toolCallId");
      const matchedEntry = toolCallId ? entryByCallId.get(toolCallId) : null;
      const targetEntry =
        matchedEntry ??
        (() => {
          const fallbackEntry = {
            ...createToolTraceEntry({
              node,
              payload: part.payload,
            }),
            status: getToolResultStatus(part.payload, part.partKind),
          } satisfies AssistantToolTraceEntry;
          fallbackEntry.summary = buildAssistantToolTraceSummary({
            toolName: fallbackEntry.toolName,
            requestPayload: fallbackEntry.requestPayload,
            responsePayload: fallbackEntry.responsePayload,
            status: fallbackEntry.status,
          });
          entries.push(fallbackEntry);
          if (fallbackEntry.toolCallId) {
            entryByCallId.set(fallbackEntry.toolCallId, fallbackEntry);
          }
          return fallbackEntry;
        })();

      targetEntry.status = getToolResultStatus(part.payload, part.partKind);
      targetEntry.responsePayload = getToolPayloadField(part.payload, "output");
      targetEntry.summary = buildAssistantToolTraceSummary({
        toolName: targetEntry.toolName,
        requestPayload: targetEntry.requestPayload,
        responsePayload: targetEntry.responsePayload,
        status: targetEntry.status,
      });
    });
  }

  return entries;
}

export function getAssistantAskUserEntries(
  messages: AgentThreadNodeView[],
  messageIndex: number,
): AssistantAskUserEntry[] {
  const node = messages[messageIndex];
  if (!node || node.role !== "assistant") {
    return [];
  }

  const entries: AssistantAskUserEntry[] = node.parts.flatMap((part) => {
    if (part.partKind !== "tool-call") {
      return [];
    }
    const toolName = getToolPayloadString(part.payload, "toolName");
    const toolCallId = getToolPayloadString(part.payload, "toolCallId");
    if (toolName !== "ask_user" || !toolCallId) {
      return [];
    }
    const input = parseAskUserInput(getToolPayloadField(part.payload, "input"));
    if (!input) {
      return [];
    }
    return [
      {
        toolCallId,
        title: input.title,
        questions: input.questions,
        answers: null,
      } satisfies AssistantAskUserEntry,
    ];
  });

  if (entries.length === 0) {
    return entries;
  }

  const entryByToolCallId = new Map(entries.map((entry) => [entry.toolCallId, entry]));
  for (let index = messageIndex + 1; index < messages.length; index += 1) {
    const toolNode = messages[index];
    if (!toolNode || toolNode.role !== "tool") {
      break;
    }
    toolNode.parts.forEach((part) => {
      if (part.partKind !== "tool-result") {
        return;
      }
      const toolName = getToolPayloadString(part.payload, "toolName");
      const toolCallId = getToolPayloadString(part.payload, "toolCallId");
      if (toolName !== "ask_user" || !toolCallId) {
        return;
      }
      const entry = entryByToolCallId.get(toolCallId);
      if (!entry || entry.answers != null) {
        return;
      }
      entry.answers = parseAskUserAnswersFromOutput(getToolPayloadField(part.payload, "output"));
    });
  }

  return entries;
}

export function listAssistantContextDetails(context: ProjectAssistantContextSnapshot) {
  return [
    {
      label: "正文",
      value: context.activeContentTitle ?? "未选中",
    },
    {
      label: "辅助",
      value: context.activeAuxPath ?? "未选中",
    },
    {
      label: "时间",
      value: context.activeTimelineLabel ?? "未选中",
    },
  ];
}

export function selectRetryableRun(state: AssistantState | null | undefined): AgentRunView | null {
  const latest = state?.latestRuns[0] ?? null;
  if (!latest || latest.status !== "failed" || !latest.triggerNodeId) {
    return null;
  }
  return latest;
}

export function selectPendingRun(state: AssistantState | null | undefined): AgentRunView | null {
  const latest = state?.latestRuns[0] ?? null;
  if (
    !latest ||
    (latest.status !== "running" &&
      latest.status !== "queued" &&
      latest.status !== "waiting_for_input") ||
    !latest.triggerNodeId
  ) {
    return null;
  }
  return latest;
}

export function canSendAssistantMessage({
  draft,
  mentionCount = 0,
  selectedConnectionId,
  selectedModelId,
  selectionHydrated,
  isBusy,
  hasPendingRun,
}: {
  draft: string;
  mentionCount?: number;
  selectedConnectionId: string;
  selectedModelId: string;
  selectionHydrated: boolean;
  isBusy: boolean;
  hasPendingRun: boolean;
}) {
  return (
    selectionHydrated &&
    selectedConnectionId.length > 0 &&
    selectedModelId.length > 0 &&
    (draft.trim().length > 0 || mentionCount > 0) &&
    !isBusy &&
    !hasPendingRun
  );
}

export function getCandidateGroupForNode(
  candidateGroups: AgentCandidateGroupView[],
  node: AgentThreadNodeView,
) {
  return candidateGroups.find((group) => group.activeNodeId === node.id) ?? null;
}

export function getRunErrorMessage() {
  return "AI 回复失败。";
}

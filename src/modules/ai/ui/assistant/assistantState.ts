import type {
  AgentCandidateGroupView,
  AgentRunView,
  AgentThreadNodeView,
  AgentThreadStateView,
  AgentThreadView,
  AgentToolTraceStatus,
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
    }
  | {
      kind: "retry";
      triggerNodeId: string;
    };

export const EMPTY_ASSISTANT_STATE: AssistantState = {
  thread: null,
  activePath: [],
  candidateGroups: [],
  latestRuns: [],
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

function summarizeToolPayload(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }
  const toolName = Reflect.get(payload as Record<string, unknown>, "toolName");
  if (typeof toolName === "string" && toolName.trim().length > 0) {
    return fallback.replace("{tool}", toolName);
  }
  return fallback.replace("{tool}", "工具");
}

function getToolPayloadField(payload: unknown, key: string) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  return Reflect.get(payload as Record<string, unknown>, key) ?? null;
}

function getToolPayloadString(payload: unknown, key: string) {
  const value = getToolPayloadField(payload, key);
  return typeof value === "string" && value.trim().length > 0 ? value : null;
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
  return {
    toolCallId: getToolPayloadString(payload, "toolCallId"),
    toolName,
    status: "pending",
    summary: summarizeToolPayload(payload, "调用 {tool}"),
    nodeId: node.id,
    runId: node.createdByRunId ?? null,
    requestPayload: getToolPayloadField(payload, "input"),
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
            summary:
              getToolResultStatus(part.payload, part.partKind) === "error"
                ? summarizeToolPayload(part.payload, "{tool} 执行失败")
                : summarizeToolPayload(part.payload, "调用 {tool}"),
          } satisfies AssistantToolTraceEntry;
          entries.push(fallbackEntry);
          if (fallbackEntry.toolCallId) {
            entryByCallId.set(fallbackEntry.toolCallId, fallbackEntry);
          }
          return fallbackEntry;
        })();

      targetEntry.status = getToolResultStatus(part.payload, part.partKind);
      targetEntry.responsePayload = getToolPayloadField(part.payload, "output");
      if (targetEntry.status === "error") {
        targetEntry.summary = summarizeToolPayload(part.payload, "{tool} 执行失败");
      }
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
    (latest.status !== "running" && latest.status !== "queued") ||
    !latest.triggerNodeId
  ) {
    return null;
  }
  return latest;
}

export function canSendAssistantMessage({
  draft,
  threadId,
  selectedConnectionId,
  selectedModelId,
  selectionHydrated,
  isBusy,
  hasPendingRun,
}: {
  draft: string;
  threadId: string | null;
  selectedConnectionId: string;
  selectedModelId: string;
  selectionHydrated: boolean;
  isBusy: boolean;
  hasPendingRun: boolean;
}) {
  return (
    selectionHydrated &&
    threadId != null &&
    selectedConnectionId.length > 0 &&
    selectedModelId.length > 0 &&
    draft.trim().length > 0 &&
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

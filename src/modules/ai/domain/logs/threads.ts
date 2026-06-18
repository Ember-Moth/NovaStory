import type { ModelMessage } from "ai";

import { createId, invariant, now } from "@/shared/lib/domain";

import type {
  AgentMessagePartRow,
  AgentRunView,
  AgentThreadNodeSourceKind,
  AgentThreadNodeView,
  AgentThreadRow,
  AgentThreadRole,
  AgentThreadStateView,
} from "../types";
import { buildCandidateGroups, buildRunSummaries, resolveCandidateLeafTip } from "./candidates";
import { buildMessageSummary, getMessageContentParts } from "./message-parts";
import { appendNodePart, insertNode, updateNodePart, updateNodeSummary } from "./node-store";
import {
  getNodeModelMessage,
  mapNodeRow,
  mapProjectStateRow,
  mapRunRow,
  mapThreadRow,
} from "./mappers";
import {
  normalizeThreadTitle,
  parseStoredArray,
  PROJECT_ASSISTANT_AGENT_PROFILE,
  replaceRowById,
  serializeRequiredJson,
  sortByUpdatedDescCreatedDesc,
  stringifyStoredArray,
  trimOptionalString,
  type CreateNodeExtraPartInput,
  type CreateThreadInput,
  type MaterializeResponseMessagesInput,
  type ProjectThreadNodeDeltaInput,
  type ProjectAiStorage,
} from "./shared";
import {
  assertNodeInProject,
  assertRunInProject,
  assertThreadInProject,
  getLatestUnarchivedThreadRow,
  getNodeOrThrow,
  getNodeRowsByThread,
  getProjectOrThrow,
  getProjectStateRow,
  getThreadOrThrow,
  readProjectAiStorage,
  touchProject,
  updateProjectAiStorage,
  upsertProjectState,
} from "./storage";
import { getStepOrThrow, parseRunTraceRowsFromStorage } from "./trace-store";

export { PROJECT_ASSISTANT_AGENT_PROFILE };

export function listThreads(
  projectId: string,
  options?: { agentProfile?: string; archived?: boolean },
) {
  getProjectOrThrow(projectId);
  const storage = readProjectAiStorage(projectId);
  const agentProfile = trimOptionalString(options?.agentProfile);
  const archived = options?.archived;
  return sortByUpdatedDescCreatedDesc(
    storage.index.threads.filter(
      (row) =>
        row.projectId === projectId &&
        (agentProfile ? row.agentProfile === agentProfile : true) &&
        (archived == null ? true : archived ? row.archivedAt != null : row.archivedAt == null),
    ),
  ).map(mapThreadRow);
}

export function getProjectState(projectId: string, agentProfile = PROJECT_ASSISTANT_AGENT_PROFILE) {
  getProjectOrThrow(projectId);
  const row = getProjectStateRow(readProjectAiStorage(projectId).index, projectId, agentProfile);
  return row ? mapProjectStateRow(row) : null;
}

export function resolveActiveThread(
  projectId: string,
  agentProfile = PROJECT_ASSISTANT_AGENT_PROFILE,
) {
  getProjectOrThrow(projectId);
  const storage = readProjectAiStorage(projectId);
  const state = getProjectStateRow(storage.index, projectId, agentProfile);

  if (state?.activeThreadId) {
    const activeThread = storage.index.threads.find((row) => row.id === state.activeThreadId);
    if (
      activeThread &&
      activeThread.projectId === projectId &&
      activeThread.agentProfile === agentProfile &&
      activeThread.archivedAt == null
    ) {
      return mapThreadRow(activeThread);
    }
  }

  const fallback = getLatestUnarchivedThreadRow(storage.index, projectId, agentProfile);
  updateProjectAiStorage(projectId, "Resolve AI active thread", (mutableStorage) => {
    upsertProjectState(mutableStorage.index, projectId, agentProfile, fallback?.id ?? null);
  });
  return fallback ? mapThreadRow(fallback) : null;
}

export function createThread(input: CreateThreadInput) {
  const result = updateProjectAiStorage(
    input.projectId,
    "Create AI thread",
    (storage: ProjectAiStorage) => {
      getProjectOrThrow(input.projectId);
      const agentProfile =
        trimOptionalString(input.agentProfile) ?? PROJECT_ASSISTANT_AGENT_PROFILE;
      const existingCount = storage.index.threads.filter(
        (row) => row.projectId === input.projectId && row.agentProfile === agentProfile,
      ).length;
      const timestamp = now();
      const row: AgentThreadRow = {
        id: createId("agent_thread"),
        projectId: input.projectId,
        agentProfile,
        title: normalizeThreadTitle(input.title, `新会话 ${existingCount + 1}`),
        activeTipNodeId: null,
        archivedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      storage.index.threads.push(row);
      upsertProjectState(storage.index, input.projectId, agentProfile, row.id);
      return mapThreadRow(row);
    },
  );
  touchProject(input.projectId);
  return result;
}

export function renameThread(projectId: string, threadId: string, title: string) {
  const result = updateProjectAiStorage(
    projectId,
    `Rename AI thread ${threadId}`,
    (storage: ProjectAiStorage) => {
      const thread = assertThreadInProject(storage.index, projectId, threadId);
      const normalizedTitle = trimOptionalString(title);
      invariant(normalizedTitle, "名称不能为空。");
      const updated: AgentThreadRow = {
        ...thread,
        title: normalizedTitle,
        updatedAt: now(),
      };
      replaceRowById(storage.index.threads, updated);
      return mapThreadRow(updated);
    },
  );
  touchProject(projectId);
  return result;
}

export function setActiveThread(projectId: string, threadId: string) {
  return updateProjectAiStorage(projectId, "Set AI active thread", (storage: ProjectAiStorage) => {
    const thread = getThreadOrThrow(storage.index, threadId);
    invariant(thread.projectId === projectId, "thread 不属于当前项目。");
    invariant(thread.archivedAt == null, "不能激活已归档 thread。");
    upsertProjectState(storage.index, projectId, thread.agentProfile, thread.id);
    return mapThreadRow(thread);
  });
}

export function archiveThread(projectId: string, threadId: string, archived: boolean) {
  const result = updateProjectAiStorage(
    projectId,
    `Archive AI thread ${threadId}`,
    (storage: ProjectAiStorage) => {
      const thread = assertThreadInProject(storage.index, projectId, threadId);
      const updated: AgentThreadRow = {
        ...thread,
        archivedAt: archived ? now() : null,
        updatedAt: now(),
      };
      replaceRowById(storage.index.threads, updated);
      const state = getProjectStateRow(storage.index, thread.projectId, thread.agentProfile);
      if (archived && state?.activeThreadId === threadId) {
        const fallback = getLatestUnarchivedThreadRow(
          storage.index,
          thread.projectId,
          thread.agentProfile,
        );
        upsertProjectState(
          storage.index,
          thread.projectId,
          thread.agentProfile,
          fallback?.id ?? null,
        );
      }
      if (!archived && !state?.activeThreadId) {
        upsertProjectState(storage.index, thread.projectId, thread.agentProfile, threadId);
      }
      return mapThreadRow(updated);
    },
  );
  touchProject(projectId);
  return result;
}

export function resolveThreadPath(projectId: string, threadId: string, tipNodeId?: string | null) {
  const storage = readProjectAiStorage(projectId);
  const thread = assertThreadInProject(storage.index, projectId, threadId);
  const currentTipId = trimOptionalString(tipNodeId) ?? thread.activeTipNodeId;
  if (!currentTipId) {
    return [] as AgentThreadNodeView[];
  }

  const chain = [] as AgentThreadNodeView[];
  const seen = new Set<string>();
  let currentId: string | null = currentTipId;

  while (currentId) {
    invariant(!seen.has(currentId), "thread 节点链存在循环。");
    seen.add(currentId);
    const row = getNodeOrThrow(storage.index, currentId);
    invariant(row.threadId === thread.id, "thread 引用了其他会话的节点。");
    chain.push(mapNodeRow(row));
    currentId = row.parentNodeId;
  }

  return chain.reverse();
}

export function buildThreadModelMessages(
  projectId: string,
  threadId: string,
  tipNodeId?: string | null,
) {
  return resolveThreadPath(projectId, threadId, tipNodeId).map((node) => node.message);
}

export function getNodeCandidates(projectId: string, parentNodeId: string) {
  const storage = readProjectAiStorage(projectId);
  const parent = assertNodeInProject(storage.index, projectId, parentNodeId);
  return getNodeRowsByThread(storage.index, parent.threadId, parentNodeId).map((row) => ({
    id: row.id,
    tipNodeId: resolveCandidateLeafTip(storage.index, row.threadId, row.id),
    role: row.role as AgentThreadRole,
    summaryText: row.summaryText,
    createdAt: row.createdAt,
    createdByRunId: row.createdByRunId,
  }));
}

export function listLatestRuns(projectId: string, threadId: string, limit = 10) {
  const storage = readProjectAiStorage(projectId);
  assertThreadInProject(storage.index, projectId, threadId);
  return [...storage.index.runs]
    .filter((row) => row.threadId === threadId)
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, limit)
    .map(mapRunRow) as AgentRunView[];
}

export function getLatestRunForTriggerNode(
  projectId: string,
  threadId: string,
  triggerNodeId: string,
) {
  const storage = readProjectAiStorage(projectId);
  assertThreadInProject(storage.index, projectId, threadId);
  return (
    [...storage.index.runs]
      .filter((row) => row.threadId === threadId && row.triggerNodeId === triggerNodeId)
      .sort((left, right) => right.createdAt - left.createdAt)
      .map(mapRunRow)[0] ?? null
  );
}

export function getThreadView(projectId: string, threadId: string): AgentThreadStateView {
  const storage = readProjectAiStorage(projectId);
  const thread = assertThreadInProject(storage.index, projectId, threadId);
  const activePath = resolveThreadPath(projectId, thread.id);
  return {
    thread: mapThreadRow(thread),
    activePath,
    candidateGroups: buildCandidateGroups(storage.index, thread.id, activePath),
    latestRuns: listLatestRuns(projectId, thread.id),
    runSummaries: buildRunSummaries(storage.index, thread.id, activePath),
  };
}

export function hasPendingRun(projectId: string, threadId: string) {
  const storage = readProjectAiStorage(projectId);
  assertThreadInProject(storage.index, projectId, threadId);
  return storage.index.runs.some(
    (row) =>
      row.threadId === threadId &&
      (row.status === "queued" || row.status === "running" || row.status === "waiting_for_input"),
  );
}

export function selectActiveTip(projectId: string, threadId: string, tipNodeId: string) {
  const result = updateProjectAiStorage(
    projectId,
    "Select AI thread tip",
    (storage: ProjectAiStorage) => {
      const thread = assertThreadInProject(storage.index, projectId, threadId);
      const node = assertNodeInProject(storage.index, projectId, tipNodeId);
      invariant(node.threadId === thread.id, "候选节点不属于当前 thread。");
      const updated: AgentThreadRow = {
        ...thread,
        activeTipNodeId: node.id,
        updatedAt: now(),
      };
      replaceRowById(storage.index.threads, updated);
      return mapThreadRow(updated);
    },
  );
  touchProject(projectId);
  return result;
}

export function appendUserNode(input: {
  projectId: string;
  threadId: string;
  parentNodeId: string | null;
  message: ModelMessage;
  sourceKind?: Extract<AgentThreadNodeSourceKind, "user_input" | "edit_rewrite">;
  extraParts?: CreateNodeExtraPartInput[];
}) {
  const result = updateProjectAiStorage(
    input.projectId,
    "Append AI user node",
    (storage: ProjectAiStorage) => {
      assertThreadInProject(storage.index, input.projectId, input.threadId);
      const node = insertNode(storage, {
        threadId: input.threadId,
        parentNodeId: input.parentNodeId,
        message: input.message,
        sourceKind: input.sourceKind ?? "user_input",
        extraParts: input.extraParts,
      });
      const thread = assertThreadInProject(storage.index, input.projectId, input.threadId);
      replaceRowById(storage.index.threads, {
        ...thread,
        activeTipNodeId: node.id,
        updatedAt: now(),
      });
      return node;
    },
  );
  touchProject(input.projectId);
  return result;
}

export function createReplacementNode(input: {
  projectId: string;
  threadId: string;
  nodeId: string;
  message: ModelMessage;
  extraParts?: CreateNodeExtraPartInput[];
}) {
  const result = updateProjectAiStorage(
    input.projectId,
    "Create AI replacement node",
    (storage: ProjectAiStorage) => {
      const node = assertNodeInProject(storage.index, input.projectId, input.nodeId);
      invariant(node.threadId === input.threadId, "待修改节点不属于当前 thread。");
      const replacement = insertNode(storage, {
        threadId: input.threadId,
        parentNodeId: node.parentNodeId,
        message: input.message,
        sourceKind: "edit_rewrite",
        extraParts: input.extraParts,
      });
      const thread = assertThreadInProject(storage.index, input.projectId, input.threadId);
      replaceRowById(storage.index.threads, {
        ...thread,
        activeTipNodeId: replacement.id,
        updatedAt: now(),
      });
      return replacement;
    },
  );
  touchProject(input.projectId);
  return result;
}

export function materializeResponseMessages(input: MaterializeResponseMessagesInput) {
  const result = updateProjectAiStorage(
    input.projectId,
    "Materialize AI response messages",
    (storage: ProjectAiStorage) => {
      const thread = assertThreadInProject(storage.index, input.projectId, input.threadId);
      let parentNodeId = input.parentNodeId;
      const nodes: AgentThreadNodeView[] = [];

      input.messages.forEach((message) => {
        const node = insertNode(storage, {
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
    },
  );
  touchProject(input.projectId);
  return result;
}

export function createStreamingAssistantNode(input: {
  projectId: string;
  threadId: string;
  parentNodeId: string | null;
  runId: string;
  stepId?: string | null;
}) {
  const result = updateProjectAiStorage(
    input.projectId,
    "Create streaming assistant node",
    (storage: ProjectAiStorage) => {
      assertThreadInProject(storage.index, input.projectId, input.threadId);
      const node = insertNode(storage, {
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
      const thread = assertThreadInProject(storage.index, input.projectId, input.threadId);
      replaceRowById(storage.index.threads, {
        ...thread,
        activeTipNodeId: node.id,
        updatedAt: now(),
      });
      return node;
    },
  );
  touchProject(input.projectId);
  return result;
}

export function appendAssistantTextDelta(input: ProjectThreadNodeDeltaInput) {
  return updateProjectAiStorage(
    input.projectId,
    "Append assistant text delta",
    (storage: ProjectAiStorage) => {
      const node = assertNodeInProject(storage.index, input.projectId, input.nodeId);
      invariant(node.role === "assistant", "只能向 assistant 节点追加文本。");
      const message = getNodeModelMessage(node);
      const content = getMessageContentParts(message);

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

      const existingPart = content[textPartIndex] as Record<string, unknown>;
      const nextPart = {
        ...existingPart,
        type: "text",
        text: `${String(Reflect.get(existingPart, "text") ?? "")}${input.delta}`,
        state: "streaming",
      };

      if (hadExistingTextPart) {
        updateNodePart(storage, node.id, textPartIndex, {
          payload: nextPart,
          state: "streaming",
          providerOptions: Reflect.get(nextPart, "providerOptions"),
          providerMetadata: Reflect.get(nextPart, "providerMetadata"),
        });
      } else {
        appendNodePart(storage, node.id, {
          partKind: "text",
          visibility: "public",
          state: "streaming",
          payload: nextPart,
          providerOptions: Reflect.get(nextPart, "providerOptions"),
          providerMetadata: Reflect.get(nextPart, "providerMetadata"),
        });
      }
      updateNodeSummary(
        storage,
        node.id,
        buildMessageSummary({ ...message, content: [nextPart] } as ModelMessage),
      );
      return mapNodeRow(getNodeOrThrow(storage.index, node.id));
    },
  );
}

export function appendAssistantReasoningPart(input: {
  projectId: string;
  nodeId: string;
  providerMetadata?: unknown;
}) {
  return updateProjectAiStorage(
    input.projectId,
    "Append assistant reasoning part",
    (storage: ProjectAiStorage) => {
      const node = assertNodeInProject(storage.index, input.projectId, input.nodeId);
      invariant(node.role === "assistant", "只能向 assistant 节点追加 reasoning。");
      const message = getNodeModelMessage(node);
      const partIndex = getMessageContentParts(message).length;
      const nextPart = {
        type: "reasoning",
        text: "",
        state: "streaming",
        ...(input.providerMetadata == null ? {} : { providerMetadata: input.providerMetadata }),
      };
      appendNodePart(storage, node.id, {
        partKind: "reasoning",
        visibility: "hidden",
        state: "streaming",
        payload: nextPart,
        providerOptions: Reflect.get(nextPart, "providerOptions"),
        providerMetadata: input.providerMetadata,
      });
      return {
        node: mapNodeRow(getNodeOrThrow(storage.index, node.id)),
        partIndex,
      };
    },
  );
}

export function appendAssistantReasoningDelta(input: {
  projectId: string;
  nodeId: string;
  partIndex: number;
  delta: string;
  providerMetadata?: unknown;
}) {
  return updateProjectAiStorage(
    input.projectId,
    "Append assistant reasoning delta",
    (storage: ProjectAiStorage) => {
      const node = assertNodeInProject(storage.index, input.projectId, input.nodeId);
      invariant(node.role === "assistant", "只能向 assistant 节点追加 reasoning。");
      const message = getNodeModelMessage(node);
      const content = getMessageContentParts(message);
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
      updateNodePart(storage, node.id, input.partIndex, {
        payload: nextPart,
        state: "streaming",
        providerOptions: Reflect.get(nextPart, "providerOptions"),
        providerMetadata: input.providerMetadata ?? Reflect.get(nextPart, "providerMetadata"),
      });
      return mapNodeRow(getNodeOrThrow(storage.index, node.id));
    },
  );
}

export function appendAssistantToolCallPart(input: {
  projectId: string;
  nodeId: string;
  toolCall: Record<string, unknown>;
}) {
  return updateProjectAiStorage(
    input.projectId,
    "Append assistant tool call part",
    (storage: ProjectAiStorage) => {
      const node = assertNodeInProject(storage.index, input.projectId, input.nodeId);
      invariant(node.role === "assistant", "只能向 assistant 节点追加工具调用。");
      const message = getNodeModelMessage(node);
      const nextPart = {
        type: "tool-call",
        ...input.toolCall,
      };
      appendNodePart(storage, node.id, {
        partKind: "tool-call",
        visibility: "internal",
        state: "done",
        payload: nextPart,
        providerOptions: Reflect.get(nextPart, "providerOptions"),
        providerMetadata: Reflect.get(nextPart, "providerMetadata"),
      });
      updateNodeSummary(
        storage,
        node.id,
        buildMessageSummary({ ...message, content: [nextPart] } as ModelMessage),
      );
      return mapNodeRow(getNodeOrThrow(storage.index, node.id));
    },
  );
}

export function appendAssistantToolApprovalRequestPart(input: {
  projectId: string;
  nodeId: string;
  approvalRequest: Record<string, unknown>;
}) {
  return updateProjectAiStorage(
    input.projectId,
    "Append assistant approval request part",
    (storage: ProjectAiStorage) => {
      const node = assertNodeInProject(storage.index, input.projectId, input.nodeId);
      invariant(node.role === "assistant", "只能向 assistant 节点追加工具审批请求。");
      const message = getNodeModelMessage(node);
      const approvalId = Reflect.get(input.approvalRequest, "approvalId");
      const toolCallId = Reflect.get(input.approvalRequest, "toolCallId");
      invariant(typeof approvalId === "string", "approvalId 不能为空。");
      invariant(typeof toolCallId === "string", "toolCallId 不能为空。");
      const nextPart = {
        type: "tool-approval-request",
        approvalId,
        toolCallId,
      };
      appendNodePart(storage, node.id, {
        partKind: "tool-approval-request",
        visibility: "internal",
        state: "done",
        payload: nextPart,
        providerOptions: Reflect.get(input.approvalRequest, "providerOptions"),
        providerMetadata: Reflect.get(input.approvalRequest, "providerMetadata"),
      });
      updateNodeSummary(
        storage,
        node.id,
        buildMessageSummary({ ...message, content: [nextPart] } as ModelMessage),
      );
      return mapNodeRow(getNodeOrThrow(storage.index, node.id));
    },
  );
}

export function createStreamingToolResultNode(input: {
  projectId: string;
  threadId: string;
  parentNodeId: string | null;
  runId: string;
  stepId?: string | null;
  toolResult: Record<string, unknown>;
}) {
  const result = updateProjectAiStorage(
    input.projectId,
    "Create streaming tool result node",
    (storage: ProjectAiStorage) => {
      assertThreadInProject(storage.index, input.projectId, input.threadId);
      const node = insertNode(storage, {
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
      const thread = assertThreadInProject(storage.index, input.projectId, input.threadId);
      replaceRowById(storage.index.threads, {
        ...thread,
        activeTipNodeId: node.id,
        updatedAt: now(),
      });
      return node;
    },
  );
  touchProject(input.projectId);
  return result;
}

export function createToolApprovalResponseNode(input: {
  projectId: string;
  threadId: string;
  parentNodeId: string | null;
  runId: string;
  approvalResponse: {
    approvalId: string;
    approved: boolean;
    reason?: string;
  };
}) {
  const result = updateProjectAiStorage(
    input.projectId,
    "Create tool approval response node",
    (storage: ProjectAiStorage) => {
      assertThreadInProject(storage.index, input.projectId, input.threadId);
      const node = insertNode(storage, {
        threadId: input.threadId,
        parentNodeId: input.parentNodeId,
        message: {
          role: "tool",
          content: [{ type: "tool-approval-response", ...input.approvalResponse }],
        } as unknown as ModelMessage,
        sourceKind: "tool_result",
        createdByRunId: input.runId,
      });
      const thread = assertThreadInProject(storage.index, input.projectId, input.threadId);
      replaceRowById(storage.index.threads, {
        ...thread,
        activeTipNodeId: node.id,
        updatedAt: now(),
      });
      return node;
    },
  );
  touchProject(input.projectId);
  return result;
}

export function markThreadNodePartsDone(projectId: string, nodeId: string) {
  return updateProjectAiStorage(
    projectId,
    "Mark thread node parts done",
    (storage: ProjectAiStorage) => {
      const node = assertNodeInProject(storage.index, projectId, nodeId);
      const message = getNodeModelMessage(node);
      const parts = parseStoredArray<AgentMessagePartRow>(node.partsJson);
      const nextParts = parts.map((part) => {
        if (part.state !== "streaming") {
          return part;
        }
        const currentPayload = JSON.parse(part.payloadJson) as unknown;
        const payload =
          currentPayload && typeof currentPayload === "object"
            ? { ...(currentPayload as Record<string, unknown>), state: "done" }
            : currentPayload;
        return {
          ...part,
          state: "done" as const,
          payloadJson: serializeRequiredJson(payload, "节点 part"),
        };
      });
      replaceRowById(storage.index.nodes, {
        ...node,
        partsJson: stringifyStoredArray(nextParts),
      });
      updateNodeSummary(storage, node.id, buildMessageSummary(message));
      return mapNodeRow(getNodeOrThrow(storage.index, node.id));
    },
  );
}

export function assignThreadNodeSourceStepIds(
  projectId: string,
  nodeIds: string[],
  stepId: string,
) {
  if (nodeIds.length === 0) {
    return;
  }
  updateProjectAiStorage(
    projectId,
    "Assign thread node source step ids",
    (storage: ProjectAiStorage) => {
      const run = storage.index.runs.find((entry) =>
        parseRunTraceRowsFromStorage(storage, entry).steps.some((step) => step.id === stepId),
      );
      invariant(run, "未找到 run step。");
      assertRunInProject(storage.index, projectId, run.id);
      getStepOrThrow({ projectId, runId: run.id, stepId });
      nodeIds.forEach((nodeId) => {
        const node = getNodeOrThrow(storage.index, nodeId);
        replaceRowById(storage.index.nodes, {
          ...node,
          sourceStepId: stepId,
        });
      });
    },
  );
}

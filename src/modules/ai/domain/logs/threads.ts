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
import {
  appendNodePart,
  buildCandidateGroups,
  buildMessageSummary,
  buildRunSummaries,
  getLatestUnarchivedThreadRow,
  getMessageContentParts,
  getNodeModelMessage,
  getNodeOrThrow,
  getNodeRowsByThread,
  getProjectIdForNodeOrThrow,
  getProjectIdForRunOrThrow,
  getProjectIdForThreadOrThrow,
  getProjectOrThrow,
  getProjectStateRow,
  getRunOrThrow,
  getStepOrThrow,
  getThreadOrThrow,
  insertNode,
  mapNodeRow,
  mapProjectStateRow,
  mapRunRow,
  mapThreadRow,
  parseStoredArray,
  PROJECT_ASSISTANT_AGENT_PROFILE,
  readProjectAiStorage,
  replaceRowById,
  resolveCandidateLeafTip,
  normalizeThreadTitle,
  serializeRequiredJson,
  sortByUpdatedDescCreatedDesc,
  stringifyStoredArray,
  touchProject,
  trimOptionalString,
  updateNodePart,
  updateNodeSummary,
  updateProjectAiStorage,
  upsertProjectState,
  type CreateNodeExtraPartInput,
  type CreateThreadInput,
  type ProjectAiStorage,
  type MaterializeResponseMessagesInput,
} from "./core";

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

export function renameThread(threadId: string, title: string) {
  const projectId = getProjectIdForThreadOrThrow(threadId);
  const result = updateProjectAiStorage(
    projectId,
    `Rename AI thread ${threadId}`,
    (storage: ProjectAiStorage) => {
      const thread = getThreadOrThrow(storage.index, threadId);
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

export function archiveThread(threadId: string, archived: boolean) {
  const projectId = getProjectIdForThreadOrThrow(threadId);
  const result = updateProjectAiStorage(
    projectId,
    `Archive AI thread ${threadId}`,
    (storage: ProjectAiStorage) => {
      const thread = getThreadOrThrow(storage.index, threadId);
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

export function resolveThreadPath(threadId: string, tipNodeId?: string | null) {
  const projectId = getProjectIdForThreadOrThrow(threadId);
  const storage = readProjectAiStorage(projectId);
  const thread = getThreadOrThrow(storage.index, threadId);
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

export function buildThreadModelMessages(threadId: string, tipNodeId?: string | null) {
  return resolveThreadPath(threadId, tipNodeId).map((node) => node.message);
}

export function getNodeCandidates(parentNodeId: string) {
  const projectId = getProjectIdForNodeOrThrow(parentNodeId);
  const storage = readProjectAiStorage(projectId);
  const parent = getNodeOrThrow(storage.index, parentNodeId);
  return getNodeRowsByThread(storage.index, parent.threadId, parentNodeId).map((row) => ({
    id: row.id,
    tipNodeId: resolveCandidateLeafTip(storage.index, row.threadId, row.id),
    role: row.role as AgentThreadRole,
    summaryText: row.summaryText,
    createdAt: row.createdAt,
    createdByRunId: row.createdByRunId,
  }));
}

export function listLatestRuns(threadId: string, limit = 10) {
  const projectId = getProjectIdForThreadOrThrow(threadId);
  const storage = readProjectAiStorage(projectId);
  getThreadOrThrow(storage.index, threadId);
  return [...storage.index.runs]
    .filter((row) => row.threadId === threadId)
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, limit)
    .map(mapRunRow) as AgentRunView[];
}

export function getLatestRunForTriggerNode(threadId: string, triggerNodeId: string) {
  const projectId = getProjectIdForThreadOrThrow(threadId);
  const storage = readProjectAiStorage(projectId);
  getThreadOrThrow(storage.index, threadId);
  return (
    [...storage.index.runs]
      .filter((row) => row.threadId === threadId && row.triggerNodeId === triggerNodeId)
      .sort((left, right) => right.createdAt - left.createdAt)
      .map(mapRunRow)[0] ?? null
  );
}

export function getThreadView(threadId: string): AgentThreadStateView {
  const projectId = getProjectIdForThreadOrThrow(threadId);
  const storage = readProjectAiStorage(projectId);
  const thread = getThreadOrThrow(storage.index, threadId);
  const activePath = resolveThreadPath(thread.id);
  return {
    thread: mapThreadRow(thread),
    activePath,
    candidateGroups: buildCandidateGroups(storage.index, thread.id, activePath),
    latestRuns: listLatestRuns(thread.id),
    runSummaries: buildRunSummaries(storage.index, thread.id, activePath),
  };
}

export function hasPendingRun(threadId: string) {
  const projectId = getProjectIdForThreadOrThrow(threadId);
  const storage = readProjectAiStorage(projectId);
  getThreadOrThrow(storage.index, threadId);
  return storage.index.runs.some(
    (row) =>
      row.threadId === threadId &&
      (row.status === "queued" || row.status === "running" || row.status === "waiting_for_input"),
  );
}

export function selectActiveTip(threadId: string, tipNodeId: string) {
  const projectId = getProjectIdForThreadOrThrow(threadId);
  const result = updateProjectAiStorage(
    projectId,
    "Select AI thread tip",
    (storage: ProjectAiStorage) => {
      const thread = getThreadOrThrow(storage.index, threadId);
      const node = getNodeOrThrow(storage.index, tipNodeId);
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
  threadId: string;
  parentNodeId: string | null;
  message: ModelMessage;
  sourceKind?: Extract<AgentThreadNodeSourceKind, "user_input" | "edit_rewrite">;
  extraParts?: CreateNodeExtraPartInput[];
}) {
  const projectId = getProjectIdForThreadOrThrow(input.threadId);
  const result = updateProjectAiStorage(
    projectId,
    "Append AI user node",
    (storage: ProjectAiStorage) => {
      const node = insertNode(storage, {
        threadId: input.threadId,
        parentNodeId: input.parentNodeId,
        message: input.message,
        sourceKind: input.sourceKind ?? "user_input",
        extraParts: input.extraParts,
      });
      const thread = getThreadOrThrow(storage.index, input.threadId);
      replaceRowById(storage.index.threads, {
        ...thread,
        activeTipNodeId: node.id,
        updatedAt: now(),
      });
      return node;
    },
  );
  touchProject(projectId);
  return result;
}

export function createReplacementNode(input: {
  threadId: string;
  nodeId: string;
  message: ModelMessage;
  extraParts?: CreateNodeExtraPartInput[];
}) {
  const projectId = getProjectIdForThreadOrThrow(input.threadId);
  const result = updateProjectAiStorage(
    projectId,
    "Create AI replacement node",
    (storage: ProjectAiStorage) => {
      const node = getNodeOrThrow(storage.index, input.nodeId);
      invariant(node.threadId === input.threadId, "待修改节点不属于当前 thread。");
      const replacement = insertNode(storage, {
        threadId: input.threadId,
        parentNodeId: node.parentNodeId,
        message: input.message,
        sourceKind: "edit_rewrite",
        extraParts: input.extraParts,
      });
      const thread = getThreadOrThrow(storage.index, input.threadId);
      replaceRowById(storage.index.threads, {
        ...thread,
        activeTipNodeId: replacement.id,
        updatedAt: now(),
      });
      return replacement;
    },
  );
  touchProject(projectId);
  return result;
}

export function materializeResponseMessages(input: MaterializeResponseMessagesInput) {
  const projectId = getProjectIdForThreadOrThrow(input.threadId);
  const result = updateProjectAiStorage(
    projectId,
    "Materialize AI response messages",
    (storage: ProjectAiStorage) => {
      const thread = getThreadOrThrow(storage.index, input.threadId);
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
  touchProject(projectId);
  return result;
}

export function createStreamingAssistantNode(input: {
  threadId: string;
  parentNodeId: string | null;
  runId: string;
  stepId?: string | null;
}) {
  const projectId = getProjectIdForThreadOrThrow(input.threadId);
  const result = updateProjectAiStorage(
    projectId,
    "Create streaming assistant node",
    (storage: ProjectAiStorage) => {
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
      const thread = getThreadOrThrow(storage.index, input.threadId);
      replaceRowById(storage.index.threads, {
        ...thread,
        activeTipNodeId: node.id,
        updatedAt: now(),
      });
      return node;
    },
  );
  touchProject(projectId);
  return result;
}

export function appendAssistantTextDelta(input: { nodeId: string; delta: string }) {
  const projectId = getProjectIdForNodeOrThrow(input.nodeId);
  return updateProjectAiStorage(
    projectId,
    "Append assistant text delta",
    (storage: ProjectAiStorage) => {
      const node = getNodeOrThrow(storage.index, input.nodeId);
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
  nodeId: string;
  providerMetadata?: unknown;
}) {
  const projectId = getProjectIdForNodeOrThrow(input.nodeId);
  return updateProjectAiStorage(
    projectId,
    "Append assistant reasoning part",
    (storage: ProjectAiStorage) => {
      const node = getNodeOrThrow(storage.index, input.nodeId);
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
  nodeId: string;
  partIndex: number;
  delta: string;
  providerMetadata?: unknown;
}) {
  const projectId = getProjectIdForNodeOrThrow(input.nodeId);
  return updateProjectAiStorage(
    projectId,
    "Append assistant reasoning delta",
    (storage: ProjectAiStorage) => {
      const node = getNodeOrThrow(storage.index, input.nodeId);
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
  nodeId: string;
  toolCall: Record<string, unknown>;
}) {
  const projectId = getProjectIdForNodeOrThrow(input.nodeId);
  return updateProjectAiStorage(
    projectId,
    "Append assistant tool call part",
    (storage: ProjectAiStorage) => {
      const node = getNodeOrThrow(storage.index, input.nodeId);
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
  nodeId: string;
  approvalRequest: Record<string, unknown>;
}) {
  const projectId = getProjectIdForNodeOrThrow(input.nodeId);
  return updateProjectAiStorage(
    projectId,
    "Append assistant approval request part",
    (storage: ProjectAiStorage) => {
      const node = getNodeOrThrow(storage.index, input.nodeId);
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
  threadId: string;
  parentNodeId: string | null;
  runId: string;
  stepId?: string | null;
  toolResult: Record<string, unknown>;
}) {
  const projectId = getProjectIdForThreadOrThrow(input.threadId);
  const result = updateProjectAiStorage(
    projectId,
    "Create streaming tool result node",
    (storage: ProjectAiStorage) => {
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
      const thread = getThreadOrThrow(storage.index, input.threadId);
      replaceRowById(storage.index.threads, {
        ...thread,
        activeTipNodeId: node.id,
        updatedAt: now(),
      });
      return node;
    },
  );
  touchProject(projectId);
  return result;
}

export function createToolApprovalResponseNode(input: {
  threadId: string;
  parentNodeId: string | null;
  runId: string;
  approvalResponse: {
    approvalId: string;
    approved: boolean;
    reason?: string;
  };
}) {
  const projectId = getProjectIdForThreadOrThrow(input.threadId);
  const result = updateProjectAiStorage(
    projectId,
    "Create tool approval response node",
    (storage: ProjectAiStorage) => {
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
      const thread = getThreadOrThrow(storage.index, input.threadId);
      replaceRowById(storage.index.threads, {
        ...thread,
        activeTipNodeId: node.id,
        updatedAt: now(),
      });
      return node;
    },
  );
  touchProject(projectId);
  return result;
}

export function markThreadNodePartsDone(nodeId: string) {
  const projectId = getProjectIdForNodeOrThrow(nodeId);
  return updateProjectAiStorage(
    projectId,
    "Mark thread node parts done",
    (storage: ProjectAiStorage) => {
      const node = getNodeOrThrow(storage.index, nodeId);
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

export function assignThreadNodeSourceStepIds(nodeIds: string[], stepId: string) {
  if (nodeIds.length === 0) {
    return;
  }
  const step = getStepOrThrow(stepId);
  const projectId = getProjectIdForRunOrThrow(step.runId);
  updateProjectAiStorage(
    projectId,
    "Assign thread node source step ids",
    (storage: ProjectAiStorage) => {
      getRunOrThrow(storage.index, step.runId);
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

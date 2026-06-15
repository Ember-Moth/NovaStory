import {
  appendUserNode,
  createReplacementNode,
  createStreamingToolResultNode,
  getLatestRunForTriggerNode,
  getThreadView,
  hasPendingRun,
  PROJECT_ASSISTANT_AGENT_PROFILE,
} from "@/modules/ai/domain/logs/threads";
import {
  appendRunEvent,
  createArtifact,
  createRun,
  getRunTrace,
  markRunRunning,
} from "@/modules/ai/domain/logs/runs";
import type {
  AssistantInputRefSnapshot,
  AssistantMentionInput,
  AgentThreadView,
  AgentThreadNodeView,
  ProjectAssistantContextSnapshot,
  ProjectAssistantToolName,
} from "@/modules/ai/domain/types";
import type { AiAssistantModelSelection } from "@/modules/config/domain/ai-assistant-model-selection";
import { invariant } from "@/shared/lib/domain";

import type {
  ProjectAssistantContinueResult,
  ProjectAssistantEditResult,
  ProjectAssistantRetryResult,
  ProjectAssistantSendResult,
  ProjectAssistantSubmitToolInputResult,
} from "./service";
import {
  ASK_USER_TOOL_NAME,
  type AskUserAnswer,
  validateAskUserSubmission,
} from "../assistant-tools/ask-user";
import {
  buildProjectAssistantSystemPrompt,
  buildUserTextMessage,
  createToolRuntimeContext,
  normalizeAssistantContextSnapshot,
  resolveAssistantRequest,
  resolveProjectAssistantActiveTools,
  resolveProjectAssistantModelSelection,
  resolveProjectAssistantModelSelectionFromSnapshot,
  runNeedsContinuation,
} from "./runtime";
import { buildAssistantRefDisplayParts, resolveAssistantInputRefs } from "./refs";
import type { PreparedProjectAssistantRun } from "./types-internal";

function normalizeAssistantUserText(text: string, inputRefCount: number) {
  const normalized = text.trim();
  invariant(normalized.length > 0 || inputRefCount > 0, "消息不能为空。");
  return normalized;
}

function cloneInputRefsSnapshot(
  inputRefs: readonly AssistantInputRefSnapshot[] | null | undefined,
): AssistantInputRefSnapshot[] {
  return inputRefs == null ? [] : inputRefs.map((ref) => structuredClone(ref));
}

function findLatestInputRefsForTriggerNode(threadId: string, triggerNodeId: string) {
  const previousRun = getLatestRunForTriggerNode(threadId, triggerNodeId);
  return cloneInputRefsSnapshot(previousRun?.inputRefsSnapshot);
}

function getPayloadRecord(part: AgentThreadNodeView["parts"][number]) {
  return part.payload && typeof part.payload === "object"
    ? (part.payload as Record<string, unknown>)
    : null;
}

function findAskUserToolCall(input: {
  activePath: readonly AgentThreadNodeView[];
  runId: string;
  toolCallId: string;
}) {
  for (const node of input.activePath) {
    if (node.role !== "assistant" || node.createdByRunId !== input.runId) {
      continue;
    }

    const toolCallPart = node.parts.find((part) => {
      const payload = getPayloadRecord(part);
      return (
        part.partKind === "tool-call" &&
        payload?.type === "tool-call" &&
        payload.toolCallId === input.toolCallId &&
        payload.toolName === ASK_USER_TOOL_NAME
      );
    });
    const toolCallPayload = toolCallPart ? getPayloadRecord(toolCallPart) : null;
    if (!toolCallPayload) {
      continue;
    }

    return {
      assistantNode: node,
      toolCallId: input.toolCallId,
      request: toolCallPayload.input,
    };
  }

  return null;
}

function assertToolCallNotAnswered(input: {
  activePath: readonly AgentThreadNodeView[];
  toolCallId: string;
}) {
  const answered = input.activePath.some((node) =>
    node.parts.some((part) => {
      const payload = getPayloadRecord(part);
      return (
        part.partKind === "tool-result" &&
        payload?.type === "tool-result" &&
        payload.toolCallId === input.toolCallId &&
        payload.toolName === ASK_USER_TOOL_NAME
      );
    }),
  );
  invariant(!answered, "这个提问已经提交过答案。");
}

export function assertNoPendingRunForThread(thread: AgentThreadView) {
  invariant(!hasPendingRun(thread.id), "当前会话正在生成回复，请稍后再试。");
}

export function buildSendRun({
  projectId,
  threadId,
  text,
  mentions,
  context,
  activeTools,
  readStoredSelection,
}: {
  projectId: string;
  threadId: string;
  text: string;
  mentions?: readonly AssistantMentionInput[] | null;
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
  const inputRefs = resolveAssistantInputRefs(mentions);

  const userNode = appendUserNode({
    threadId: thread.id,
    parentNodeId: thread.activeTipNodeId,
    message: buildUserTextMessage(normalizeAssistantUserText(text, inputRefs.length)),
    sourceKind: "user_input",
    extraParts: buildAssistantRefDisplayParts(inputRefs),
  });
  const run = createRun({
    threadId: thread.id,
    triggerNodeId: userNode.id,
    baseTipNodeId: userNode.id,
    runMode: "send",
    agentProfile: PROJECT_ASSISTANT_AGENT_PROFILE,
    selectionSnapshot: selection.snapshot,
    contextSnapshot: normalizedContext,
    inputRefsSnapshot: inputRefs,
    activeTools: resolvedActiveTools,
  });
  appendRunEvent({
    runId: run.id,
    eventKind: "run-started",
    nodeId: userNode.id,
    summaryText: "用户消息触发新 run",
  });

  const system = buildProjectAssistantSystemPrompt();
  const request = resolveAssistantRequest({
    threadId: thread.id,
    triggerNodeId: userNode.id,
    system,
    selection,
    context: normalizedContext,
    inputRefs,
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
    runtimeContext: createToolRuntimeContext(normalizedContext),
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

export function buildRetryRun({
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
  const inputRefs = findLatestInputRefsForTriggerNode(thread.id, triggerNodeId);

  const run = createRun({
    threadId: thread.id,
    triggerNodeId,
    baseTipNodeId: triggerNodeId,
    runMode: "retry",
    agentProfile: PROJECT_ASSISTANT_AGENT_PROFILE,
    selectionSnapshot: selection.snapshot,
    contextSnapshot: normalizedContext,
    inputRefsSnapshot: inputRefs,
    activeTools: resolvedActiveTools,
  });
  appendRunEvent({
    runId: run.id,
    eventKind: "run-started",
    nodeId: triggerNodeId,
    summaryText: "重试 assistant 候选",
  });

  const system = buildProjectAssistantSystemPrompt();
  const request = resolveAssistantRequest({
    threadId: thread.id,
    triggerNodeId,
    system,
    selection,
    context: normalizedContext,
    inputRefs,
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
    runtimeContext: createToolRuntimeContext(normalizedContext),
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

export function buildEditRun({
  projectId,
  threadId,
  nodeId,
  text,
  mentions,
  context,
  activeTools,
  readStoredSelection,
}: {
  projectId: string;
  threadId: string;
  nodeId: string;
  text: string;
  mentions?: readonly AssistantMentionInput[] | null;
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
  const inputRefs = resolveAssistantInputRefs(mentions);

  const replacementNode = createReplacementNode({
    threadId: thread.id,
    nodeId,
    message: buildUserTextMessage(normalizeAssistantUserText(text, inputRefs.length)),
    extraParts: buildAssistantRefDisplayParts(inputRefs),
  });
  const run = createRun({
    threadId: thread.id,
    triggerNodeId: replacementNode.id,
    baseTipNodeId: replacementNode.id,
    runMode: "edit_regenerate",
    agentProfile: PROJECT_ASSISTANT_AGENT_PROFILE,
    selectionSnapshot: selection.snapshot,
    contextSnapshot: normalizedContext,
    inputRefsSnapshot: inputRefs,
    activeTools: resolvedActiveTools,
  });
  appendRunEvent({
    runId: run.id,
    eventKind: "run-started",
    nodeId: replacementNode.id,
    summaryText: "编辑消息并重新生成",
  });

  const system = buildProjectAssistantSystemPrompt();
  const request = resolveAssistantRequest({
    threadId: thread.id,
    triggerNodeId: replacementNode.id,
    system,
    selection,
    context: normalizedContext,
    inputRefs,
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
    runtimeContext: createToolRuntimeContext(normalizedContext),
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

export function buildSubmitToolInputRun({
  projectId,
  threadId,
  runId,
  toolCallId,
  answers,
}: {
  projectId: string;
  threadId: string;
  runId: string;
  toolCallId: string;
  answers: readonly AskUserAnswer[];
}): PreparedProjectAssistantRun<ProjectAssistantSubmitToolInputResult> {
  const threadView = getThreadView(threadId);
  const thread = threadView.thread;
  invariant(thread, "未找到当前会话。");
  invariant(thread.projectId === projectId, "AI 会话不属于当前项目。");
  invariant(thread.archivedAt == null, "不能向已归档会话提交工具输入。");

  const trace = getRunTrace(runId);
  const waitingRun = trace.run;
  invariant(waitingRun.threadId === thread.id, "run 不属于当前会话。");
  invariant(waitingRun.status === "waiting_for_input", "run 当前不在等待用户输入。");

  const activeTipNodeId = thread.activeTipNodeId;
  invariant(activeTipNodeId, "当前会话没有 active tip。");
  const activeTip = threadView.activePath.at(-1);
  invariant(activeTip?.id === activeTipNodeId, "当前 active tip 不在 active path 上。");
  invariant(activeTip.createdByRunId === waitingRun.id, "只能回答当前 active path 上的提问。");
  assertToolCallNotAnswered({ activePath: threadView.activePath, toolCallId });

  const pending = findAskUserToolCall({
    activePath: threadView.activePath,
    runId: waitingRun.id,
    toolCallId,
  });
  invariant(pending, "未找到待回答的提问工具调用。");
  invariant(pending.assistantNode.id === activeTipNodeId, "只能回答当前最新的提问。");

  const validated = validateAskUserSubmission({
    request: pending.request,
    answers,
  });
  const responseNode = createStreamingToolResultNode({
    threadId: thread.id,
    parentNodeId: activeTipNodeId,
    runId: waitingRun.id,
    toolResult: {
      type: "tool-result",
      toolCallId,
      toolName: ASK_USER_TOOL_NAME,
      output: {
        type: "json",
        value: validated.output,
      },
    },
  });
  const payloadArtifact = createArtifact({
    runId: waitingRun.id,
    artifactKind: "tool-output",
    visibility: "internal",
    content: {
      toolCallId,
      answers: validated.answers,
    },
    summaryText: "用户已回答提问",
  });
  appendRunEvent({
    runId: waitingRun.id,
    eventKind: "user-input-submitted",
    nodeId: responseNode.id,
    relatedToolCallId: pending.toolCallId,
    summaryText: "用户已回答提问",
    payloadArtifactId: payloadArtifact.id,
  });

  const run = markRunRunning(waitingRun.id);
  const selection = resolveProjectAssistantModelSelectionFromSnapshot(run.selectionSnapshot);
  const activeTools = run.activeTools ?? [];
  invariant(
    activeTools.length === 0 || selection.resolvedModel.supportsToolUse,
    "原 run 使用了工具，但当前模型不支持工具调用，无法恢复。",
  );
  const context = normalizeAssistantContextSnapshot(run.contextSnapshot);
  const inputRefs = cloneInputRefsSnapshot(run.inputRefsSnapshot);
  const system = buildProjectAssistantSystemPrompt();
  const request = resolveAssistantRequest({
    threadId: thread.id,
    triggerNodeId: responseNode.id,
    system,
    selection,
    context,
    inputRefs,
  });

  return {
    projectId,
    thread,
    run,
    triggerNodeId: responseNode.id,
    messages: request.messages,
    providerOptions: request.providerOptions,
    system,
    transportSystem: request.transportSystem,
    selection,
    context,
    runtimeContext: createToolRuntimeContext(context),
    activeTools,
    stepIndexOffset: trace.steps.length,
    initialResult: {
      thread: getThreadView(thread.id).thread!,
      toolNode: responseNode,
      assistantNode: null,
      run,
      state: getThreadView(thread.id),
    },
    runStartedEvent: {
      type: "user-input-submitted",
      toolNodeId: responseNode.id,
      toolCallId,
    },
    buildFinalResult: ({ run: completedRun, lastAssistantNode }) => ({
      thread: getThreadView(thread.id).thread!,
      toolNode: responseNode,
      assistantNode: lastAssistantNode,
      run: completedRun,
      state: getThreadView(thread.id),
    }),
  };
}

export function buildContinueRun({
  projectId,
  threadId,
  runId,
}: {
  projectId: string;
  threadId: string;
  runId: string;
}): PreparedProjectAssistantRun<ProjectAssistantContinueResult> {
  const threadView = getThreadView(threadId);
  const thread = threadView.thread;
  invariant(thread, "未找到当前会话。");
  invariant(thread.projectId === projectId, "AI 会话不属于当前项目。");
  invariant(thread.archivedAt == null, "不能继续已归档会话。");
  assertNoPendingRunForThread(thread);

  const parentTrace = getRunTrace(runId);
  const parentRun = parentTrace.run;
  invariant(parentRun.threadId === thread.id, "原 run 不属于当前会话。");
  invariant(runNeedsContinuation(parentTrace), "这个 run 当前不需要继续。");
  invariant(parentTrace.childRuns.length === 0, "这个 run 已经继续过。");

  const activePathRunIds = new Set(
    threadView.activePath.flatMap((node) => (node.createdByRunId ? [node.createdByRunId] : [])),
  );
  invariant(activePathRunIds.has(parentRun.id), "只能继续当前 active path 上的 run。");
  const activeTipNodeId = thread.activeTipNodeId;
  invariant(activeTipNodeId, "当前会话没有可继续的 active tip。");
  const activeTip = threadView.activePath.at(-1);
  invariant(activeTip?.id === activeTipNodeId, "当前 active tip 不在 active path 上。");
  invariant(activeTip.createdByRunId === parentRun.id, "只能从原 run 的最后节点继续。");

  const selection = resolveProjectAssistantModelSelectionFromSnapshot(parentRun.selectionSnapshot);
  const activeTools = parentRun.activeTools ?? [];
  invariant(
    activeTools.length === 0 || selection.resolvedModel.supportsToolUse,
    "原 run 使用了工具，但当前模型不支持工具调用，无法继续。",
  );
  const context = normalizeAssistantContextSnapshot(parentRun.contextSnapshot);
  const inputRefs = cloneInputRefsSnapshot(parentRun.inputRefsSnapshot);
  const system = buildProjectAssistantSystemPrompt();
  const request = resolveAssistantRequest({
    threadId: thread.id,
    triggerNodeId: activeTipNodeId,
    system,
    selection,
    context,
    inputRefs,
  });
  const run = createRun({
    threadId: thread.id,
    parentRunId: parentRun.id,
    triggerNodeId: activeTipNodeId,
    baseTipNodeId: activeTipNodeId,
    runMode: "continue",
    agentProfile: PROJECT_ASSISTANT_AGENT_PROFILE,
    selectionSnapshot: selection.snapshot,
    contextSnapshot: context,
    inputRefsSnapshot: inputRefs,
    activeTools,
  });
  appendRunEvent({
    runId: parentRun.id,
    eventKind: "child-run-started",
    nodeId: activeTipNodeId,
    relatedRunId: run.id,
    summaryText: "继续达到轮次上限的 run",
  });
  appendRunEvent({
    runId: run.id,
    eventKind: "run-started",
    nodeId: activeTipNodeId,
    relatedRunId: parentRun.id,
    summaryText: "继续达到轮次上限的 run",
  });

  return {
    projectId,
    thread,
    run,
    triggerNodeId: activeTipNodeId,
    messages: request.messages,
    providerOptions: request.providerOptions,
    system,
    transportSystem: request.transportSystem,
    selection,
    context,
    runtimeContext: createToolRuntimeContext(context),
    activeTools,
    initialResult: {
      thread: getThreadView(thread.id).thread!,
      assistantNode: null,
      run,
      parentRun,
      state: getThreadView(thread.id),
    },
    runStartedEvent: {
      type: "run-started",
      run,
      threadId: thread.id,
      triggerNodeId: activeTipNodeId,
    },
    buildFinalResult: ({ run: completedRun, lastAssistantNode }) => ({
      thread: getThreadView(thread.id).thread!,
      assistantNode: lastAssistantNode,
      run: completedRun,
      parentRun,
      state: getThreadView(thread.id),
    }),
  };
}

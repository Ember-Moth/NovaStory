import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  AgentThreadView,
  ProjectAssistantContextSnapshot,
  ProjectAssistantStreamEvent,
  ProjectAssistantToolName,
  WorkspaceMutationEvent,
} from "@/modules/ai/domain/types";
import {
  PROJECT_ASSISTANT_AUX_WRITE_TOOL_NAMES,
  PROJECT_ASSISTANT_READ_ONLY_TOOL_NAMES,
} from "@/modules/ai/domain/types";
import { rpc } from "@/rpc/client";

import {
  canSendAssistantMessage,
  EMPTY_ASSISTANT_STATE,
  EMPTY_THREADS,
  type AssistantToolTraceEntry,
  type EditingThreadState,
  getCandidateGroupForNode,
  getRunErrorMessage,
  getUsageTotalTokens,
  selectPendingRun,
  selectRetryableRun,
  type PendingAssistantAction,
} from "./assistantState";

export type SessionListRow =
  | {
      key: string;
      type: "thread";
      thread: AgentThreadView;
      className?: string;
    }
  | {
      key: "archived-toggle";
      type: "archived-toggle";
      count: number;
    };

export interface AssistantStreamOverlay {
  kind: "send" | "retry";
  threadId: string;
  triggerNodeId: string | null;
  runId: string | null;
  activeAssistantNodeId: string | null;
  startedAt: number;
  completedAt: number | null;
  status: "running" | "failed";
  stepCount: number;
  totalTokens: number | null;
  errorMessage: string | null;
  blocks: Array<{
    assistantNodeId: string;
    assistantText: string;
    reasoningTrace: Array<{
      reasoningId: string;
      text: string;
    }>;
    contentOrder: Array<
      | {
          kind: "text";
          id: "text";
        }
      | {
          kind: "reasoning";
          id: string;
        }
    >;
    toolTrace: AssistantToolTraceEntry[];
  }>;
}

export function buildSessionRows({
  unarchivedThreads,
  archivedThreads,
  showArchivedThreads,
}: {
  unarchivedThreads: AgentThreadView[];
  archivedThreads: AgentThreadView[];
  showArchivedThreads: boolean;
}): SessionListRow[] {
  const rows: SessionListRow[] = [];

  rows.push(
    ...unarchivedThreads.map((thread) => ({
      key: thread.id,
      type: "thread" as const,
      thread,
    })),
  );

  if (archivedThreads.length === 0) {
    return rows;
  }

  rows.push({
    key: "archived-toggle",
    type: "archived-toggle",
    count: archivedThreads.length,
  });

  if (!showArchivedThreads) {
    return rows;
  }

  archivedThreads.forEach((thread, index) => {
    const classNames = [
      index === 0 ? "mt-1" : "",
      index === archivedThreads.length - 1 ? "pb-1" : "",
    ]
      .filter(Boolean)
      .join(" ");

    rows.push({
      key: thread.id,
      type: "thread",
      thread,
      className: classNames || undefined,
    });
  });

  return rows;
}

export function resolveExpectedActiveThreadAfterArchiveToggle({
  activeThreadId,
  thread,
  archived,
  unarchivedThreads,
}: {
  activeThreadId: string | null;
  thread: AgentThreadView;
  archived: boolean;
  unarchivedThreads: AgentThreadView[];
}) {
  if (archived && thread.id === activeThreadId) {
    const fallbackThread = unarchivedThreads.find((current) => current.id !== thread.id) ?? null;
    return fallbackThread?.id ?? "";
  }

  if (!archived && activeThreadId == null) {
    return thread.id;
  }

  return null;
}

export function createStreamOverlay({
  kind,
  threadId,
  triggerNodeId,
}: {
  kind: "send" | "retry";
  threadId: string;
  triggerNodeId: string | null;
}): AssistantStreamOverlay {
  return {
    kind,
    threadId,
    triggerNodeId,
    runId: null,
    activeAssistantNodeId: null,
    startedAt: Date.now(),
    completedAt: null,
    status: "running",
    stepCount: 0,
    totalTokens: null,
    errorMessage: null,
    blocks: [],
  };
}

export function buildProjectAssistantSendActiveTools({
  allowAuxWrites,
}: {
  allowAuxWrites: boolean;
}): ProjectAssistantToolName[] {
  return allowAuxWrites
    ? [...PROJECT_ASSISTANT_READ_ONLY_TOOL_NAMES, ...PROJECT_ASSISTANT_AUX_WRITE_TOOL_NAMES]
    : [...PROJECT_ASSISTANT_READ_ONLY_TOOL_NAMES];
}

export function buildProjectAssistantRetryActiveTools(): ProjectAssistantToolName[] {
  return [...PROJECT_ASSISTANT_READ_ONLY_TOOL_NAMES];
}

function updateStreamToolTrace(
  current: AssistantToolTraceEntry[],
  event: Extract<ProjectAssistantStreamEvent, { type: "tool-call" | "tool-result" }>,
) {
  if (event.type === "tool-call") {
    return [
      ...current,
      {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        status: "pending" as const,
        summary: `调用 ${event.toolName}`,
        nodeId: event.assistantNodeId,
        runId: null,
        requestPayload: event.input,
        responsePayload: null,
      },
    ];
  }

  const index = current.findIndex(
    (entry) =>
      entry.toolCallId != null && event.toolCallId != null && entry.toolCallId === event.toolCallId,
  );
  if (index < 0) {
    return [
      ...current,
      {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        status: event.status,
        summary: event.status === "error" ? `${event.toolName} 执行失败` : `调用 ${event.toolName}`,
        nodeId: event.toolNodeId,
        runId: null,
        requestPayload: null,
        responsePayload: event.output,
      },
    ];
  }

  return current.map((entry, entryIndex) =>
    entryIndex === index
      ? {
          ...entry,
          status: event.status,
          summary: event.status === "error" ? `${event.toolName} 执行失败` : entry.summary,
          responsePayload: event.output,
        }
      : entry,
  );
}

function ensureStreamBlock(
  overlay: AssistantStreamOverlay,
  assistantNodeId: string,
): AssistantStreamOverlay {
  if (overlay.blocks.some((block) => block.assistantNodeId === assistantNodeId)) {
    return overlay;
  }

  return {
    ...overlay,
    blocks: [
      ...overlay.blocks,
      {
        assistantNodeId,
        assistantText: "",
        reasoningTrace: [],
        contentOrder: [],
        toolTrace: [],
      },
    ],
  };
}

export function applyStreamEvent(
  overlay: AssistantStreamOverlay,
  event: ProjectAssistantStreamEvent,
): AssistantStreamOverlay {
  if (event.type === "run-started") {
    return {
      ...overlay,
      runId: event.run.id,
      triggerNodeId: event.triggerNodeId,
    };
  }

  if (event.type === "step-started") {
    return {
      ...overlay,
      stepCount: Math.max(overlay.stepCount, event.stepIndex + 1),
    };
  }

  if (event.type === "assistant-message-started") {
    const nextOverlay = ensureStreamBlock(overlay, event.nodeId);
    return {
      ...nextOverlay,
      activeAssistantNodeId: event.nodeId,
      stepCount: Math.max(nextOverlay.stepCount, event.stepIndex + 1),
    };
  }

  if (event.type === "assistant-text-delta") {
    const nextOverlay = ensureStreamBlock(overlay, event.nodeId);
    return {
      ...nextOverlay,
      activeAssistantNodeId: event.nodeId,
      blocks: nextOverlay.blocks.map((block) =>
        block.assistantNodeId === event.nodeId
          ? {
              ...block,
              contentOrder: block.contentOrder.some((entry) => entry.kind === "text")
                ? block.contentOrder
                : [...block.contentOrder, { kind: "text", id: "text" }],
              assistantText: `${block.assistantText}${event.delta}`,
            }
          : block,
      ),
    };
  }

  if (event.type === "assistant-reasoning-delta") {
    const nextOverlay = ensureStreamBlock(overlay, event.nodeId);
    return {
      ...nextOverlay,
      activeAssistantNodeId: event.nodeId,
      blocks: nextOverlay.blocks.map((block) => {
        if (block.assistantNodeId !== event.nodeId) {
          return block;
        }

        const reasoningIndex = block.reasoningTrace.findIndex(
          (entry) => entry.reasoningId === event.reasoningId,
        );
        if (reasoningIndex < 0) {
          return {
            ...block,
            contentOrder: [...block.contentOrder, { kind: "reasoning", id: event.reasoningId }],
            reasoningTrace: [
              ...block.reasoningTrace,
              {
                reasoningId: event.reasoningId,
                text: event.accumulatedText,
              },
            ],
          };
        }

        return {
          ...block,
          reasoningTrace: block.reasoningTrace.map((entry, index) =>
            index === reasoningIndex ? { ...entry, text: event.accumulatedText } : entry,
          ),
        };
      }),
    };
  }

  if (event.type === "tool-call" || event.type === "tool-result") {
    const blockIndex =
      event.type === "tool-call"
        ? overlay.blocks.findIndex((block) => block.assistantNodeId === event.assistantNodeId)
        : overlay.blocks.findIndex((block) =>
            block.toolTrace.some(
              (entry) => entry.toolCallId != null && entry.toolCallId === event.toolCallId,
            ),
          );
    const fallbackIndex = overlay.blocks.length - 1;
    const targetIndex = blockIndex >= 0 ? blockIndex : fallbackIndex;
    if (targetIndex < 0) {
      return overlay;
    }

    return {
      ...overlay,
      blocks: overlay.blocks.map((block, index) =>
        index === targetIndex
          ? {
              ...block,
              toolTrace: updateStreamToolTrace(block.toolTrace, event),
            }
          : block,
      ),
    };
  }

  if (event.type === "step-finished") {
    const tokens = getUsageTotalTokens(event.usage);
    return {
      ...overlay,
      stepCount: Math.max(overlay.stepCount, event.stepIndex + 1),
      totalTokens: tokens == null ? overlay.totalTokens : (overlay.totalTokens ?? 0) + tokens,
    };
  }

  return overlay;
}

function patchAssistantOverviewState({
  projectId,
  thread,
  state,
}: {
  projectId: string;
  thread: AgentThreadView;
  state: typeof EMPTY_ASSISTANT_STATE;
}) {
  const current = rpc.getQueryData("ai.getProjectAssistantState", { projectId });
  if (!current) {
    return;
  }

  rpc.setQueryData(
    "ai.getProjectAssistantState",
    { projectId },
    {
      activeThreadId: thread.id,
      threads: current.threads.some((entry) => entry.id === thread.id)
        ? current.threads.map((entry) => (entry.id === thread.id ? thread : entry))
        : [thread, ...current.threads],
      state,
    },
  );
}

export function useAiAssistantController(
  projectId: string,
  contextSnapshot: ProjectAssistantContextSnapshot,
  onWorkspaceMutation?: (_event: WorkspaceMutationEvent) => void,
) {
  const [selectedConnectionId, setSelectedConnectionId] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [draft, setDraft] = useState("");
  const [selectionHydrated, setSelectionHydrated] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAssistantAction | null>(null);
  const [editingThread, setEditingThread] = useState<EditingThreadState | null>(null);
  const [showArchivedThreads, setShowArchivedThreads] = useState(false);
  const [expectedActiveThreadId, setExpectedActiveThreadId] = useState<string | null>(null);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [activeStream, setActiveStream] = useState<AssistantStreamOverlay | null>(null);
  const [includeContext, setIncludeContext] = useState(true);
  const [allowAuxWritesForNextSend, setAllowAuxWritesForNextSend] = useState(false);

  const storedSelectionQuery = rpc.useQuery("config.getAiAssistantModelSelection");
  const assistantOverviewQuery = rpc.useQuery("ai.getProjectAssistantState", { projectId });
  const connectionModelsQuery = rpc.useQuery("ai.listEnabledConnectionModels");
  const saveSelection = rpc.useMutation("config.setAiAssistantModelSelection", {
    onSuccess: (selection) => {
      rpc.setQueryData("config.getAiAssistantModelSelection", undefined, selection);
    },
  });

  const createThread = rpc.useMutation("ai.createProjectAssistantThread");
  const setActiveThread = rpc.useMutation("ai.setProjectAssistantActiveThread");
  const renameThread = rpc.useMutation("ai.renameProjectAssistantThread");
  const archiveThread = rpc.useMutation("ai.archiveProjectAssistantThread");
  const selectThreadTip = rpc.useMutation("ai.selectThreadTip");
  const sendMessageStream = rpc.useStreamMutation("ai.sendProjectAssistantMessageStream");
  const retryMessageStream = rpc.useStreamMutation("ai.retryProjectAssistantMessageStream");

  const isLoadingSelection = !selectionHydrated;
  const overview = assistantOverviewQuery.data ?? {
    activeThreadId: null,
    threads: EMPTY_THREADS,
    state: EMPTY_ASSISTANT_STATE,
  };
  const assistantState = overview.state;
  const activeThreadId = overview.activeThreadId;
  const threads = overview.threads;
  const unarchivedThreads = useMemo(
    () => threads.filter((thread) => thread.archivedAt == null),
    [threads],
  );
  const archivedThreads = useMemo(
    () => threads.filter((thread) => thread.archivedAt != null),
    [threads],
  );
  const sessionOverlayState =
    assistantOverviewQuery.isInitialLoading && threads.length === 0
      ? ("loading" as const)
      : threads.length === 0
        ? ("empty" as const)
        : null;
  const sessionRows = useMemo(
    () =>
      buildSessionRows({
        unarchivedThreads,
        archivedThreads,
        showArchivedThreads,
      }),
    [archivedThreads, showArchivedThreads, unarchivedThreads],
  );
  const retryableRun = selectRetryableRun(assistantState);
  const pendingRun = selectPendingRun(assistantState);
  const runSummaries = assistantState.runSummaries;
  const selectedResolvedModel =
    connectionModelsQuery.data
      ?.find((group) => group.connection.id === selectedConnectionId)
      ?.models.find((model) => model.id === selectedModelId) ?? null;
  const selectedModelSupportsToolUse = selectedResolvedModel?.supportsToolUse ?? false;
  const isGenerating = sendMessageStream.isStreaming || retryMessageStream.isStreaming;
  const isThreadMutating =
    createThread.isPending ||
    setActiveThread.isPending ||
    renameThread.isPending ||
    archiveThread.isPending ||
    selectThreadTip.isPending;
  const isThreadBusy = isThreadMutating || expectedActiveThreadId !== null;
  const isBusy = isGenerating || isThreadBusy;
  const canSubmit = canSendAssistantMessage({
    draft,
    threadId: activeThreadId,
    selectedConnectionId,
    selectedModelId,
    selectionHydrated,
    isBusy,
    hasPendingRun: pendingRun != null,
  });
  const messages = assistantState.activePath;
  const showEmptyState =
    messages.length === 0 && pendingAction?.kind !== "send" && activeStream?.kind !== "send";

  useEffect(() => {
    if (expectedActiveThreadId === null) {
      return;
    }

    if (
      (expectedActiveThreadId === "" && activeThreadId === null) ||
      expectedActiveThreadId === activeThreadId
    ) {
      setExpectedActiveThreadId(null);
    }
  }, [activeThreadId, expectedActiveThreadId]);

  useEffect(() => {
    if (selectionHydrated) {
      return;
    }

    const hasResolvedStoredSelection =
      storedSelectionQuery.data !== undefined || storedSelectionQuery.error !== null;
    if (!hasResolvedStoredSelection) {
      return;
    }

    setSelectedConnectionId(storedSelectionQuery.data?.connectionId ?? "");
    setSelectedModelId(storedSelectionQuery.data?.modelId ?? "");
    setSelectionHydrated(true);
  }, [selectionHydrated, storedSelectionQuery.data, storedSelectionQuery.error]);

  useEffect(() => {
    if (!pendingRun || activeStream != null) {
      return;
    }

    const timer = setInterval(() => {
      void assistantOverviewQuery.refetch();
    }, 1500);

    return () => {
      clearInterval(timer);
    };
  }, [activeStream, assistantOverviewQuery, pendingRun]);

  useEffect(() => {
    if (!activeStream || activeStream.status !== "failed" || !activeStream.runId) {
      return;
    }

    if (runSummaries.some((summary) => summary.runId === activeStream.runId)) {
      if (activeStream.kind === "send") {
        setPendingAction(null);
      }
      setActiveStream(null);
    }
  }, [activeStream, runSummaries]);

  const handleSelectionChange = useCallback((connectionId: string, modelId: string) => {
    setSelectedConnectionId(connectionId);
    setSelectedModelId(modelId);
  }, []);

  const handleSelectionCommit = useCallback(
    (connectionId: string, modelId: string) => {
      handleSelectionChange(connectionId, modelId);
      void saveSelection.mutate(
        connectionId && modelId
          ? {
              connectionId,
              modelId,
            }
          : null,
      );
    },
    [handleSelectionChange, saveSelection],
  );

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!canSubmit || !activeThreadId) {
        return;
      }

      const text = draft.trim();
      const activeTools = selectedModelSupportsToolUse
        ? buildProjectAssistantSendActiveTools({
            allowAuxWrites: allowAuxWritesForNextSend,
          })
        : null;
      setComposerError(null);
      setPendingAction({ kind: "send", text });
      setActiveStream(
        createStreamOverlay({
          kind: "send",
          threadId: activeThreadId,
          triggerNodeId: null,
        }),
      );
      setDraft("");
      let clearPendingAction = true;

      try {
        const result = await sendMessageStream.startAsync(
          {
            projectId,
            threadId: activeThreadId,
            text,
            context: includeContext ? contextSnapshot : null,
            activeTools,
          },
          {
            onEvent: (event) => {
              if (event.type === "workspace-mutated") {
                onWorkspaceMutation?.(event);
              }
              setActiveStream((current) =>
                current == null ? current : applyStreamEvent(current, event),
              );
            },
          },
        );
        patchAssistantOverviewState({
          projectId,
          thread: result.thread,
          state: result.state,
        });
        setActiveStream(null);
      } catch (error) {
        setDraft(text);
        if (error instanceof Error && error.name === "RpcStreamAborted") {
          setActiveStream(null);
          return;
        }
        clearPendingAction = false;
        const message = error instanceof Error ? error.message : "发送消息失败。";
        setComposerError(message);
        setActiveStream((current) =>
          current == null
            ? current
            : {
                ...current,
                status: "failed",
                completedAt: Date.now(),
                errorMessage: message || getRunErrorMessage(),
              },
        );
        void assistantOverviewQuery.refetch();
      } finally {
        setAllowAuxWritesForNextSend(false);
        if (clearPendingAction) {
          setPendingAction(null);
        }
      }
    },
    [
      activeThreadId,
      allowAuxWritesForNextSend,
      assistantOverviewQuery,
      canSubmit,
      contextSnapshot,
      draft,
      includeContext,
      onWorkspaceMutation,
      projectId,
      sendMessageStream,
      selectedModelSupportsToolUse,
    ],
  );

  const handleRetry = useCallback(
    async (triggerNodeId: string) => {
      if (!activeThreadId) {
        return;
      }

      setComposerError(null);
      setPendingAction({ kind: "retry", triggerNodeId });
      setActiveStream(
        createStreamOverlay({
          kind: "retry",
          threadId: activeThreadId,
          triggerNodeId,
        }),
      );

      try {
        const result = await retryMessageStream.startAsync(
          {
            projectId,
            threadId: activeThreadId,
            triggerNodeId,
            context: includeContext ? contextSnapshot : null,
            activeTools: selectedModelSupportsToolUse
              ? buildProjectAssistantRetryActiveTools()
              : null,
          },
          {
            onEvent: (event) => {
              if (event.type === "workspace-mutated") {
                onWorkspaceMutation?.(event);
              }
              setActiveStream((current) =>
                current == null ? current : applyStreamEvent(current, event),
              );
            },
          },
        );
        patchAssistantOverviewState({
          projectId,
          thread: result.thread,
          state: result.state,
        });
        setActiveStream(null);
      } catch (error) {
        if (error instanceof Error && error.name === "RpcStreamAborted") {
          setActiveStream(null);
          return;
        }
        const message = error instanceof Error ? error.message : "重试失败。";
        setComposerError(message);
        setActiveStream((current) =>
          current == null
            ? current
            : {
                ...current,
                status: "failed",
                completedAt: Date.now(),
                errorMessage: message || getRunErrorMessage(),
              },
        );
        void assistantOverviewQuery.refetch();
      } finally {
        setPendingAction(null);
      }
    },
    [
      activeThreadId,
      assistantOverviewQuery,
      contextSnapshot,
      includeContext,
      projectId,
      retryMessageStream,
      selectedModelSupportsToolUse,
      onWorkspaceMutation,
    ],
  );

  const handleCreateThread = useCallback(async () => {
    setComposerError(null);
    setEditingThread(null);

    try {
      const thread = await createThread.mutate({ projectId });
      setExpectedActiveThreadId(thread.id);
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : "新建会话失败。");
    }
  }, [createThread, projectId]);

  const handleActivateThread = useCallback(
    async (threadId: string) => {
      if (threadId === activeThreadId || isThreadBusy) {
        return;
      }

      setComposerError(null);
      setEditingThread(null);
      setExpectedActiveThreadId(threadId);

      try {
        await setActiveThread.mutate({ projectId, threadId });
      } catch (error) {
        setExpectedActiveThreadId(null);
        setComposerError(error instanceof Error ? error.message : "切换会话失败。");
      }
    },
    [activeThreadId, isThreadBusy, projectId, setActiveThread],
  );

  const handleRenameStart = useCallback((thread: AgentThreadView) => {
    setEditingThread({ threadId: thread.id, title: thread.title });
  }, []);

  const handleRenameCancel = useCallback(() => {
    setEditingThread(null);
  }, []);

  const handleEditingThreadTitleChange = useCallback((threadId: string, value: string) => {
    setEditingThread({ threadId, title: value });
  }, []);

  const handleRenameSubmit = useCallback(async () => {
    if (!editingThread) {
      return;
    }

    const normalizedTitle = editingThread.title.trim();
    const currentThread = threads.find((thread) => thread.id === editingThread.threadId) ?? null;
    if (currentThread && normalizedTitle === currentThread.title.trim()) {
      setEditingThread(null);
      return;
    }

    setComposerError(null);

    try {
      await renameThread.mutate({
        threadId: editingThread.threadId,
        title: normalizedTitle,
      });
      setEditingThread(null);
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : "重命名会话失败。");
    }
  }, [editingThread, renameThread, threads]);

  const handleArchiveToggle = useCallback(
    async (thread: AgentThreadView, archived: boolean) => {
      setComposerError(null);
      setEditingThread((current) => (current?.threadId === thread.id ? null : current));

      const nextExpectedActiveThreadId = resolveExpectedActiveThreadAfterArchiveToggle({
        activeThreadId,
        thread,
        archived,
        unarchivedThreads,
      });
      if (nextExpectedActiveThreadId !== null) {
        setExpectedActiveThreadId(nextExpectedActiveThreadId);
      }

      try {
        await archiveThread.mutate({ threadId: thread.id, archived });
      } catch (error) {
        setExpectedActiveThreadId(null);
        setComposerError(error instanceof Error ? error.message : "更新会话状态失败。");
      }
    },
    [activeThreadId, archiveThread, unarchivedThreads],
  );

  const handleSelectCandidate = useCallback(
    async (tipNodeId: string) => {
      const threadId = assistantState.thread?.id;
      if (!threadId || isThreadBusy) {
        return;
      }

      setComposerError(null);
      try {
        await selectThreadTip.mutate({
          threadId,
          tipNodeId,
        });
      } catch (error) {
        setComposerError(error instanceof Error ? error.message : "切换候选失败。");
      }
    },
    [assistantState.thread?.id, isThreadBusy, selectThreadTip],
  );

  return {
    activeStream,
    activeThreadId,
    canSubmit,
    composerError,
    draft,
    editingThread,
    getCandidateGroupForNode: (node: (typeof messages)[number]) =>
      getCandidateGroupForNode(assistantState.candidateGroups, node),
    handleActivateThread,
    handleArchiveToggle,
    handleCreateThread,
    handleEditingThreadTitleChange,
    handleRenameCancel,
    handleRenameStart,
    handleRenameSubmit,
    handleRetry,
    handleSelectCandidate,
    handleSelectionChange,
    handleSelectionCommit,
    handleSubmit,
    allowAuxWritesForNextSend,
    includeContext,
    isBusy,
    isGenerating,
    isLoadingSelection,
    isRetrying: retryMessageStream.isStreaming,
    isThreadBusy,
    isThreadMutating,
    messages,
    pendingAction,
    pendingRun,
    retryableRun,
    runSummaries,
    selectedConnectionId,
    selectedModelSupportsToolUse,
    selectedModelId,
    selectionHydrated,
    sessionOverlayState,
    sessionRows,
    setAllowAuxWritesForNextSend,
    setDraft,
    setIncludeContext,
    showArchivedThreads,
    setShowArchivedThreads,
    showEmptyState,
    assistantStateIsInitialLoading: assistantOverviewQuery.isInitialLoading,
    contextSnapshot,
    hasDraft: draft.trim().length > 0,
  };
}

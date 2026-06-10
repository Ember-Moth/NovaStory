import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  AgentThreadView,
  ProjectAssistantContextSnapshot,
  ProjectAssistantStreamEvent,
} from "@/modules/ai/domain/types";
import { rpc } from "@/rpc/client";

import {
  canSendAssistantMessage,
  EMPTY_ASSISTANT_STATE,
  EMPTY_THREADS,
  type AssistantToolTraceEntry,
  type EditingThreadState,
  getCandidateGroupForNode,
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
  blocks: Array<{
    assistantNodeId: string;
    assistantText: string;
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

function createStreamOverlay({
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
    blocks: [],
  };
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
        toolTrace: [],
      },
    ],
  };
}

function applyStreamEvent(
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

  if (event.type === "assistant-message-started") {
    const nextOverlay = ensureStreamBlock(overlay, event.nodeId);
    return {
      ...nextOverlay,
      activeAssistantNodeId: event.nodeId,
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
              assistantText: `${block.assistantText}${event.delta}`,
            }
          : block,
      ),
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

  return overlay;
}

export function useAiAssistantController(
  projectId: string,
  contextSnapshot: ProjectAssistantContextSnapshot,
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

  const storedSelectionQuery = rpc.useQuery("config.getAiAssistantModelSelection");
  const assistantOverviewQuery = rpc.useQuery("ai.getProjectAssistantState", { projectId });
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
      : unarchivedThreads.length === 0
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

      try {
        await sendMessageStream.startAsync(
          {
            projectId,
            threadId: activeThreadId,
            text,
            context: contextSnapshot,
          },
          {
            onEvent: (event) => {
              setActiveStream((current) =>
                current == null ? current : applyStreamEvent(current, event),
              );
            },
          },
        );
      } catch (error) {
        setDraft(text);
        if (error instanceof Error && error.name === "RpcStreamAborted") {
          return;
        }
        setComposerError(error instanceof Error ? error.message : "发送消息失败。");
      } finally {
        setPendingAction(null);
        setActiveStream(null);
      }
    },
    [activeThreadId, canSubmit, contextSnapshot, draft, projectId, sendMessageStream],
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
        await retryMessageStream.startAsync(
          {
            projectId,
            threadId: activeThreadId,
            triggerNodeId,
            context: contextSnapshot,
          },
          {
            onEvent: (event) => {
              setActiveStream((current) =>
                current == null ? current : applyStreamEvent(current, event),
              );
            },
          },
        );
      } catch (error) {
        if (error instanceof Error && error.name === "RpcStreamAborted") {
          return;
        }
        setComposerError(error instanceof Error ? error.message : "重试失败。");
      } finally {
        setPendingAction(null);
        setActiveStream(null);
      }
    },
    [activeThreadId, contextSnapshot, projectId, retryMessageStream],
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
    selectedConnectionId,
    selectedModelId,
    selectionHydrated,
    sessionOverlayState,
    sessionRows,
    setDraft,
    showArchivedThreads,
    setShowArchivedThreads,
    showEmptyState,
    assistantStateIsInitialLoading: assistantOverviewQuery.isInitialLoading,
    contextSnapshot,
    hasDraft: draft.trim().length > 0,
  };
}

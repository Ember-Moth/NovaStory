import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  AgentThreadView,
  ProjectAssistantContextSnapshot,
  ProjectAssistantStreamEvent,
  TimelineSelectionUpdatedEvent,
  WorkspaceRefreshRequestedEvent,
} from "@/modules/ai/domain/types";
import { rpc } from "@/rpc/client";

import type { AssistantComposerSubmitPayload } from "../composer/AssistantComposer";
import {
  canSendAssistantMessage,
  getCandidateGroupForNode,
  selectPendingRun,
  selectRetryableRun,
} from "../messages/runSummaryModel";
import {
  buildProjectAssistantRetryActiveTools,
  buildProjectAssistantSendActiveTools,
} from "./activeTools";
import { patchAssistantOverviewState } from "./assistantQueryCache";
import {
  EMPTY_ASSISTANT_STATE,
  EMPTY_THREADS,
  type EditingThreadState,
  type PendingAssistantAction,
} from "./controllerState";
import {
  getForwardedAssistantRefreshEvent,
  isAssistantStreamAbortError,
  isToolInputResumeEvent,
} from "./streamEvents";
import {
  applyAssistantStreamEvent,
  createStreamOverlay,
  failAssistantStreamOverlay,
  type AssistantStreamOverlay,
} from "./streamOverlay";
import {
  buildSessionRows,
  resolveExpectedActiveThreadAfterArchiveToggle,
} from "../sessions/sessionListModel";
import type { AssistantAskUserAnswer } from "../messages/askUserModel";

export const DEFAULT_ALLOW_WRITES_FOR_NEXT_SEND = true;

export function useAiAssistantController(
  projectId: string,
  onWorkspaceRefreshRequested?: (
    _event: WorkspaceRefreshRequestedEvent | TimelineSelectionUpdatedEvent,
  ) => void,
  context?: ProjectAssistantContextSnapshot | null,
) {
  type AssistantStreamResult = {
    thread: AgentThreadView;
    state: typeof EMPTY_ASSISTANT_STATE;
  };

  type AssistantStreamMutation<Input> = {
    startAsync: (
      input: Input,
      options: {
        onEvent: (_event: ProjectAssistantStreamEvent) => void;
      },
    ) => Promise<AssistantStreamResult>;
  };

  const [selectedConnectionId, setSelectedConnectionId] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [draft, setDraft] = useState("");
  const [draftMentionCount, setDraftMentionCount] = useState(0);
  const [selectionHydrated, setSelectionHydrated] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAssistantAction | null>(null);
  const [editingThread, setEditingThread] = useState<EditingThreadState | null>(null);
  const [showArchivedThreads, setShowArchivedThreads] = useState(false);
  const [expectedActiveThreadId, setExpectedActiveThreadId] = useState<string | null>(null);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [activeStream, setActiveStream] = useState<AssistantStreamOverlay | null>(null);
  const [allowWritesForNextSend, setAllowWritesForNextSend] = useState(
    DEFAULT_ALLOW_WRITES_FOR_NEXT_SEND,
  );

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
  const cancelRun = rpc.useMutation("ai.cancelProjectAssistantRun");
  const sendMessageStream = rpc.useStreamMutation("ai.sendProjectAssistantMessageStream");
  const retryMessageStream = rpc.useStreamMutation("ai.retryProjectAssistantMessageStream");
  const continueRunStream = rpc.useStreamMutation("ai.continueProjectAssistantRunStream");
  const submitToolInputStream = rpc.useStreamMutation("ai.submitProjectAssistantToolInputStream");
  const [submittingToolInputToolCallId, setSubmittingToolInputToolCallId] = useState<string | null>(
    null,
  );
  const [submittedToolInputAnswers, setSubmittedToolInputAnswers] = useState<
    Record<string, AssistantAskUserAnswer[]>
  >({});

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
    () => buildSessionRows({ unarchivedThreads, archivedThreads, showArchivedThreads }),
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
  const isGenerating =
    sendMessageStream.isStreaming ||
    retryMessageStream.isStreaming ||
    continueRunStream.isStreaming ||
    submitToolInputStream.isStreaming;
  const isWaitingForInput = pendingRun?.status === "waiting_for_input";
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
    mentionCount: draftMentionCount,
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
    setSubmittingToolInputToolCallId(null);
    setSubmittedToolInputAnswers({});
  }, [activeThreadId]);

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

  const runAssistantStreamAction = useCallback(
    async <Input>({
      overlay,
      mutation,
      input,
      fallbackErrorMessage,
      onEvent,
    }: {
      overlay: AssistantStreamOverlay;
      mutation: AssistantStreamMutation<Input>;
      input: Input;
      fallbackErrorMessage: string;
      onEvent?: (_event: ProjectAssistantStreamEvent) => void;
    }) => {
      setActiveStream(overlay);

      try {
        const result = await mutation.startAsync(input, {
          onEvent: (event) => {
            const refreshEvent = getForwardedAssistantRefreshEvent(event);
            if (refreshEvent) {
              onWorkspaceRefreshRequested?.(refreshEvent);
            }
            onEvent?.(event);
            setActiveStream((current) => applyAssistantStreamEvent(current, event));
          },
        });
        patchAssistantOverviewState({
          projectId,
          thread: result.thread,
          state: result.state,
        });
        setActiveStream(null);
        return { status: "success" as const };
      } catch (error) {
        if (isAssistantStreamAbortError(error)) {
          void assistantOverviewQuery.refetch();
          setActiveStream(null);
          return { status: "aborted" as const };
        }

        const message = error instanceof Error ? error.message : fallbackErrorMessage;
        setComposerError(message);
        setActiveStream((current) => failAssistantStreamOverlay(current, message));
        void assistantOverviewQuery.refetch();
        return { status: "error" as const };
      }
    },
    [assistantOverviewQuery, onWorkspaceRefreshRequested, projectId],
  );

  const sendAssistantMessage = useCallback(
    async (payload: AssistantComposerSubmitPayload) => {
      const text = payload.text.trim();
      const activeTools = selectedModelSupportsToolUse
        ? buildProjectAssistantSendActiveTools({ allowWrites: allowWritesForNextSend })
        : null;
      setComposerError(null);
      setPendingAction({ kind: "send", text, mentions: payload.mentions });
      setDraft("");
      setDraftMentionCount(0);
      let clearPendingAction = true;

      try {
        let threadId = activeThreadId;
        if (!threadId) {
          const thread = await createThread.mutate({ projectId });
          threadId = thread.id;
          setExpectedActiveThreadId(thread.id);
        }

        const result = await runAssistantStreamAction({
          overlay: createStreamOverlay({
            kind: "send",
            threadId,
            triggerNodeId: null,
          }),
          mutation: sendMessageStream,
          input: {
            projectId,
            threadId,
            text,
            mentions: payload.mentions,
            context,
            activeTools,
          },
          fallbackErrorMessage: "发送消息失败。",
        });

        if (result.status !== "success") {
          setDraft(text);
          setDraftMentionCount(0);
        }

        if (result.status === "error") {
          clearPendingAction = false;
        }
      } catch (error) {
        setDraft(text);
        setDraftMentionCount(0);
        const message = error instanceof Error ? error.message : "发送消息失败。";
        setComposerError(message);
        void assistantOverviewQuery.refetch();
      } finally {
        setAllowWritesForNextSend(DEFAULT_ALLOW_WRITES_FOR_NEXT_SEND);
        if (clearPendingAction) {
          setPendingAction(null);
        }
      }
    },
    [
      activeThreadId,
      allowWritesForNextSend,
      assistantOverviewQuery,
      context,
      createThread,
      projectId,
      runAssistantStreamAction,
      sendMessageStream,
      selectedModelSupportsToolUse,
    ],
  );

  const handleSubmit = useCallback(
    (payload: AssistantComposerSubmitPayload) => {
      const text = payload.text.trim();
      if (
        !selectionHydrated ||
        selectedConnectionId.length === 0 ||
        selectedModelId.length === 0 ||
        isBusy ||
        pendingRun != null
      ) {
        return false;
      }

      if (text.length === 0 && payload.mentions.length === 0) {
        return false;
      }

      void sendAssistantMessage({ ...payload, text });
      return true;
    },
    [
      isBusy,
      pendingRun,
      selectedConnectionId,
      selectedModelId,
      selectionHydrated,
      sendAssistantMessage,
    ],
  );

  const handleRetry = useCallback(
    async (triggerNodeId: string) => {
      if (!activeThreadId) {
        return;
      }

      setComposerError(null);
      setPendingAction({ kind: "retry", triggerNodeId });
      try {
        await runAssistantStreamAction({
          overlay: createStreamOverlay({
            kind: "retry",
            threadId: activeThreadId,
            triggerNodeId,
          }),
          mutation: retryMessageStream,
          input: {
            projectId,
            threadId: activeThreadId,
            triggerNodeId,
            activeTools: selectedModelSupportsToolUse
              ? buildProjectAssistantRetryActiveTools()
              : null,
          },
          fallbackErrorMessage: "重试失败。",
        });
      } finally {
        setPendingAction(null);
      }
    },
    [
      activeThreadId,
      projectId,
      retryMessageStream,
      runAssistantStreamAction,
      selectedModelSupportsToolUse,
    ],
  );

  const handleContinueRun = useCallback(
    async (runId: string) => {
      if (!activeThreadId) {
        return;
      }

      setComposerError(null);
      setPendingAction({ kind: "continue", runId });
      try {
        await runAssistantStreamAction({
          overlay: createStreamOverlay({
            kind: "continue",
            threadId: activeThreadId,
            triggerNodeId: null,
          }),
          mutation: continueRunStream,
          input: {
            projectId,
            threadId: activeThreadId,
            runId,
          },
          fallbackErrorMessage: "继续生成失败。",
        });
      } finally {
        setPendingAction(null);
      }
    },
    [activeThreadId, continueRunStream, projectId, runAssistantStreamAction],
  );

  const handleSubmitToolInput = useCallback(
    async (toolCallId: string, answers: AssistantAskUserAnswer[]) => {
      if (!activeThreadId || !pendingRun || pendingRun.status !== "waiting_for_input") {
        return;
      }

      setComposerError(null);
      setSubmittingToolInputToolCallId(toolCallId);
      setSubmittedToolInputAnswers((current) => ({
        ...current,
        [toolCallId]: answers,
      }));
      setPendingAction({ kind: "tool-input", runId: pendingRun.id, toolCallId });
      const result = await runAssistantStreamAction({
        overlay: createStreamOverlay({
          kind: "tool-input",
          threadId: activeThreadId,
          triggerNodeId: pendingRun.triggerNodeId,
          runId: pendingRun.id,
        }),
        mutation: submitToolInputStream,
        input: {
          projectId,
          threadId: activeThreadId,
          runId: pendingRun.id,
          toolCallId,
          answers,
        },
        fallbackErrorMessage: "提交回答失败。",
        onEvent: (event) => {
          if (isToolInputResumeEvent(event)) {
            setSubmittingToolInputToolCallId(null);
          }
        },
      });
      try {
        if (result.status !== "error") {
          return;
        }

        setSubmittedToolInputAnswers((current) => {
          const next = { ...current };
          delete next[toolCallId];
          return next;
        });
      } finally {
        setSubmittingToolInputToolCallId(null);
        setPendingAction(null);
      }
    },
    [activeThreadId, pendingRun, projectId, runAssistantStreamAction, submitToolInputStream],
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

  const handleAbort = useCallback(async () => {
    const activeRunId = activeStream?.runId ?? pendingRun?.id ?? null;
    if (!activeThreadId || !activeRunId) {
      if (sendMessageStream.isStreaming) {
        sendMessageStream.abort();
      } else if (retryMessageStream.isStreaming) {
        retryMessageStream.abort();
      } else if (continueRunStream.isStreaming) {
        continueRunStream.abort();
      } else if (submitToolInputStream.isStreaming) {
        submitToolInputStream.abort();
      }
      return;
    }

    try {
      await cancelRun.mutate({
        projectId,
        threadId: activeThreadId,
        runId: activeRunId,
      });
    } finally {
      if (sendMessageStream.isStreaming) {
        sendMessageStream.abort();
      } else if (retryMessageStream.isStreaming) {
        retryMessageStream.abort();
      } else if (continueRunStream.isStreaming) {
        continueRunStream.abort();
      } else if (submitToolInputStream.isStreaming) {
        submitToolInputStream.abort();
      }
      void assistantOverviewQuery.refetch();
    }
  }, [
    activeStream?.runId,
    activeThreadId,
    assistantOverviewQuery,
    cancelRun,
    continueRunStream,
    pendingRun?.id,
    projectId,
    retryMessageStream,
    sendMessageStream,
    submitToolInputStream,
  ]);

  const handleSelectCandidate = useCallback(
    async (tipNodeId: string) => {
      const threadId = assistantState.thread?.id;
      if (!threadId || isThreadBusy) {
        return;
      }

      setComposerError(null);
      try {
        await selectThreadTip.mutate({ threadId, tipNodeId });
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
    handleContinueRun,
    handleSelectCandidate,
    handleSelectionChange,
    handleSelectionCommit,
    handleSubmit,
    handleAbort,
    handleSubmitToolInput,
    allowWritesForNextSend,
    isBusy,
    isGenerating,
    isWaitingForInput,
    isLoadingSelection,
    isRetrying: retryMessageStream.isStreaming,
    isContinuing: continueRunStream.isStreaming,
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
    setAllowWritesForNextSend,
    setDraft,
    setDraftMentionCount,
    submittedToolInputAnswers,
    submittingToolInputToolCallId,
    showArchivedThreads,
    setShowArchivedThreads,
    showEmptyState,
    assistantStateIsInitialLoading: assistantOverviewQuery.isInitialLoading,
    hasDraft: draft.trim().length > 0,
  };
}

export type AiAssistantController = ReturnType<typeof useAiAssistantController>;

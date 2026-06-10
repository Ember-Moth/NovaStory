import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { AiProjectHeadView } from "@/modules/ai/domain/types";
import { rpc } from "@/rpc/client";

import {
  applyRetryResultToState,
  applySendResultToState,
  canSendAssistantMessage,
  EMPTY_ASSISTANT_STATE,
  EMPTY_HEADS,
  type AssistantMutationContext,
  type EditingHeadState,
  selectPendingAttempt,
  selectRetryableAttempt,
  type PendingAssistantAction,
} from "./assistantState";

export type SessionListRow =
  | {
      key: string;
      type: "head";
      head: AiProjectHeadView;
      className?: string;
    }
  | {
      key: "archived-toggle";
      type: "archived-toggle";
      count: number;
    };

export function buildSessionRows({
  unarchivedHeads,
  archivedHeads,
  showArchivedHeads,
}: {
  unarchivedHeads: AiProjectHeadView[];
  archivedHeads: AiProjectHeadView[];
  showArchivedHeads: boolean;
}): SessionListRow[] {
  const rows: SessionListRow[] = [];

  rows.push(
    ...unarchivedHeads.map((head) => ({
      key: head.id,
      type: "head" as const,
      head,
    })),
  );

  if (archivedHeads.length === 0) {
    return rows;
  }

  rows.push({
    key: "archived-toggle",
    type: "archived-toggle",
    count: archivedHeads.length,
  });

  if (!showArchivedHeads) {
    return rows;
  }

  archivedHeads.forEach((head, index) => {
    const classNames = [index === 0 ? "mt-1" : "", index === archivedHeads.length - 1 ? "pb-1" : ""]
      .filter(Boolean)
      .join(" ");

    rows.push({
      key: head.id,
      type: "head",
      head,
      className: classNames || undefined,
    });
  });

  return rows;
}

export function resolveExpectedActiveHeadAfterArchiveToggle({
  activeHeadId,
  head,
  archived,
  unarchivedHeads,
}: {
  activeHeadId: string | null;
  head: AiProjectHeadView;
  archived: boolean;
  unarchivedHeads: AiProjectHeadView[];
}) {
  if (archived && head.id === activeHeadId) {
    const fallbackHead = unarchivedHeads.find((current) => current.id !== head.id) ?? null;
    return fallbackHead?.id ?? "";
  }

  if (!archived && activeHeadId == null) {
    return head.id;
  }

  return null;
}

export function useAiAssistantController(projectId: string) {
  const [selectedConnectionId, setSelectedConnectionId] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [draft, setDraft] = useState("");
  const [selectionHydrated, setSelectionHydrated] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAssistantAction | null>(null);
  const [editingHead, setEditingHead] = useState<EditingHeadState | null>(null);
  const [showArchivedHeads, setShowArchivedHeads] = useState(false);
  const [expectedActiveHeadId, setExpectedActiveHeadId] = useState<string | null>(null);
  const [composerError, setComposerError] = useState<string | null>(null);

  const storedSelectionQuery = rpc.useQuery("config.getAiAssistantModelSelection");
  const projectHeadsQuery = rpc.useQuery("ai.listProjectHeads", { projectId });
  const assistantStateQuery = rpc.useQuery("ai.getProjectAssistantState", { projectId });
  const saveSelection = rpc.useMutation("config.setAiAssistantModelSelection", {
    onSuccess: (selection) => {
      rpc.setQueryData("config.getAiAssistantModelSelection", undefined, selection);
    },
  });
  const createSession = rpc.useMutation("ai.createProjectAssistantSession");
  const setActiveHead = rpc.useMutation("ai.setProjectAssistantActiveHead");
  const renameProjectHead = rpc.useMutation("ai.renameProjectHead");
  const archiveProjectHead = rpc.useMutation("ai.archiveHead");
  const sendMessage = rpc.useMutation<"ai.sendProjectAssistantMessage", AssistantMutationContext>(
    "ai.sendProjectAssistantMessage",
    {
      onMutate: () => ({
        previousState: rpc.getQueryData("ai.getProjectAssistantState", { projectId }),
      }),
      onSuccess: (result) => {
        const previousState = rpc.getQueryData("ai.getProjectAssistantState", { projectId });
        rpc.setQueryData(
          "ai.getProjectAssistantState",
          { projectId },
          applySendResultToState(previousState, result),
        );
      },
      onError: (_, __, context) => {
        if (context?.previousState) {
          rpc.setQueryData("ai.getProjectAssistantState", { projectId }, context.previousState);
        }
      },
    },
  );
  const retryMessage = rpc.useMutation<"ai.retryProjectAssistantMessage", AssistantMutationContext>(
    "ai.retryProjectAssistantMessage",
    {
      onMutate: () => ({
        previousState: rpc.getQueryData("ai.getProjectAssistantState", { projectId }),
      }),
      onSuccess: (result) => {
        const previousState = rpc.getQueryData("ai.getProjectAssistantState", { projectId });
        rpc.setQueryData(
          "ai.getProjectAssistantState",
          { projectId },
          applyRetryResultToState(previousState, result),
        );
      },
      onError: (_, __, context) => {
        if (context?.previousState) {
          rpc.setQueryData("ai.getProjectAssistantState", { projectId }, context.previousState);
        }
      },
    },
  );

  const isLoadingSelection = !selectionHydrated;
  const assistantState = assistantStateQuery.data ?? EMPTY_ASSISTANT_STATE;
  const activeHeadId = assistantState.head?.id ?? null;
  const heads = projectHeadsQuery.data ?? EMPTY_HEADS;
  const unarchivedHeads = useMemo(() => heads.filter((head) => !head.isArchived), [heads]);
  const archivedHeads = useMemo(() => heads.filter((head) => head.isArchived), [heads]);
  const sessionOverlayState =
    projectHeadsQuery.isInitialLoading && heads.length === 0
      ? ("loading" as const)
      : unarchivedHeads.length === 0
        ? ("empty" as const)
        : null;
  const sessionRows = useMemo(
    () =>
      buildSessionRows({
        unarchivedHeads,
        archivedHeads,
        showArchivedHeads,
      }),
    [archivedHeads, showArchivedHeads, unarchivedHeads],
  );
  const retryableAttempt = selectRetryableAttempt(assistantStateQuery.data);
  const pendingAttempt = selectPendingAttempt(assistantStateQuery.data);
  const isGenerating = sendMessage.isPending || retryMessage.isPending;
  const isSessionMutating =
    createSession.isPending ||
    setActiveHead.isPending ||
    renameProjectHead.isPending ||
    archiveProjectHead.isPending;
  const isSessionBusy = isSessionMutating || expectedActiveHeadId !== null;
  const isBusy = isGenerating || isSessionBusy;
  const canSubmit = canSendAssistantMessage({
    draft,
    headId: activeHeadId,
    selectedConnectionId,
    selectedModelId,
    selectionHydrated,
    isBusy,
    hasPendingAttempt: pendingAttempt != null,
  });
  const messages = assistantState.messages;
  const showEmptyState = messages.length === 0 && pendingAction?.kind !== "send";

  useEffect(() => {
    if (expectedActiveHeadId === null) {
      return;
    }

    if (
      (expectedActiveHeadId === "" && activeHeadId === null) ||
      expectedActiveHeadId === activeHeadId
    ) {
      setExpectedActiveHeadId(null);
    }
  }, [activeHeadId, expectedActiveHeadId]);

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
      if (!canSubmit || !activeHeadId) {
        return;
      }

      const text = draft.trim();
      setComposerError(null);
      setPendingAction({ kind: "send", text });
      setDraft("");

      try {
        await sendMessage.mutate({ projectId, headId: activeHeadId, text });
      } catch (error) {
        setDraft(text);
        setComposerError(error instanceof Error ? error.message : "发送消息失败。");
      } finally {
        setPendingAction(null);
      }
    },
    [activeHeadId, canSubmit, draft, projectId, sendMessage],
  );

  const handleRetry = useCallback(
    async (triggerMessageId: string) => {
      if (!activeHeadId) {
        return;
      }

      setComposerError(null);
      setPendingAction({ kind: "retry", triggerMessageId });

      try {
        await retryMessage.mutate({ projectId, headId: activeHeadId, triggerMessageId });
      } catch (error) {
        setComposerError(error instanceof Error ? error.message : "重试失败。");
      } finally {
        setPendingAction(null);
      }
    },
    [activeHeadId, projectId, retryMessage],
  );

  const handleCreateSession = useCallback(async () => {
    setComposerError(null);
    setEditingHead(null);

    try {
      const head = await createSession.mutate({ projectId });
      setExpectedActiveHeadId(head.id);
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : "新建会话失败。");
    }
  }, [createSession, projectId]);

  const handleActivateHead = useCallback(
    async (headId: string) => {
      if (headId === activeHeadId || isSessionBusy) {
        return;
      }

      setComposerError(null);
      setEditingHead(null);
      setExpectedActiveHeadId(headId);

      try {
        await setActiveHead.mutate({ projectId, headId });
      } catch (error) {
        setExpectedActiveHeadId(null);
        setComposerError(error instanceof Error ? error.message : "切换会话失败。");
      }
    },
    [activeHeadId, isSessionBusy, projectId, setActiveHead],
  );

  const handleRenameStart = useCallback((head: AiProjectHeadView) => {
    setEditingHead({ headId: head.id, name: head.name });
  }, []);

  const handleRenameCancel = useCallback(() => {
    setEditingHead(null);
  }, []);

  const handleEditingHeadNameChange = useCallback((headId: string, value: string) => {
    setEditingHead({ headId, name: value });
  }, []);

  const handleRenameSubmit = useCallback(async () => {
    if (!editingHead) {
      return;
    }

    const normalizedName = editingHead.name.trim();
    const currentHead = heads.find((head) => head.id === editingHead.headId) ?? null;
    if (currentHead && normalizedName === currentHead.name.trim()) {
      setEditingHead(null);
      return;
    }

    setComposerError(null);

    try {
      await renameProjectHead.mutate({
        headId: editingHead.headId,
        name: normalizedName,
      });
      setEditingHead(null);
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : "重命名会话失败。");
    }
  }, [editingHead, heads, renameProjectHead]);

  const handleArchiveToggle = useCallback(
    async (head: AiProjectHeadView, archived: boolean) => {
      setComposerError(null);
      setEditingHead((current) => (current?.headId === head.id ? null : current));

      const nextExpectedActiveHeadId = resolveExpectedActiveHeadAfterArchiveToggle({
        activeHeadId,
        head,
        archived,
        unarchivedHeads,
      });
      if (nextExpectedActiveHeadId !== null) {
        setExpectedActiveHeadId(nextExpectedActiveHeadId);
      }

      try {
        await archiveProjectHead.mutate({ headId: head.id, archived });
      } catch (error) {
        setExpectedActiveHeadId(null);
        setComposerError(error instanceof Error ? error.message : "更新会话状态失败。");
      }
    },
    [activeHeadId, archiveProjectHead, unarchivedHeads],
  );

  return {
    activeHeadId,
    canSubmit,
    composerError,
    draft,
    editingHead,
    handleActivateHead,
    handleArchiveToggle,
    handleCreateSession,
    handleEditingHeadNameChange,
    handleRenameCancel,
    handleRenameStart,
    handleRenameSubmit,
    handleRetry,
    handleSelectionChange,
    handleSelectionCommit,
    handleSubmit,
    isBusy,
    isGenerating,
    isLoadingSelection,
    isRetrying: retryMessage.isPending,
    isSessionBusy,
    isSessionMutating,
    messages,
    pendingAction,
    pendingAttempt,
    retryableAttempt,
    selectedConnectionId,
    selectedModelId,
    selectionHydrated,
    sessionOverlayState,
    sessionRows,
    setDraft,
    showArchivedHeads,
    setShowArchivedHeads,
    showEmptyState,
    assistantStateIsInitialLoading: assistantStateQuery.isInitialLoading,
    hasDraft: draft.trim().length > 0,
  };
}

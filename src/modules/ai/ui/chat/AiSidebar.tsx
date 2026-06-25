import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useChat } from "@ai-sdk/react";
import {
  lastAssistantMessageIsCompleteWithApprovalResponses,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";

import { deriveProjectChatTitleFromText } from "@/modules/ai/domain/project-chat/title";
import type {
  ProjectChatInfo,
  ProjectChatModelConfig,
} from "@/modules/ai/domain/project-chat/types";
import type {
  ProjectAssistantContextSnapshot,
  ProjectAssistantToolName,
  TimelineSelectionUpdatedEvent,
  WorkspaceRefreshRequestedEvent,
} from "@/modules/ai/domain/types";
import { FullPageMessage } from "@/shared/ui/FullPageMessage";
import { createId } from "@/shared/lib/domain";
import { OverlayScrollbar } from "@/shared/ui/OverlayScrollbar";
import { rpc } from "@/rpc/client";

import { useAssistantSheetLayout } from "../assistant/layout/useAssistantSheetLayout";
import type { AssistantComposerSubmitPayload } from "../assistant/composer/AssistantComposer";
import type {
  AssistantAskUserAnswer,
  AssistantAskUserQuestion,
} from "../assistant/messages/askUserModel";
import { ChatComposerPane } from "./ChatComposerPane";
import { MessageList } from "./MessageList";
import { useAutoFollowScroll } from "./hooks/useAutoFollowScroll";
import { SessionList } from "./SessionList";
import { resolveSidebarActiveChat } from "./sidebarSessionState";
import { useChatPathState } from "./hooks/useChatPathState";
import { ProjectChatTransport } from "./transport/ProjectChatTransport";
import type { ProjectChatMessage } from "./types";

function useProjectChats(projectId: string) {
  const [showArchived, setShowArchived] = useState(false);

  const chatsQuery = rpc.useQuery("ai.chats.list", {
    projectId,
    archived: showArchived ? "all" : false,
  });
  const createChatMutation = rpc.useMutation("ai.chats.create");
  const archiveChatMutation = rpc.useMutation("ai.chats.archive");

  const createChat = useCallback(
    async (options?: { title?: string; modelConfig?: ProjectChatModelConfig }) => {
      const result = await createChatMutation.mutateAsync({
        projectId,
        ...(options?.title ? { title: options.title } : {}),
        ...(options?.modelConfig ? { modelConfig: options.modelConfig } : {}),
      });
      return result.chat;
    },
    [projectId, createChatMutation],
  );

  const archiveChat = useCallback(
    async (chatId: string, archived: boolean) => {
      await archiveChatMutation.mutateAsync({ projectId, chatId, archived });
    },
    [projectId, archiveChatMutation],
  );

  return {
    chats: chatsQuery.data?.chats ?? [],
    showArchived,
    setShowArchived,
    isLoading: chatsQuery.isLoading,
    isMutating: createChatMutation.isPending || archiveChatMutation.isPending,
    reload: () => chatsQuery.refetch(),
    createChat,
    archiveChat,
  };
}

interface ActiveChatControllerValue {
  chatId: string;
  messages: ProjectChatMessage[];
  allMessages: ReturnType<typeof useChatPathState>["allMessages"];
  candidateGroups: ReturnType<typeof useChatPathState>["candidateGroups"];
  status: ReturnType<typeof useChat<ProjectChatMessage>>["status"];
  selectedConnectionId: string;
  selectedModelId: string;
  isSavingModel: boolean;
  selectBranch: (_parentMessageId: string | null, _childMessageId: string) => void;
  submitAskUser: (
    _toolCallId: string,
    _request: {
      title?: string;
      questions: AssistantAskUserQuestion[];
    },
    _answers: AssistantAskUserAnswer[],
  ) => void;
  submitComposer: (
    _payload: AssistantComposerSubmitPayload,
    _activeTools: ProjectAssistantToolName[],
  ) => void;
  commitModelSelection: (_connectionId: string, _modelId: string) => void;
  abortStream: () => Promise<boolean>;
  resumeStream: () => void;
}

const ActiveChatControllerContext = createContext<ActiveChatControllerValue | null>(null);

type QueuedInitialSubmit = {
  id: string;
  chatId: string;
  payload: AssistantComposerSubmitPayload;
  activeTools: ProjectAssistantToolName[];
};

function ActiveChatConversationProvider({
  projectId,
  chatId,
  context,
  queuedInitialSubmit,
  onQueuedInitialSubmitConsumed,
  onWorkspaceRefreshRequested,
  onChatChanged,
  children,
}: {
  projectId: string;
  chatId: string;
  context?: ProjectAssistantContextSnapshot | null;
  queuedInitialSubmit?: QueuedInitialSubmit | null;
  onQueuedInitialSubmitConsumed?: (_id: string) => void;
  onWorkspaceRefreshRequested?: (
    _event: WorkspaceRefreshRequestedEvent | TimelineSelectionUpdatedEvent,
  ) => void;
  onChatChanged: () => void;
  children: ReactNode;
}) {
  const chatState = useChatPathState(projectId, chatId);
  const [selectedConnectionId, setSelectedConnectionId] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");
  const pendingActiveToolsRef = useRef<ProjectAssistantToolName[]>([]);
  const [isSavingModel, setIsSavingModel] = useState(false);
  const submittedQueuedIdRef = useRef<string | null>(null);
  const transport = useMemo(
    () =>
      new ProjectChatTransport({
        projectId,
        chatId,
        getContext: () => context ?? null,
        getActiveTools: () => pendingActiveToolsRef.current,
      }),
    [chatId, context, projectId],
  );
  const { messages, sendMessage, addToolOutput, setMessages, status, stop } =
    useChat<ProjectChatMessage>({
      id: chatId,
      transport,
      onData: (part) => {
        if (part.type === "data-workspace-refresh-requested") {
          onWorkspaceRefreshRequested?.(part.data as WorkspaceRefreshRequestedEvent);
        }
        if (part.type === "data-timeline-selection-updated") {
          onWorkspaceRefreshRequested?.(part.data as TimelineSelectionUpdatedEvent);
        }
      },
      onFinish: () => {
        void chatState.reload().then(() => {
          pendingActiveToolsRef.current = [];
          onChatChanged();
        });
      },
      sendAutomaticallyWhen: ({ messages: chatMessages }) =>
        lastAssistantMessageIsCompleteWithToolCalls({ messages: chatMessages }) ||
        lastAssistantMessageIsCompleteWithApprovalResponses({ messages: chatMessages }),
    });

  const detailQuery = rpc.useQuery("ai.chats.getDetail", { projectId, chatId });
  const updateChatMutation = rpc.useMutation("ai.chats.update");
  const setModelConfigMutation = rpc.useMutation("ai.chats.setModelConfig");

  useEffect(() => {
    setMessages(chatState.visibleMessages as ProjectChatMessage[]);
  }, [chatState.visibleMessages, setMessages]);

  useEffect(() => {
    const chat = detailQuery.data?.chat;
    if (chat) {
      setSelectedConnectionId(chat.modelConfig.connectionId);
      setSelectedModelId(chat.modelConfig.modelId);
    }
  }, [detailQuery.data]);

  useEffect(() => {
    if (
      !queuedInitialSubmit ||
      chatState.isLoading ||
      queuedInitialSubmit.chatId !== chatId ||
      submittedQueuedIdRef.current === queuedInitialSubmit.id
    ) {
      return;
    }

    submittedQueuedIdRef.current = queuedInitialSubmit.id;
    pendingActiveToolsRef.current = queuedInitialSubmit.activeTools;
    void sendMessage({
      text: queuedInitialSubmit.payload.text,
      metadata: {
        mentions: queuedInitialSubmit.payload.mentions,
      },
    });
    onQueuedInitialSubmitConsumed?.(queuedInitialSubmit.id);
  }, [
    chatId,
    chatState.isLoading,
    onQueuedInitialSubmitConsumed,
    queuedInitialSubmit,
    sendMessage,
  ]);

  const commitModelSelection = useCallback(
    (connectionId: string, modelId: string) => {
      setSelectedConnectionId(connectionId);
      setSelectedModelId(modelId);
      setIsSavingModel(true);
      void Promise.all([
        updateChatMutation.mutateAsync({
          projectId,
          chatId,
          modelConfig: {
            connectionId,
            modelId,
          },
        }),
        setModelConfigMutation.mutateAsync({
          projectId,
          modelConfig: {
            connectionId,
            modelId,
          },
        }),
      ]).finally(() => {
        setIsSavingModel(false);
        onChatChanged();
      });
    },
    [chatId, onChatChanged, projectId, updateChatMutation, setModelConfigMutation],
  );

  const selectBranch = useCallback(
    (parentMessageId: string | null, childMessageId: string) => {
      void chatState.selectChild(parentMessageId, childMessageId).then((visibleMessages) => {
        setMessages(visibleMessages as ProjectChatMessage[]);
      });
    },
    [chatState, setMessages],
  );

  const submitAskUser = useCallback(
    (
      toolCallId: string,
      request: {
        title?: string;
        questions: AssistantAskUserQuestion[];
      },
      answers: AssistantAskUserAnswer[],
    ) => {
      void addToolOutput({
        tool: "ask_user" as never,
        toolCallId,
        output: {
          ok: true,
          truncated: false,
          data: {
            request,
            answers,
          },
        } as never,
      });
    },
    [addToolOutput],
  );

  const submitComposer = useCallback(
    (payload: AssistantComposerSubmitPayload, activeTools: ProjectAssistantToolName[]) => {
      pendingActiveToolsRef.current = activeTools;
      void sendMessage({
        text: payload.text,
        metadata: {
          mentions: payload.mentions,
        },
      });
    },
    [sendMessage],
  );

  const abortMutation = rpc.useMutation("ai.chats.abort");
  const abortStream = useCallback(async () => {
    const result = await abortMutation.mutateAsync({ projectId, chatId });
    if (result.success) {
      stop();
    }
    return result.success;
  }, [projectId, chatId, abortMutation, stop]);

  const resumeStream = useCallback(() => {
    // Find the last incomplete assistant message
    const lastMessage = messages[messages.length - 1];
    if (lastMessage && lastMessage.role === "assistant") {
      // Check if the message is incomplete (has incomplete parts)
      const hasIncompletePart = lastMessage.parts.some(
        (part) =>
          (part.type === "text" || part.type === "reasoning") &&
          (part.state === "streaming" || part.state === undefined),
      );
      if (hasIncompletePart) {
        // Resume by sending the message again - useChat will handle the resume
        void sendMessage({
          text: "",
          metadata: {
            mentions: [],
          },
        });
      }
    }
  }, [messages, sendMessage]);

  const value = useMemo<ActiveChatControllerValue>(
    () => ({
      chatId,
      messages,
      allMessages: chatState.allMessages,
      candidateGroups: chatState.candidateGroups,
      status,
      selectedConnectionId,
      selectedModelId,
      isSavingModel,
      selectBranch,
      submitAskUser,
      submitComposer,
      commitModelSelection,
      abortStream,
      resumeStream,
    }),
    [
      chatState.allMessages,
      chatState.candidateGroups,
      chatId,
      commitModelSelection,
      isSavingModel,
      messages,
      selectBranch,
      selectedConnectionId,
      selectedModelId,
      status,
      submitAskUser,
      submitComposer,
      abortStream,
      resumeStream,
    ],
  );

  return (
    <ActiveChatControllerContext.Provider value={value}>
      {children}
    </ActiveChatControllerContext.Provider>
  );
}

function useActiveChatController() {
  const value = useContext(ActiveChatControllerContext);
  if (!value) {
    throw new Error("useActiveChatController must be used within ActiveChatConversationProvider");
  }
  return value;
}

function ActiveChatMessagesPane() {
  const controller = useActiveChatController();
  const contentVersion = useMemo(
    () =>
      `${controller.status}:${controller.messages
        .map((message) =>
          [
            message.id,
            message.role,
            message.parts
              .map((part) => {
                if (part.type === "text" || part.type === "reasoning") {
                  return `${part.type}:${part.state}:${part.text.length}`;
                }
                const toolPart = part as {
                  type: string;
                  state?: string;
                  toolCallId?: string;
                };
                return `${toolPart.type}:${toolPart.toolCallId ?? ""}:${toolPart.state ?? ""}`;
              })
              .join(","),
          ].join(":"),
        )
        .join("|")}`,
    [controller.messages, controller.status],
  );
  const autoFollow = useAutoFollowScroll(controller.chatId, contentVersion);

  return (
    <>
      <OverlayScrollbar
        variant="panel"
        viewportRef={autoFollow.viewportRef}
        onViewportScroll={autoFollow.handleViewportScroll}
      >
        <div ref={autoFollow.contentRef}>
          <MessageList
            messages={controller.messages}
            allMessages={controller.allMessages}
            candidateGroups={controller.candidateGroups}
            isStreaming={controller.status === "streaming" || controller.status === "submitted"}
            onSelectBranch={controller.selectBranch}
            onSubmitAskUser={controller.submitAskUser}
          />
        </div>
      </OverlayScrollbar>

      {!autoFollow.shouldAutoFollow && controller.messages.length > 0 ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-3">
          <button
            type="button"
            onClick={autoFollow.resumeAutoFollow}
            className="pointer-events-auto inline-flex h-8 items-center gap-1 rounded-md border border-border bg-sidebar-background px-2.5 text-[11px] text-foreground shadow-sm transition hover:bg-list-hover-background"
          >
            <span className="icon-[material-symbols--south] text-[14px]" />
            <span>跳到最新</span>
          </button>
        </div>
      ) : null}
    </>
  );
}

function ActiveChatComposerPane() {
  const controller = useActiveChatController();
  const isStreaming = controller.status === "streaming" || controller.status === "submitted";

  // Check if the last message is an incomplete assistant message
  const canResume = useMemo(() => {
    if (isStreaming) {
      return false;
    }
    const lastMessage = controller.messages[controller.messages.length - 1];
    if (!lastMessage || lastMessage.role !== "assistant") {
      return false;
    }
    return lastMessage.parts.some(
      (part) =>
        (part.type === "text" || part.type === "reasoning") &&
        (part.state === "streaming" || part.state === undefined),
    );
  }, [controller.messages, isStreaming]);

  return (
    <ChatComposerPane
      selectedConnectionId={controller.selectedConnectionId}
      selectedModelId={controller.selectedModelId}
      isBusy={isStreaming || controller.isSavingModel}
      onSelectionCommit={controller.commitModelSelection}
      onSubmit={controller.submitComposer}
      onAbort={isStreaming ? controller.abortStream : undefined}
      onResume={canResume ? controller.resumeStream : undefined}
    />
  );
}

type NewChatComposerPaneProps = {
  projectId: string;
  createChat: (_options?: {
    title?: string;
    modelConfig?: ProjectChatModelConfig;
  }) => Promise<ProjectChatInfo>;
  isMutating: boolean;
  onChatCreated: (
    _chat: ProjectChatInfo,
    _queuedSubmit: Omit<QueuedInitialSubmit, "chatId">,
  ) => void;
};

function NewChatComposerPane({
  projectId,
  createChat,
  isMutating,
  onChatCreated,
}: NewChatComposerPaneProps) {
  const [selectedConnectionId, setSelectedConnectionId] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [isSavingModel, setIsSavingModel] = useState(false);

  const modelConfigQuery = rpc.useQuery("ai.chats.getModelConfig", { projectId });
  const setModelConfigMutation = rpc.useMutation("ai.chats.setModelConfig");

  useEffect(() => {
    const modelConfig = modelConfigQuery.data;
    if (modelConfig) {
      setSelectedConnectionId(modelConfig.connectionId);
      setSelectedModelId(modelConfig.modelId);
    }
  }, [modelConfigQuery.data]);

  const commitModelSelection = useCallback(
    (connectionId: string, modelId: string) => {
      setSelectedConnectionId(connectionId);
      setSelectedModelId(modelId);
      setIsSavingModel(true);
      void setModelConfigMutation
        .mutateAsync({
          projectId,
          modelConfig: {
            connectionId,
            modelId,
          },
        })
        .finally(() => {
          setIsSavingModel(false);
        });
    },
    [projectId, setModelConfigMutation],
  );

  const submitComposer = useCallback(
    (payload: AssistantComposerSubmitPayload, activeTools: ProjectAssistantToolName[]) => {
      if (!selectedConnectionId || !selectedModelId) {
        return;
      }

      void createChat({
        title: deriveProjectChatTitleFromText(payload.text) ?? undefined,
        modelConfig: {
          connectionId: selectedConnectionId,
          modelId: selectedModelId,
        },
      }).then((chat) => {
        onChatCreated(chat, {
          id: createId("queued_chat_submit"),
          payload,
          activeTools,
        });
      });
    },
    [createChat, onChatCreated, selectedConnectionId, selectedModelId],
  );

  return (
    <ChatComposerPane
      selectedConnectionId={selectedConnectionId}
      selectedModelId={selectedModelId}
      isBusy={isMutating || isSavingModel}
      onSelectionCommit={commitModelSelection}
      onSubmit={submitComposer}
    />
  );
}

export function AiSidebar({
  projectId,
  context,
  onWorkspaceRefreshRequested,
}: {
  projectId: string;
  context?: ProjectAssistantContextSnapshot | null;
  onWorkspaceRefreshRequested?: (
    _event: WorkspaceRefreshRequestedEvent | TimelineSelectionUpdatedEvent,
  ) => void;
}) {
  const layout = useAssistantSheetLayout({
    defaultState: "peek",
  });
  const chats = useProjectChats(projectId);
  const { chats: chatRows, createChat, isLoading, isMutating } = chats;
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [isComposingNewChat, setIsComposingNewChat] = useState(false);
  const [pendingInitialSubmit, setPendingInitialSubmit] = useState<QueuedInitialSubmit | null>(
    null,
  );
  const visibleChatIds = useMemo(() => chatRows.map((chat) => chat.id), [chatRows]);
  const shouldShowNewChatComposer = !activeChatId || isComposingNewChat;

  useEffect(() => {
    if (isLoading || isMutating || isComposingNewChat) {
      return;
    }

    const resolved = resolveSidebarActiveChat({
      activeChatId,
      visibleChatIds,
    });

    if (resolved.nextActiveChatId !== activeChatId) {
      setActiveChatId(resolved.nextActiveChatId);
    }
    setIsComposingNewChat(!resolved.nextActiveChatId);
  }, [activeChatId, isComposingNewChat, isLoading, isMutating, visibleChatIds]);

  return (
    <aside className="flex h-full w-96 max-w-[42vw] min-w-72 shrink-0 flex-col overflow-hidden border-l border-border bg-sidebar-background">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-title-bar-background px-3">
        <span className="icon-[material-symbols--smart-toy] text-lg text-accent-foreground" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
          AI 助手
        </span>
        <button
          type="button"
          onClick={() => chats.setShowArchived(!chats.showArchived)}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-foreground-muted transition hover:bg-list-hover-background hover:text-foreground"
        >
          <span
            className={
              chats.showArchived
                ? "icon-[material-symbols--inventory-2]"
                : "icon-[material-symbols--inventory-2-outline]"
            }
          />
          <span>{chats.showArchived ? "隐藏归档" : "显示归档"}</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveChatId(null);
            setIsComposingNewChat(true);
          }}
          disabled={isMutating || shouldShowNewChatComposer}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-foreground-muted transition hover:bg-list-hover-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="icon-[material-symbols--add]" />
          <span>新建会话</span>
        </button>
      </div>

      <div
        ref={layout.bodyFrameRef}
        className="flex min-h-0 flex-1 flex-col overflow-hidden bg-editor-background"
      >
        <div
          style={{ height: `${layout.sessionSectionHeight}px` }}
          className={`min-h-0 shrink-0 overflow-hidden ${layout.sectionHeightTransitionClass}`}
        >
          <OverlayScrollbar variant="panel">
            <SessionList
              chats={chatRows}
              activeChatId={shouldShowNewChatComposer ? null : activeChatId}
              showArchived={chats.showArchived}
              onActivate={(chatId) => {
                setIsComposingNewChat(false);
                setActiveChatId(chatId);
                if (layout.sheetState === "expanded") {
                  layout.setSheetState("peek");
                }
              }}
              onArchiveToggle={(chatId, archived) => {
                void chats.archiveChat(chatId, archived).then(() => {
                  if (activeChatId === chatId && archived) {
                    const nextChatId = chatRows.find((chat) => chat.id !== chatId)?.id ?? null;
                    setActiveChatId(nextChatId);
                    setIsComposingNewChat(!nextChatId);
                  }
                });
              }}
              isMutating={isMutating}
            />
          </OverlayScrollbar>
        </div>

        <div
          className={`flex min-h-0 flex-1 flex-col overflow-hidden ${
            layout.sessionSectionHeight > 0 ? "border-t border-border" : ""
          }`}
        >
          <div
            aria-label="调整会话列表和消息区域"
            className="flex h-4 shrink-0 cursor-row-resize touch-none items-center justify-center border-b border-border bg-sidebar-background"
            onPointerDown={layout.handleSheetPointerDown}
            onPointerMove={layout.handleSheetPointerMove}
            onPointerUp={layout.handleSheetPointerUp}
            onPointerCancel={layout.handleSheetPointerCancel}
          >
            <span
              className={`h-px w-8 ${
                layout.isDraggingSheet ? "bg-accent-foreground" : "bg-foreground-muted"
              }`}
            />
          </div>

          {activeChatId && !isComposingNewChat ? (
            <ActiveChatConversationProvider
              key={activeChatId}
              projectId={projectId}
              chatId={activeChatId}
              context={context}
              queuedInitialSubmit={pendingInitialSubmit}
              onQueuedInitialSubmitConsumed={(id) => {
                setPendingInitialSubmit((current) => (current?.id === id ? null : current));
              }}
              onWorkspaceRefreshRequested={onWorkspaceRefreshRequested}
              onChatChanged={() => {
                void chats.reload();
              }}
            >
              <div className="relative min-h-0 flex-1 overflow-hidden">
                <ActiveChatMessagesPane />
              </div>
              <div className="shrink-0 border-t border-border">
                <ActiveChatComposerPane />
              </div>
            </ActiveChatConversationProvider>
          ) : isLoading ? (
            <FullPageMessage
              icon="icon-[material-symbols--hourglass-top]"
              title="加载会话中..."
              description=""
            />
          ) : (
            <>
              <div className="min-h-0 flex-1 overflow-hidden">
                <FullPageMessage
                  icon="icon-[material-symbols--edit-square-outline]"
                  title="开始一段新对话"
                  description="输入第一条消息后才会创建会话，并自动使用消息内容作为标题。"
                  embedded
                />
              </div>
              <div className="shrink-0 border-t border-border">
                <NewChatComposerPane
                  projectId={projectId}
                  createChat={createChat}
                  isMutating={isMutating}
                  onChatCreated={(chat, queuedSubmit) => {
                    setPendingInitialSubmit({
                      ...queuedSubmit,
                      chatId: chat.id,
                    });
                    setActiveChatId(chat.id);
                    setIsComposingNewChat(false);
                    void chats.reload();
                  }}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

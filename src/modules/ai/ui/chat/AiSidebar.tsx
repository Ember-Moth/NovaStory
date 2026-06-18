import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useChat } from "@ai-sdk/react";
import {
  lastAssistantMessageIsCompleteWithApprovalResponses,
  lastAssistantMessageIsCompleteWithToolCalls,
} from "ai";

import type { ProjectChatInfo } from "@/modules/ai/domain/project-chat";
import type {
  ProjectAssistantContextSnapshot,
  ProjectAssistantToolName,
  TimelineSelectionUpdatedEvent,
  WorkspaceRefreshRequestedEvent,
} from "@/modules/ai/domain/types";
import { FullPageMessage } from "@/shared/ui/FullPageMessage";
import { OverlayScrollbar } from "@/shared/ui/OverlayScrollbar";

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
import { useChatPathState } from "./hooks/useChatPathState";
import { ProjectChatTransport } from "./transport/ProjectChatTransport";
import type { ProjectChatMessage } from "./types";

async function requestJson<T>(input: RequestInfo, init?: RequestInit) {
  const response = await fetch(input, init);
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "请求失败。");
  }
  return payload;
}

function useProjectChats(projectId: string) {
  const [chats, setChats] = useState<ProjectChatInfo[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);

  const reload = useCallback(async () => {
    setIsLoading(true);
    const data = await requestJson<{ chats: ProjectChatInfo[] }>(
      `/api/chats?projectId=${projectId}&archived=${showArchived ? "true" : "false"}`,
    );
    setChats(data.chats);
    setIsLoading(false);
    return data.chats;
  }, [projectId, showArchived]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const createChat = useCallback(
    async (modelConfig?: { connectionId: string; modelId: string }) => {
      setIsMutating(true);
      const data = await requestJson<{ chat: ProjectChatInfo }>("/api/chats", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId,
          ...(modelConfig ? { modelConfig } : {}),
        }),
      });
      await reload();
      setIsMutating(false);
      return data.chat;
    },
    [projectId, reload],
  );

  const archiveChat = useCallback(
    async (chatId: string, archived: boolean) => {
      setIsMutating(true);
      await requestJson(`/api/chats/${chatId}/archive`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          projectId,
          archived,
        }),
      });
      await reload();
      setIsMutating(false);
    },
    [projectId, reload],
  );

  return {
    chats,
    showArchived,
    setShowArchived,
    isLoading,
    isMutating,
    reload,
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
}

const ActiveChatControllerContext = createContext<ActiveChatControllerValue | null>(null);

function ActiveChatConversationProvider({
  projectId,
  chatId,
  context,
  onWorkspaceRefreshRequested,
  onChatChanged,
  children,
}: {
  projectId: string;
  chatId: string;
  context?: ProjectAssistantContextSnapshot | null;
  onWorkspaceRefreshRequested?: (
    _event: WorkspaceRefreshRequestedEvent | TimelineSelectionUpdatedEvent,
  ) => void;
  onChatChanged: () => void;
  children: ReactNode;
}) {
  const chatState = useChatPathState(projectId, chatId);
  const [selectedConnectionId, setSelectedConnectionId] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [pendingActiveTools, setPendingActiveTools] = useState<ProjectAssistantToolName[]>([]);
  const [isSavingModel, setIsSavingModel] = useState(false);
  const transport = useMemo(
    () =>
      new ProjectChatTransport({
        projectId,
        chatId,
        getContext: () => context ?? null,
        getActiveTools: () => pendingActiveTools,
      }),
    [chatId, context, pendingActiveTools, projectId],
  );
  const { messages, sendMessage, addToolOutput, setMessages, status } = useChat<ProjectChatMessage>(
    {
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
          setPendingActiveTools([]);
          onChatChanged();
        });
      },
      sendAutomaticallyWhen: ({ messages: chatMessages }) =>
        lastAssistantMessageIsCompleteWithToolCalls({ messages: chatMessages }) ||
        lastAssistantMessageIsCompleteWithApprovalResponses({ messages: chatMessages }),
    },
  );

  useEffect(() => {
    setMessages(chatState.visibleMessages as ProjectChatMessage[]);
  }, [chatState.visibleMessages, setMessages]);

  useEffect(() => {
    void requestJson<{ chat: ProjectChatInfo }>(`/api/chats/${chatId}?projectId=${projectId}`).then(
      (data) => {
        setSelectedConnectionId(data.chat.modelConfig.connectionId);
        setSelectedModelId(data.chat.modelConfig.modelId);
      },
    );
  }, [chatId, projectId]);

  const commitModelSelection = useCallback(
    (connectionId: string, modelId: string) => {
      setSelectedConnectionId(connectionId);
      setSelectedModelId(modelId);
      setIsSavingModel(true);
      void Promise.all([
        requestJson(`/api/chats/${chatId}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            projectId,
            modelConfig: {
              connectionId,
              modelId,
            },
          }),
        }),
        requestJson(`/api/projects/${projectId}/model-config`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            connectionId,
            modelId,
          }),
        }),
      ]).finally(() => {
        setIsSavingModel(false);
        onChatChanged();
      });
    },
    [chatId, onChatChanged, projectId],
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
      setPendingActiveTools(activeTools);
      void sendMessage({
        text: payload.text,
        metadata: {
          mentions: payload.mentions,
        },
      });
    },
    [sendMessage],
  );

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
  return (
    <ChatComposerPane
      selectedConnectionId={controller.selectedConnectionId}
      selectedModelId={controller.selectedModelId}
      isBusy={
        controller.status === "streaming" ||
        controller.status === "submitted" ||
        controller.isSavingModel
      }
      onSelectionCommit={controller.commitModelSelection}
      onSubmit={controller.submitComposer}
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
  const { chats: chatRows, createChat, isLoading, isMutating, showArchived } = chats;
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [hasAutoCreated, setHasAutoCreated] = useState(false);

  useEffect(() => {
    if (activeChatId && chatRows.some((chat) => chat.id === activeChatId)) {
      return;
    }

    if (chatRows[0]) {
      setActiveChatId(chatRows[0].id);
      return;
    }

    if (!isLoading && !isMutating && !showArchived && !hasAutoCreated) {
      setHasAutoCreated(true);
      void createChat().then((chat) => {
        setActiveChatId(chat.id);
      });
    }
  }, [activeChatId, chatRows, createChat, hasAutoCreated, isLoading, isMutating, showArchived]);

  return (
    <aside className="flex h-full w-96 max-w-[42vw] min-w-72 shrink-0 flex-col overflow-hidden border-l border-border bg-sidebar-background">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-title-bar-background px-3">
        <span className="icon-[material-symbols--smart-toy] text-lg text-accent-foreground" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
          AI 助手
        </span>
        <button
          type="button"
          onClick={() =>
            void createChat().then((chat) => {
              setActiveChatId(chat.id);
            })
          }
          disabled={isMutating}
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
              activeChatId={activeChatId}
              showArchived={chats.showArchived}
              onActivate={(chatId) => {
                setActiveChatId(chatId);
                if (layout.sheetState === "expanded") {
                  layout.setSheetState("peek");
                }
              }}
              onCreate={() =>
                void createChat().then((chat) => {
                  setActiveChatId(chat.id);
                })
              }
              onArchiveToggle={(chatId, archived) => {
                void chats.archiveChat(chatId, archived).then(() => {
                  if (activeChatId === chatId && archived) {
                    setActiveChatId(chatRows.find((chat) => chat.id !== chatId)?.id ?? null);
                  }
                });
              }}
              onShowArchivedChange={chats.setShowArchived}
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

          {activeChatId ? (
            <ActiveChatConversationProvider
              key={activeChatId}
              projectId={projectId}
              chatId={activeChatId}
              context={context}
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
            <FullPageMessage
              icon="icon-[material-symbols--chat-bubble-outline]"
              title="暂无会话"
              description="创建会话后即可开始对话。"
            />
          )}
        </div>
      </div>
    </aside>
  );
}

import { AnimatePresence } from "./AiSidebarView";
import {
  AnimatedHeadRow,
  ArchivedSectionToggleRow,
  AttemptErrorCard,
  ModelHint,
  ModelPicker,
  PendingAssistantBubble,
  SessionStatusOverlay,
} from "./AiSidebarView";
import { AiAssistantSheetLayout } from "./AiAssistantSheetLayout";
import { getAttemptErrorMessage, getMessageText } from "./assistantState";
import { useAiAssistantController } from "./useAiAssistantController";
import { useAssistantSheetLayout } from "./useAssistantSheetLayout";

export function AiSidebar({ projectId }: { projectId: string }) {
  const controller = useAiAssistantController(projectId);
  const layout = useAssistantSheetLayout({
    defaultState: "peek",
  });

  return (
    <aside className="flex h-full w-80 max-w-[38vw] min-w-72 shrink-0 flex-col overflow-hidden border-l border-border bg-sidebar-background">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-title-bar-background px-3">
        <span className="icon-[material-symbols--smart-toy] text-lg text-accent-foreground" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
          AI 助手
        </span>
        <button
          type="button"
          onClick={() => void controller.handleCreateSession()}
          disabled={controller.isSessionMutating}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-foreground-muted transition hover:bg-list-hover-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="icon-[material-symbols--add]" />
          <span>新建会话</span>
        </button>
      </div>

      <AiAssistantSheetLayout
        layout={layout}
        sessionPane={
          <>
            <div className="flex min-h-full flex-col">
              <AnimatePresence initial={false} mode="popLayout">
                {controller.sessionRows.map((row) =>
                  row.type === "archived-toggle" ? (
                    <ArchivedSectionToggleRow
                      key={row.key}
                      count={row.count}
                      expanded={controller.showArchivedHeads}
                      onToggle={() =>
                        controller.setShowArchivedHeads((current: boolean) => !current)
                      }
                    />
                  ) : (
                    <AnimatedHeadRow
                      key={row.key}
                      head={row.head}
                      isActive={row.head.id === controller.activeHeadId}
                      isEditing={controller.editingHead?.headId === row.head.id}
                      editingName={
                        controller.editingHead?.headId === row.head.id
                          ? controller.editingHead.name
                          : ""
                      }
                      isBusy={controller.isSessionMutating}
                      className={row.className}
                      onActivate={() => {
                        if (layout.sheetState === "expanded") {
                          layout.setSheetState("peek");
                        }
                        void controller.handleActivateHead(row.head.id);
                      }}
                      onEditingNameChange={(value) =>
                        controller.handleEditingHeadNameChange(row.head.id, value)
                      }
                      onRenameStart={() => controller.handleRenameStart(row.head)}
                      onRenameCancel={controller.handleRenameCancel}
                      onRenameSubmit={() => void controller.handleRenameSubmit()}
                      onArchive={() => void controller.handleArchiveToggle(row.head, true)}
                      onRestore={() => void controller.handleArchiveToggle(row.head, false)}
                    />
                  ),
                )}
              </AnimatePresence>
            </div>
            <AnimatePresence initial={false}>
              {controller.sessionOverlayState ? (
                <SessionStatusOverlay
                  key={controller.sessionOverlayState}
                  state={controller.sessionOverlayState}
                />
              ) : null}
            </AnimatePresence>
          </>
        }
        messagesPane={
          <div className="flex min-h-full flex-col gap-2.5 px-2.5 py-2">
            {controller.assistantStateIsInitialLoading && controller.showEmptyState ? (
              <div className="border border-border bg-sidebar-background px-3 py-2 text-[12px] text-foreground-muted">
                正在加载会话...
              </div>
            ) : null}

            {controller.showEmptyState ? (
              <div className="border border-border bg-sidebar-background px-3 py-2">
                <div className="mb-2 flex items-center gap-2 text-[12px] text-foreground-muted">
                  <span className="icon-[material-symbols--auto-awesome] text-sm text-accent-foreground" />
                  <span>
                    {controller.activeHeadId ? "这个会话还没有对话内容" : "还没有当前会话"}
                  </span>
                </div>
                <p className="text-[12px] leading-5 text-foreground-muted">
                  {controller.activeHeadId
                    ? "选择模型后可以直接开始对话。"
                    : "先新建一个会话，或从上方切换到已有会话。"}
                </p>
              </div>
            ) : null}

            {controller.messages.map((message) => {
              const text = getMessageText(message.content);
              const isUser = message.role === "user";
              const showRetryError = controller.retryableAttempt?.triggerMessageId === message.id;
              const showServerPending = controller.pendingAttempt?.triggerMessageId === message.id;
              const showLocalRetryPending =
                controller.pendingAction?.kind === "retry" &&
                controller.pendingAction.triggerMessageId === message.id;

              return (
                <div key={message.id}>
                  <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[88%] rounded-lg px-3 py-2 text-[13px] leading-5 whitespace-pre-wrap ${
                        isUser
                          ? "bg-accent-foreground text-sidebar-background"
                          : "border border-border bg-sidebar-background text-foreground"
                      }`}
                    >
                      {text || " "}
                    </div>
                  </div>

                  {showRetryError ? (
                    <AttemptErrorCard
                      message={getAttemptErrorMessage(controller.retryableAttempt?.error)}
                      canRetry={!controller.isBusy}
                      isRetrying={controller.isRetrying}
                      onRetry={() => void controller.handleRetry(message.id)}
                    />
                  ) : null}

                  {showServerPending || showLocalRetryPending ? (
                    <div className="mt-2">
                      <PendingAssistantBubble label="正在生成回复..." />
                    </div>
                  ) : null}
                </div>
              );
            })}

            {controller.pendingAction?.kind === "send" ? (
              <>
                <div className="flex justify-end">
                  <div className="max-w-[88%] rounded-lg bg-accent-foreground px-3 py-2 text-[13px] leading-5 whitespace-pre-wrap text-sidebar-background">
                    {controller.pendingAction.text}
                  </div>
                </div>
                <PendingAssistantBubble label="正在生成回复..." />
              </>
            ) : null}
          </div>
        }
        composerPane={
          <form className="shrink-0" aria-label="AI 对话输入" onSubmit={controller.handleSubmit}>
            <div className="space-y-2 p-2">
              <div className="overflow-hidden rounded-lg border border-border bg-editor-background focus-within:border-accent-foreground">
                <textarea
                  value={controller.draft}
                  onChange={(event) => controller.setDraft(event.target.value)}
                  disabled={
                    controller.isLoadingSelection ||
                    !controller.selectedModelId ||
                    !controller.selectedConnectionId ||
                    controller.activeHeadId == null ||
                    controller.isBusy
                  }
                  rows={3}
                  className="min-h-16 w-full resize-none border-none bg-transparent px-2.5 py-2 text-[13px] leading-5 text-editor-foreground outline-none placeholder:text-foreground-muted/70 disabled:cursor-not-allowed disabled:opacity-70"
                  placeholder={
                    controller.isLoadingSelection
                      ? "加载模型选择中..."
                      : controller.activeHeadId == null
                        ? "先新建或切换到一个会话..."
                        : controller.selectedConnectionId && controller.selectedModelId
                          ? "输入消息..."
                          : "选择可用模型后输入..."
                  }
                />
                <div className="flex min-w-0 items-center gap-2 border-t border-border p-1.5">
                  <ModelPicker
                    selectedConnectionId={controller.selectedConnectionId}
                    selectedModelId={controller.selectedModelId}
                    selectionHydrated={controller.selectionHydrated}
                    onSelectionChange={controller.handleSelectionChange}
                    onSelectionCommit={controller.handleSelectionCommit}
                  />
                  <button
                    type="submit"
                    disabled={!controller.canSubmit}
                    title={controller.canSubmit ? "发送" : "当前无法发送"}
                    aria-label="发送"
                    className="flex size-9 shrink-0 items-center justify-center rounded-md text-foreground-muted transition hover:bg-list-hover-background disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <span
                      className={`text-xl ${
                        controller.isBusy
                          ? "icon-[material-symbols--progress-activity] animate-spin"
                          : "icon-[material-symbols--send]"
                      }`}
                    />
                  </button>
                </div>
              </div>

              <div
                className={`flex items-center gap-1.5 text-[11px] ${
                  controller.canSubmit ? "text-foreground-muted" : "text-accent-foreground"
                }`}
              >
                <ModelHint
                  canSend={controller.canSubmit}
                  hasActiveHead={controller.activeHeadId != null}
                  selectedConnectionId={controller.selectedConnectionId}
                  selectedModelId={controller.selectedModelId}
                  hasDraft={controller.hasDraft}
                  isLoadingSelection={controller.isLoadingSelection}
                  isGenerating={controller.isGenerating}
                  isSessionBusy={controller.isSessionBusy}
                  hasPendingAttempt={controller.pendingAttempt != null}
                  errorMessage={controller.composerError}
                />
              </div>
            </div>
          </form>
        }
      />
    </aside>
  );
}

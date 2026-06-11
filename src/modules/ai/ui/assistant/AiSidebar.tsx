import { useEffect, useRef, useState } from "react";

import { AnimatePresence } from "./AiSidebarView";
import { AiMarkdown } from "./AiMarkdown";
import type {
  AgentRunSummaryView,
  ProjectAssistantContextSnapshot,
} from "@/modules/ai/domain/types";
import {
  AnimatedHeadRow,
  ArchivedSectionToggleRow,
  ModelPicker,
  RunSummaryRow,
  SessionStatusOverlay,
} from "./AiSidebarView";
import { AiAssistantSheetLayout } from "./AiAssistantSheetLayout";
import {
  getAssistantContentBlocks,
  getAssistantToolTrace,
  getMessageText,
  getRunSummaryByDisplayNode,
} from "./assistantState";
import { type AssistantStreamOverlay, useAiAssistantController } from "./useAiAssistantController";
import { useAssistantSheetLayout } from "./useAssistantSheetLayout";

export function AiSidebar({
  projectId,
  contextSnapshot,
}: {
  projectId: string;
  contextSnapshot: ProjectAssistantContextSnapshot;
}) {
  const messagesViewportRef = useRef<HTMLElement | null>(null);
  const controller = useAiAssistantController(projectId, contextSnapshot);
  const layout = useAssistantSheetLayout({
    defaultState: "peek",
  });
  const [expandedToolTraceKeys, setExpandedToolTraceKeys] = useState<Set<string>>(new Set());
  const [expandedReasoningKeys, setExpandedReasoningKeys] = useState<Set<string>>(new Set());
  const [expandedRunSummaryKeys, setExpandedRunSummaryKeys] = useState<Set<string>>(new Set());
  const [shouldStickToBottom, setShouldStickToBottom] = useState(true);
  const pendingSendSummary =
    controller.activeStream?.kind === "send"
      ? buildStreamRunSummary(controller.activeStream)
      : null;
  const visibleMessages = controller.messages.flatMap((message, index) =>
    message.role === "tool" ? [] : [{ message, index }],
  );

  useEffect(() => {
    setShouldStickToBottom(true);
  }, [controller.activeThreadId]);

  useEffect(() => {
    if (!shouldStickToBottom) {
      return;
    }

    const viewport = messagesViewportRef.current;
    if (viewport == null) {
      return;
    }

    const frameId = requestAnimationFrame(() => {
      viewport.scrollTop = viewport.scrollHeight;
    });
    return () => cancelAnimationFrame(frameId);
  }, [controller.activeStream, controller.messages, controller.pendingAction, shouldStickToBottom]);

  function toggleToolTrace(key: string) {
    setExpandedToolTraceKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function toggleReasoning(key: string) {
    setExpandedReasoningKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function toggleRunSummary(key: string) {
    setExpandedRunSummaryKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function handleMessagesScroll() {
    const viewport = messagesViewportRef.current;
    if (viewport == null) {
      return;
    }

    setShouldStickToBottom((current) => {
      const next = isViewportNearBottom(viewport);
      return current === next ? current : next;
    });
  }

  return (
    <aside className="flex h-full w-96 max-w-[42vw] min-w-72 shrink-0 flex-col overflow-hidden border-l border-border bg-sidebar-background">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-title-bar-background px-3">
        <span className="icon-[material-symbols--smart-toy] text-lg text-accent-foreground" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
          AI 助手
        </span>
        <button
          type="button"
          onClick={() => void controller.handleCreateThread()}
          disabled={controller.isThreadMutating}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-foreground-muted transition hover:bg-list-hover-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="icon-[material-symbols--add]" />
          <span>新建会话</span>
        </button>
      </div>

      <AiAssistantSheetLayout
        layout={layout}
        messagesViewportRef={messagesViewportRef}
        onMessagesScroll={handleMessagesScroll}
        sessionPane={
          <>
            <div className="flex min-h-full flex-col">
              <AnimatePresence initial={false} mode="popLayout">
                {controller.sessionRows.map((row) =>
                  row.type === "archived-toggle" ? (
                    <ArchivedSectionToggleRow
                      key={row.key}
                      count={row.count}
                      expanded={controller.showArchivedThreads}
                      onToggle={() =>
                        controller.setShowArchivedThreads((current: boolean) => !current)
                      }
                    />
                  ) : (
                    <AnimatedHeadRow
                      key={row.key}
                      thread={row.thread}
                      isActive={row.thread.id === controller.activeThreadId}
                      isEditing={controller.editingThread?.threadId === row.thread.id}
                      editingName={
                        controller.editingThread?.threadId === row.thread.id
                          ? controller.editingThread.title
                          : ""
                      }
                      isBusy={controller.isThreadMutating}
                      className={row.className}
                      onActivate={() => {
                        if (layout.sheetState === "expanded") {
                          layout.setSheetState("peek");
                        }
                        void controller.handleActivateThread(row.thread.id);
                      }}
                      onEditingNameChange={(value) =>
                        controller.handleEditingThreadTitleChange(row.thread.id, value)
                      }
                      onRenameStart={() => controller.handleRenameStart(row.thread)}
                      onRenameCancel={controller.handleRenameCancel}
                      onRenameSubmit={() => void controller.handleRenameSubmit()}
                      onArchive={() => void controller.handleArchiveToggle(row.thread, true)}
                      onRestore={() => void controller.handleArchiveToggle(row.thread, false)}
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
          <div className="flex min-h-full flex-col gap-2 px-3.5 py-2">
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
                    {controller.activeThreadId ? "这个会话还没有对话内容" : "还没有当前会话"}
                  </span>
                </div>
                <p className="text-[12px] leading-5 text-foreground-muted">
                  {controller.activeThreadId
                    ? "选择模型后可以直接开始对话。"
                    : "先新建一个会话，或从上方切换到已有会话。"}
                </p>
              </div>
            ) : null}

            {visibleMessages.map(({ message, index }) => {
              const text = getMessageText(message);
              const assistantContentBlocks = getAssistantContentBlocks(message);
              const toolTrace = getAssistantToolTrace(controller.messages, index);
              const isUser = message.role === "user";
              const showMessageBubble = isUser || text.trim().length > 0;
              const candidateGroup = controller.getCandidateGroupForNode(message);
              const streamOverlayForMessage =
                controller.activeStream?.kind === "retry" &&
                controller.activeStream.triggerNodeId === message.id
                  ? controller.activeStream
                  : null;
              const streamSummaryForMessage =
                streamOverlayForMessage != null
                  ? buildStreamRunSummary(streamOverlayForMessage)
                  : null;
              const persistedSummaries = getRunSummaryByDisplayNode(
                controller.runSummaries,
                message.id,
              ).filter((summary) => summary.runId !== controller.activeStream?.runId);

              return (
                <div key={message.id} className="flex flex-col gap-1.5">
                  {isUser ? (
                    showMessageBubble ? (
                      <div className="flex justify-end">
                        <div className="max-w-[88%] rounded-lg bg-accent-foreground px-3 py-2 text-[13px] leading-5 whitespace-pre-wrap text-sidebar-background">
                          {text}
                        </div>
                      </div>
                    ) : null
                  ) : null}

                  {!isUser
                    ? assistantContentBlocks.map((block) =>
                        block.kind === "text" ? (
                          <div key={block.blockId} className="text-foreground">
                            <AiMarkdown
                              content={block.text}
                              isStreaming={false}
                              variant="assistant"
                            />
                          </div>
                        ) : (
                          <ReasoningTraceCard
                            key={block.blockId}
                            reasoningText={block.text}
                            isStreaming={false}
                            expanded={expandedReasoningKeys.has(`${message.id}:${block.blockId}`)}
                            onToggle={() => toggleReasoning(`${message.id}:${block.blockId}`)}
                          />
                        ),
                      )
                    : null}

                  {streamOverlayForMessage ? (
                    <div className="flex flex-col gap-1.5">
                      {streamOverlayForMessage.blocks.map((block, blockIndex) => (
                        <div
                          key={`${message.id}:stream-block:${block.assistantNodeId}:${blockIndex}`}
                          className="flex flex-col gap-1.5"
                        >
                          {block.contentOrder.map((entry) =>
                            entry.kind === "text" ? (
                              block.assistantText.trim().length > 0 ? (
                                <div
                                  key={`${message.id}:stream:${block.assistantNodeId}:text`}
                                  className="text-foreground"
                                >
                                  <AiMarkdown
                                    content={block.assistantText}
                                    isStreaming
                                    variant="assistant"
                                  />
                                </div>
                              ) : null
                            ) : (
                              <ReasoningTraceCard
                                key={`${message.id}:stream:${block.assistantNodeId}:${entry.id}`}
                                reasoningText={getReasoningTraceText(
                                  block.reasoningTrace,
                                  entry.id,
                                )}
                                isStreaming
                                expanded={expandedReasoningKeys.has(
                                  `${message.id}:stream:${block.assistantNodeId}:${entry.id}`,
                                )}
                                onToggle={() =>
                                  toggleReasoning(
                                    `${message.id}:stream:${block.assistantNodeId}:${entry.id}`,
                                  )
                                }
                              />
                            ),
                          )}
                          {block.toolTrace.length > 0 ? (
                            <div className="flex flex-col gap-1">
                              {block.toolTrace.map((entry, entryIndex) => (
                                <ToolTraceCard
                                  key={`${message.id}:stream:${block.assistantNodeId}:${entry.toolCallId ?? entry.toolName}:${entryIndex}`}
                                  entry={entry}
                                  expanded={expandedToolTraceKeys.has(
                                    `${message.id}:stream:${block.assistantNodeId}:${entry.toolCallId ?? entry.toolName}:${entryIndex}`,
                                  )}
                                  onToggle={() =>
                                    toggleToolTrace(
                                      `${message.id}:stream:${block.assistantNodeId}:${entry.toolCallId ?? entry.toolName}:${entryIndex}`,
                                    )
                                  }
                                />
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {!isUser && toolTrace.length > 0 ? (
                    <div className="flex flex-col gap-1">
                      {toolTrace.map((entry, index) => (
                        <ToolTraceCard
                          key={`${message.id}:${entry.toolCallId ?? entry.toolName}:${index}`}
                          entry={entry}
                          expanded={expandedToolTraceKeys.has(
                            `${message.id}:${entry.toolCallId ?? entry.toolName}:${index}`,
                          )}
                          onToggle={() =>
                            toggleToolTrace(
                              `${message.id}:${entry.toolCallId ?? entry.toolName}:${index}`,
                            )
                          }
                        />
                      ))}
                    </div>
                  ) : null}

                  {candidateGroup ? (
                    <div className="flex items-center gap-1.5">
                      {candidateGroup.nodes.map((candidate, index) => {
                        const active = candidate.id === candidateGroup.activeNodeId;
                        return (
                          <button
                            key={candidate.id}
                            type="button"
                            disabled={active || controller.isThreadBusy}
                            onClick={() =>
                              void controller.handleSelectCandidate(candidate.tipNodeId)
                            }
                            className={`rounded-md border px-2 py-1 text-[11px] leading-4 ${
                              active
                                ? "border-accent-foreground bg-accent-foreground/10 text-accent-foreground"
                                : "border-border bg-editor-background text-foreground-muted hover:text-foreground"
                            }`}
                          >
                            候选 {index + 1}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}

                  {streamSummaryForMessage ? (
                    <RunSummaryRow
                      status={streamSummaryForMessage.status}
                      stepCount={streamSummaryForMessage.stepCount}
                      totalTokens={streamSummaryForMessage.totalTokens}
                      durationMs={streamSummaryForMessage.durationMs}
                      errorMessage={streamSummaryForMessage.errorMessage}
                      expanded={expandedRunSummaryKeys.has(streamSummaryForMessage.key)}
                      onToggle={() => toggleRunSummary(streamSummaryForMessage.key)}
                    />
                  ) : null}

                  {persistedSummaries.map((summary) => {
                    const key = getRunSummaryKey(summary);
                    const retryTriggerNodeId = summary.triggerNodeId;
                    const canRetry =
                      summary.status === "failed" &&
                      controller.retryableRun?.id === summary.runId &&
                      message.id === summary.displayNodeId;
                    return (
                      <RunSummaryRow
                        key={summary.runId}
                        status={summary.status}
                        stepCount={summary.stepCount}
                        totalTokens={summary.totalTokens}
                        durationMs={summary.durationMs}
                        errorMessage={summary.errorMessage}
                        canRetry={canRetry}
                        isRetrying={canRetry && controller.isRetrying}
                        onRetry={
                          canRetry && retryTriggerNodeId
                            ? () => void controller.handleRetry(retryTriggerNodeId)
                            : undefined
                        }
                        expanded={expandedRunSummaryKeys.has(key)}
                        onToggle={() => toggleRunSummary(key)}
                      />
                    );
                  })}
                </div>
              );
            })}

            {controller.pendingAction?.kind === "send" ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-end">
                  <div className="max-w-[88%] rounded-lg bg-accent-foreground px-3 py-2 text-[13px] leading-5 whitespace-pre-wrap text-sidebar-background">
                    {controller.pendingAction.text}
                  </div>
                </div>
                {controller.activeStream?.kind === "send"
                  ? controller.activeStream.blocks.map((block, blockIndex) => (
                      <div
                        key={`send-stream-block:${block.assistantNodeId}:${blockIndex}`}
                        className="flex flex-col gap-1.5"
                      >
                        {block.contentOrder.map((entry) =>
                          entry.kind === "text" ? (
                            block.assistantText.trim().length > 0 ? (
                              <div
                                key={`send-stream:${block.assistantNodeId}:text`}
                                className="text-foreground"
                              >
                                <AiMarkdown
                                  content={block.assistantText}
                                  isStreaming
                                  variant="assistant"
                                />
                              </div>
                            ) : null
                          ) : (
                            <ReasoningTraceCard
                              key={`send-stream:${block.assistantNodeId}:${entry.id}`}
                              reasoningText={getReasoningTraceText(block.reasoningTrace, entry.id)}
                              isStreaming
                              expanded={expandedReasoningKeys.has(
                                `send-stream:${block.assistantNodeId}:${entry.id}`,
                              )}
                              onToggle={() =>
                                toggleReasoning(`send-stream:${block.assistantNodeId}:${entry.id}`)
                              }
                            />
                          ),
                        )}
                        {block.toolTrace.length > 0 ? (
                          <div className="flex flex-col gap-1">
                            {block.toolTrace.map((entry, index) => (
                              <ToolTraceCard
                                key={`send-stream:${block.assistantNodeId}:${entry.toolCallId ?? entry.toolName}:${index}`}
                                entry={entry}
                                expanded={expandedToolTraceKeys.has(
                                  `send-stream:${block.assistantNodeId}:${entry.toolCallId ?? entry.toolName}:${index}`,
                                )}
                                onToggle={() =>
                                  toggleToolTrace(
                                    `send-stream:${block.assistantNodeId}:${entry.toolCallId ?? entry.toolName}:${index}`,
                                  )
                                }
                              />
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))
                  : null}
                {pendingSendSummary ? (
                  <RunSummaryRow
                    status={pendingSendSummary.status}
                    stepCount={pendingSendSummary.stepCount}
                    totalTokens={pendingSendSummary.totalTokens}
                    durationMs={pendingSendSummary.durationMs}
                    errorMessage={pendingSendSummary.errorMessage}
                    expanded={expandedRunSummaryKeys.has(pendingSendSummary.key)}
                    onToggle={() => toggleRunSummary(pendingSendSummary.key)}
                  />
                ) : null}
              </div>
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
                    controller.activeThreadId == null ||
                    controller.isBusy
                  }
                  rows={3}
                  className="field-sizing-content w-full resize-none border-none bg-transparent px-2.5 pt-2 text-[13px] leading-5 text-editor-foreground outline-none placeholder:text-foreground-muted/70 disabled:cursor-not-allowed disabled:opacity-70"
                  placeholder={
                    controller.isLoadingSelection
                      ? "加载模型选择中..."
                      : controller.activeThreadId == null
                        ? "先新建或切换到一个会话..."
                        : controller.selectedConnectionId && controller.selectedModelId
                          ? "输入消息..."
                          : "选择可用模型后输入..."
                  }
                />
                <div className="flex min-w-0 items-center gap-2 px-1.5 pb-1.5">
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
                    className={`flex size-7 shrink-0 items-center justify-center rounded-md transition disabled:cursor-not-allowed ${
                      controller.canSubmit
                        ? "bg-accent-foreground text-sidebar-background hover:brightness-110"
                        : "text-foreground-muted hover:bg-list-hover-background"
                    }`}
                  >
                    <span
                      className={`text-base ${
                        controller.isBusy
                          ? "icon-[material-symbols--progress-activity] animate-spin"
                          : "icon-[material-symbols--arrow-upward]"
                      }`}
                    />
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-1.5 text-[11px] text-foreground-muted">
                <button
                  type="button"
                  onClick={() => controller.setIncludeContext((current) => !current)}
                  className={`inline-flex items-center gap-1 rounded border px-1.5 py-px text-[10px] leading-4 transition ${
                    controller.includeContext
                      ? "border-border bg-editor-background text-foreground"
                      : "border-border/50 bg-editor-background/50 text-foreground-muted/60"
                  }`}
                >
                  <span
                    className={`shrink-0 text-[12px] ${
                      controller.includeContext
                        ? "icon-[material-symbols--my-location] text-accent-foreground"
                        : "icon-[material-symbols--my-location-outline] text-foreground-muted/60"
                    }`}
                  />
                  <span>当前上下文</span>
                </button>
              </div>
            </div>
          </form>
        }
      />
    </aside>
  );
}

function isViewportNearBottom(viewport: HTMLElement) {
  return viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 24;
}

function buildStreamRunSummary(overlay: AssistantStreamOverlay) {
  return {
    key: overlay.runId ? `stream:${overlay.runId}` : `stream:${overlay.kind}:${overlay.threadId}`,
    status: overlay.status,
    stepCount: overlay.stepCount,
    totalTokens: overlay.totalTokens,
    durationMs: Math.max(0, (overlay.completedAt ?? Date.now()) - overlay.startedAt),
    errorMessage: overlay.errorMessage,
  };
}

function getRunSummaryKey(summary: AgentRunSummaryView) {
  return `run-summary:${summary.runId}`;
}

function getReasoningTraceText(
  entries: Array<{ reasoningId: string; text: string }>,
  reasoningId: string,
) {
  const matchedEntry = entries.find((entry) => entry.reasoningId === reasoningId);
  return matchedEntry?.text ?? "";
}

function ReasoningTraceCard({
  reasoningText,
  isStreaming,
  expanded,
  onToggle,
}: {
  reasoningText: string;
  isStreaming: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-border bg-editor-background text-foreground-muted">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] leading-4"
      >
        <span className="icon-[material-symbols--psychology-alt-outline] shrink-0 text-[13px]" />
        <span className="min-w-0 flex-1 truncate">思考过程</span>
        <span
          className={`shrink-0 text-[14px] ${
            expanded
              ? "icon-[material-symbols--keyboard-arrow-up]"
              : "icon-[material-symbols--keyboard-arrow-down]"
          }`}
        />
      </button>

      {expanded ? (
        <div className="border-t border-current/10 px-2 py-1.5">
          <AiMarkdown content={reasoningText} isStreaming={isStreaming} variant="reasoning" />
        </div>
      ) : null}
    </div>
  );
}

function ToolTraceCard({
  entry,
  expanded,
  onToggle,
}: {
  entry: ReturnType<typeof getAssistantToolTrace>[number];
  expanded: boolean;
  onToggle: () => void;
}) {
  const hasDetails = entry.requestPayload != null || entry.responsePayload != null;
  const statusLabel =
    entry.status === "error" ? "失败" : entry.status === "success" ? "已返回" : "处理中";
  const toneClassName =
    entry.status === "error"
      ? "border-accent-foreground/30 bg-accent-foreground/5 text-accent-foreground"
      : "border-border bg-editor-background text-foreground-muted";

  return (
    <div className={`overflow-hidden rounded-md border ${toneClassName}`}>
      <button
        type="button"
        disabled={!hasDetails}
        onClick={hasDetails ? onToggle : undefined}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] leading-4 disabled:cursor-default"
      >
        <span className="icon-[material-symbols--build-outline] shrink-0 text-[13px]" />
        <span className="min-w-0 flex-1 truncate">{entry.toolName}</span>
        <span className="shrink-0 text-[10px] tracking-[0.08em] uppercase opacity-70">
          {statusLabel}
        </span>
        {hasDetails ? (
          <span
            className={`shrink-0 text-[14px] ${
              expanded
                ? "icon-[material-symbols--keyboard-arrow-up]"
                : "icon-[material-symbols--keyboard-arrow-down]"
            }`}
          />
        ) : null}
      </button>

      {expanded ? (
        <div className="border-t border-current/10 px-2 py-1.5 text-[10px] leading-4">
          {entry.requestPayload != null ? (
            <ToolTracePayload label="请求" payload={entry.requestPayload} />
          ) : null}
          {entry.responsePayload != null ? (
            <ToolTracePayload label="响应" payload={entry.responsePayload} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ToolTracePayload({ label, payload }: { label: string; payload: unknown }) {
  return (
    <div className="space-y-1 pb-1 last:pb-0">
      <div className="text-[10px] font-medium tracking-[0.08em] opacity-70">{label}</div>
      <pre className="overflow-x-auto rounded bg-sidebar-background/70 px-2 py-1 text-[10px] leading-4 break-all whitespace-pre-wrap text-foreground">
        {formatToolTracePayload(payload)}
      </pre>
    </div>
  );
}

function formatToolTracePayload(payload: unknown) {
  if (typeof payload === "string") {
    return payload;
  }
  if (payload == null) {
    return "null";
  }

  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

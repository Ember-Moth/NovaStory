import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

import { OverlayScrollbar } from "@/shared/ui/OverlayScrollbar";

import { shouldAnimateMessageMount } from "../aiSidebarModel";
import { AiMarkdown } from "../AiMarkdown";
import { shouldRenderPendingStreamBlocks } from "../runtime/streamOverlay";
import type { AiAssistantController } from "../runtime/useAiAssistantController";
import { MessageItem } from "./MessageItem";
import { ReasoningTraceCard } from "./ReasoningTraceCard";
import { RunSummaryRow } from "./RunSummaryRow";
import { ToolTraceCard } from "./ToolTraceCard";
import { UserMessageBubble } from "./UserMessageBubble";

function isViewportNearBottom(viewport: HTMLElement) {
  return viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 24;
}

function buildStreamRunSummary(overlay: AiAssistantController["activeStream"]) {
  if (overlay == null) {
    return null;
  }

  return {
    key: overlay.runId ? `stream:${overlay.runId}` : `stream:${overlay.kind}:${overlay.threadId}`,
    status: overlay.status,
    stepCount: overlay.stepCount,
    totalTokens: overlay.totalTokens,
    durationMs: Math.max(0, (overlay.completedAt ?? Date.now()) - overlay.startedAt),
    errorMessage: overlay.errorMessage,
  };
}

function getReasoningTraceText(
  entries: Array<{ reasoningId: string; text: string }>,
  reasoningId: string,
) {
  const matchedEntry = entries.find((entry) => entry.reasoningId === reasoningId);
  return matchedEntry?.text ?? "";
}

export function MessagesPane({
  controller,
  sessionKey,
}: {
  controller: AiAssistantController;
  sessionKey: string;
}) {
  const viewportRef = useRef<HTMLElement | null>(null);
  const [expandedToolTraceKeys, setExpandedToolTraceKeys] = useState<Set<string>>(new Set());
  const [expandedReasoningKeys, setExpandedReasoningKeys] = useState<Set<string>>(new Set());
  const [expandedRunSummaryKeys, setExpandedRunSummaryKeys] = useState<Set<string>>(new Set());
  const [shouldStickToBottom, setShouldStickToBottom] = useState(true);
  const streamedAssistantMessageIdsRef = useRef<Set<string>>(new Set());
  const previousThreadIdRef = useRef(controller.activeThreadId);
  const prevMessagesLengthRef = useRef(controller.messages.length);
  const pendingSendSummary =
    controller.activeStream?.kind === "send" ||
    controller.activeStream?.kind === "continue" ||
    controller.activeStream?.kind === "tool-input"
      ? buildStreamRunSummary(controller.activeStream)
      : null;
  const visibleMessages = controller.messages.flatMap((message, index) =>
    message.role === "tool" ? [] : [{ message, index }],
  );

  useEffect(() => {
    if (previousThreadIdRef.current === controller.activeThreadId) {
      return;
    }

    previousThreadIdRef.current = controller.activeThreadId;
    setShouldStickToBottom(true);
    prevMessagesLengthRef.current = controller.messages.length;
    setExpandedToolTraceKeys(new Set());
    setExpandedReasoningKeys(new Set());
    setExpandedRunSummaryKeys(new Set());
  }, [controller.activeThreadId, controller.messages.length]);

  useEffect(() => {
    streamedAssistantMessageIdsRef.current.clear();
  }, [controller.activeThreadId]);

  useEffect(() => {
    controller.activeStream?.blocks.forEach((block) => {
      streamedAssistantMessageIdsRef.current.add(block.assistantNodeId);
    });
  }, [controller.activeStream]);

  useEffect(() => {
    if (!shouldStickToBottom) {
      return;
    }

    const viewport = viewportRef.current;
    if (viewport == null) {
      return;
    }

    const currentLength = controller.messages.length;
    const prevLength = prevMessagesLengthRef.current;
    prevMessagesLengthRef.current = currentLength;

    const isStreaming = controller.activeStream != null;
    const isSending = controller.pendingAction != null;
    const isMessagesGrowing = currentLength > prevLength;

    if (!isStreaming && !isSending && !isMessagesGrowing) {
      return;
    }

    const frameId = requestAnimationFrame(() => {
      viewport.scrollTop = viewport.scrollHeight;
    });
    return () => cancelAnimationFrame(frameId);
  }, [controller.activeStream, controller.messages, controller.pendingAction, shouldStickToBottom]);

  useLayoutEffect(() => {
    let frameId = 0;
    let cancelled = false;

    const scrollToBottomWhenReady = (attempt: number) => {
      if (cancelled) {
        return;
      }

      const viewport = viewportRef.current;
      if (viewport != null) {
        frameId = requestAnimationFrame(() => {
          viewport.scrollTo({
            behavior: "instant",
            top: viewport.scrollHeight,
          });
        });
        return;
      }

      if (attempt >= 8) {
        return;
      }

      frameId = requestAnimationFrame(() => {
        scrollToBottomWhenReady(attempt + 1);
      });
    };

    scrollToBottomWhenReady(0);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
    };
  }, [sessionKey]);

  const toggleToolTrace = (key: string) =>
    setExpandedToolTraceKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  const toggleReasoning = (key: string) =>
    setExpandedReasoningKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  const toggleRunSummary = (key: string) =>
    setExpandedRunSummaryKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <OverlayScrollbar
        variant="panel"
        viewportRef={viewportRef}
        onViewportScroll={() => {
          const viewport = viewportRef.current;
          if (viewport == null) {
            return;
          }
          setShouldStickToBottom((current) => {
            const next = isViewportNearBottom(viewport);
            return current === next ? current : next;
          });
        }}
      >
        <div className="flex min-h-full flex-col gap-2 px-3.5 py-2 select-text">
          <AnimatePresence initial={false} mode="popLayout">
            {controller.assistantStateIsInitialLoading && controller.showEmptyState ? (
              <motion.div
                key="loading-state"
                className="rounded-md border border-border bg-sidebar-background px-3 py-2 text-[12px] text-foreground-muted"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
              >
                正在加载会话...
              </motion.div>
            ) : null}

            {controller.showEmptyState ? (
              <motion.div
                key="empty-state"
                className="rounded-md border border-border bg-sidebar-background px-3 py-2"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
              >
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
              </motion.div>
            ) : null}

            {visibleMessages.map(({ message, index }) => (
              <MessageItem
                key={message.id}
                controller={controller}
                message={message}
                index={index}
                expandedReasoningKeys={expandedReasoningKeys}
                expandedRunSummaryKeys={expandedRunSummaryKeys}
                expandedToolTraceKeys={expandedToolTraceKeys}
                shouldAnimateMount={shouldAnimateMessageMount(
                  message.role,
                  message.id,
                  streamedAssistantMessageIdsRef.current,
                )}
                onToggleReasoning={toggleReasoning}
                onToggleRunSummary={toggleRunSummary}
                onToggleToolTrace={toggleToolTrace}
              />
            ))}
          </AnimatePresence>

          <AnimatePresence initial={false}>
            {controller.pendingAction?.kind === "send" ||
            controller.pendingAction?.kind === "continue" ||
            controller.pendingAction?.kind === "tool-input" ? (
              <motion.div
                key={
                  controller.pendingAction.kind === "send"
                    ? "pending-send"
                    : controller.pendingAction.kind === "continue"
                      ? "pending-continue"
                      : "pending-tool-input"
                }
                className="flex flex-col gap-1.5"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
              >
                {controller.pendingAction.kind === "send" ? (
                  <div className="flex justify-end">
                    <UserMessageBubble
                      text={controller.pendingAction.text}
                      mentions={controller.pendingAction.mentions}
                    />
                  </div>
                ) : null}
                {shouldRenderPendingStreamBlocks(controller.activeStream)
                  ? controller.activeStream.blocks.map((block, blockIndex) => (
                      <motion.div
                        key={`${controller.activeStream?.kind}-stream-block:${block.assistantNodeId}:${blockIndex}`}
                        className="flex flex-col gap-1.5"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.15, ease: "easeOut" }}
                      >
                        {block.contentOrder.map((entry) =>
                          entry.kind === "text" ? (
                            block.assistantText.trim().length > 0 ? (
                              <div
                                key={`${controller.activeStream?.kind}-stream:${block.assistantNodeId}:text`}
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
                              key={`${controller.activeStream?.kind}-stream:${block.assistantNodeId}:${entry.id}`}
                              reasoningText={getReasoningTraceText(block.reasoningTrace, entry.id)}
                              isStreaming
                              expanded={expandedReasoningKeys.has(
                                `${controller.activeStream?.kind}-stream:${block.assistantNodeId}:${entry.id}`,
                              )}
                              onToggle={() =>
                                toggleReasoning(
                                  `${controller.activeStream?.kind}-stream:${block.assistantNodeId}:${entry.id}`,
                                )
                              }
                            />
                          ),
                        )}
                        {block.toolTrace.length > 0 ? (
                          <div className="flex flex-col gap-1">
                            {block.toolTrace.map((entry, entryIndex) => {
                              const key = `${controller.activeStream?.kind}-stream:${block.assistantNodeId}:${entry.toolCallId ?? entry.toolName}:${entryIndex}`;
                              return (
                                <ToolTraceCard
                                  key={key}
                                  entry={entry}
                                  expanded={expandedToolTraceKeys.has(key)}
                                  onToggle={() => toggleToolTrace(key)}
                                />
                              );
                            })}
                          </div>
                        ) : null}
                      </motion.div>
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
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </OverlayScrollbar>
    </div>
  );
}

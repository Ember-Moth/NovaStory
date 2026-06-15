import { motion } from "motion/react";

import type { AgentRunSummaryView } from "@/modules/ai/domain/types";

import { AiMarkdown } from "../AiMarkdown";
import type { AiAssistantController } from "../runtime/useAiAssistantController";
import { AskUserInlineCard } from "./AskUserInlineCard";
import { getAssistantAskUserEntries } from "./askUserModel";
import {
  getAssistantContentBlocks,
  getAssistantRefDisplays,
  getMessageText,
} from "./messageContentModel";
import { ReasoningTraceCard } from "./ReasoningTraceCard";
import { getRunSummaryByDisplayNode } from "./runSummaryModel";
import { RunSummaryRow } from "./RunSummaryRow";
import { getAssistantToolTrace, type AssistantToolTraceEntry } from "./toolTraceModel";
import { ToolTraceCard } from "./ToolTraceCard";
import { UserMessageBubble } from "./UserMessageBubble";

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

function ToolTraceList({
  entries,
  expandedKeys,
  keyPrefix,
  onToggle,
}: {
  entries: AssistantToolTraceEntry[];
  expandedKeys: ReadonlySet<string>;
  keyPrefix: string;
  onToggle: (_key: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      {entries.map((entry, entryIndex) => {
        const key = `${keyPrefix}:${entry.toolCallId ?? entry.toolName}:${entryIndex}`;
        return (
          <ToolTraceCard
            key={key}
            entry={entry}
            expanded={expandedKeys.has(key)}
            onToggle={() => onToggle(key)}
          />
        );
      })}
    </div>
  );
}

export function MessageItem({
  controller,
  message,
  index,
  expandedReasoningKeys,
  expandedRunSummaryKeys,
  expandedToolTraceKeys,
  shouldAnimateMount,
  onToggleReasoning,
  onToggleRunSummary,
  onToggleToolTrace,
}: {
  controller: AiAssistantController;
  message: AiAssistantController["messages"][number];
  index: number;
  expandedReasoningKeys: ReadonlySet<string>;
  expandedRunSummaryKeys: ReadonlySet<string>;
  expandedToolTraceKeys: ReadonlySet<string>;
  shouldAnimateMount: boolean;
  onToggleReasoning: (_key: string) => void;
  onToggleRunSummary: (_key: string) => void;
  onToggleToolTrace: (_key: string) => void;
}) {
  const text = getMessageText(message);
  const refDisplays = getAssistantRefDisplays(message);
  const assistantContentBlocks = getAssistantContentBlocks(message);
  const askUserEntries = getAssistantAskUserEntries(controller.messages, index);
  const toolTrace = getAssistantToolTrace(controller.messages, index).filter(
    (entry) => entry.toolName !== "ask_user",
  );
  const isUser = message.role === "user";
  const showMessageBubble = isUser || text.trim().length > 0 || refDisplays.length > 0;
  const candidateGroup = controller.getCandidateGroupForNode(message);
  const streamOverlayForMessage =
    controller.activeStream?.kind === "retry" &&
    controller.activeStream.triggerNodeId === message.id
      ? controller.activeStream
      : null;
  const streamSummaryForMessage = buildStreamRunSummary(streamOverlayForMessage);
  const persistedSummaries = getRunSummaryByDisplayNode(controller.runSummaries, message.id).filter(
    (summary) => summary.runId !== controller.activeStream?.runId,
  );

  return (
    <motion.div
      key={message.id}
      className="flex flex-col gap-1.5"
      initial={shouldAnimateMount ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
    >
      {isUser && showMessageBubble ? (
        <div className="flex justify-end">
          <UserMessageBubble text={text} mentions={refDisplays} />
        </div>
      ) : null}

      {!isUser
        ? assistantContentBlocks.map((block) =>
            block.kind === "text" ? (
              <div key={block.blockId} className="text-foreground">
                <AiMarkdown content={block.text} isStreaming={false} variant="assistant" />
              </div>
            ) : (
              <ReasoningTraceCard
                key={block.blockId}
                reasoningText={block.text}
                isStreaming={false}
                expanded={expandedReasoningKeys.has(`${message.id}:${block.blockId}`)}
                onToggle={() => onToggleReasoning(`${message.id}:${block.blockId}`)}
              />
            ),
          )
        : null}

      {!isUser && askUserEntries.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {askUserEntries.map((entry) => {
            const submittedAnswers =
              entry.answers ?? controller.submittedToolInputAnswers[entry.toolCallId] ?? null;
            return (
              <AskUserInlineCard
                key={entry.toolCallId}
                entry={entry}
                submittedAnswers={submittedAnswers}
                isSubmitting={controller.submittingToolInputToolCallId === entry.toolCallId}
                canSubmit={
                  controller.isWaitingForInput &&
                  submittedAnswers == null &&
                  controller.pendingRun?.id != null
                }
                onSubmit={(answers) =>
                  void controller.handleSubmitToolInput(entry.toolCallId, answers)
                }
              />
            );
          })}
        </div>
      ) : null}

      {streamOverlayForMessage ? (
        <div className="flex flex-col gap-1.5">
          {streamOverlayForMessage.blocks.map((block, blockIndex) => (
            <motion.div
              key={`${message.id}:stream-block:${block.assistantNodeId}:${blockIndex}`}
              className="flex flex-col gap-1.5"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
            >
              {block.contentOrder.map((entry) =>
                entry.kind === "text" ? (
                  block.assistantText.trim().length > 0 ? (
                    <div
                      key={`${message.id}:stream:${block.assistantNodeId}:text`}
                      className="text-foreground"
                    >
                      <AiMarkdown content={block.assistantText} isStreaming variant="assistant" />
                    </div>
                  ) : null
                ) : (
                  <ReasoningTraceCard
                    key={`${message.id}:stream:${block.assistantNodeId}:${entry.id}`}
                    reasoningText={getReasoningTraceText(block.reasoningTrace, entry.id)}
                    isStreaming
                    expanded={expandedReasoningKeys.has(
                      `${message.id}:stream:${block.assistantNodeId}:${entry.id}`,
                    )}
                    onToggle={() =>
                      onToggleReasoning(`${message.id}:stream:${block.assistantNodeId}:${entry.id}`)
                    }
                  />
                ),
              )}
              {block.toolTrace.length > 0 ? (
                <ToolTraceList
                  entries={block.toolTrace}
                  expandedKeys={expandedToolTraceKeys}
                  keyPrefix={`${message.id}:stream:${block.assistantNodeId}`}
                  onToggle={onToggleToolTrace}
                />
              ) : null}
            </motion.div>
          ))}
        </div>
      ) : null}

      {!isUser && toolTrace.length > 0 ? (
        <ToolTraceList
          entries={toolTrace}
          expandedKeys={expandedToolTraceKeys}
          keyPrefix={message.id}
          onToggle={onToggleToolTrace}
        />
      ) : null}

      {candidateGroup ? (
        <div className="flex items-center gap-1.5">
          {candidateGroup.nodes.map((candidate, candidateIndex) => {
            const active = candidate.id === candidateGroup.activeNodeId;
            return (
              <motion.button
                key={candidate.id}
                type="button"
                disabled={active || controller.isThreadBusy}
                onClick={() => void controller.handleSelectCandidate(candidate.tipNodeId)}
                className={`rounded-md border px-2 py-1 text-[11px] leading-4 ${
                  active
                    ? "border-accent-foreground bg-accent-foreground/10 text-accent-foreground"
                    : "border-border bg-editor-background text-foreground-muted hover:text-foreground"
                }`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.14, ease: "easeOut" }}
              >
                候选 {candidateIndex + 1}
              </motion.button>
            );
          })}
        </div>
      ) : null}

      {streamSummaryForMessage ? (
        <motion.div
          key={streamSummaryForMessage.key}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
        >
          <RunSummaryRow
            status={streamSummaryForMessage.status}
            stepCount={streamSummaryForMessage.stepCount}
            totalTokens={streamSummaryForMessage.totalTokens}
            durationMs={streamSummaryForMessage.durationMs}
            errorMessage={streamSummaryForMessage.errorMessage}
            expanded={expandedRunSummaryKeys.has(streamSummaryForMessage.key)}
            onToggle={() => onToggleRunSummary(streamSummaryForMessage.key)}
          />
        </motion.div>
      ) : null}

      {persistedSummaries.map((summary) => {
        const key = getRunSummaryKey(summary);
        const retryTriggerNodeId = summary.triggerNodeId;
        const canRetry =
          summary.status === "failed" &&
          controller.retryableRun?.id === summary.runId &&
          message.id === summary.displayNodeId;

        return (
          <motion.div
            key={summary.runId}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
          >
            <RunSummaryRow
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
              needsContinuation={summary.needsContinuation}
              isContinuing={summary.needsContinuation && controller.isContinuing}
              onContinue={
                summary.needsContinuation
                  ? () => void controller.handleContinueRun(summary.runId)
                  : undefined
              }
              continuedByRunId={summary.continuedByRunId}
              expanded={expandedRunSummaryKeys.has(key)}
              onToggle={() => onToggleRunSummary(key)}
            />
          </motion.div>
        );
      })}
    </motion.div>
  );
}

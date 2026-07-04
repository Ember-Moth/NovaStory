import { useMemo, useState } from "react";

import type {
  ProjectChatCandidateGroup,
  StoredProjectChatMessage,
} from "@/modules/ai/domain/project-chat";
import type { AssistantMentionInput } from "@/modules/ai/domain/types";
import { AiMarkdown } from "../assistant/AiMarkdown";
import { AskUserInlineCard } from "../assistant/messages/AskUserInlineCard";
import type {
  AssistantAskUserAnswer,
  AssistantAskUserQuestion,
} from "../assistant/messages/askUserModel";
import { ReasoningTraceCard } from "../assistant/messages/ReasoningTraceCard";
import { ToolTraceCard } from "../assistant/messages/ToolTraceCard";
import {
  type AssistantToolTraceEntry,
  buildAssistantToolTraceSummary,
} from "../assistant/messages/toolTraceModel";
import { UserMessageBubble } from "../assistant/messages/UserMessageBubble";
import { MessageBranchSwitcher } from "./components/MessageBranchSwitcher";
import type { ProjectChatMessage } from "./types";

function getMessageMentions(message: ProjectChatMessage | StoredProjectChatMessage) {
  const metadata =
    message.metadata && typeof message.metadata === "object"
      ? (message.metadata as { mentions?: AssistantMentionInput[] })
      : null;
  return Array.isArray(metadata?.mentions) ? metadata.mentions : [];
}

function getMessageText(message: ProjectChatMessage | StoredProjectChatMessage) {
  const texts: string[] = [];
  message.parts.forEach((part) => {
    if (part.type === "text" && typeof (part as { text?: unknown }).text === "string") {
      texts.push((part as { text: string }).text);
    }
  });
  return texts.join("");
}

function getToolName(part: { type: string; toolName?: string }) {
  if (part.type === "dynamic-tool") {
    return part.toolName ?? "tool";
  }
  return part.type.startsWith("tool-") ? part.type.slice(5) : null;
}

function parseAskUserQuestionWithMode(
  input: unknown,
  mode: "strict" | "streaming",
  index = 0,
): AssistantAskUserQuestion | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const record = input as Record<string, unknown>;
  const id =
    typeof record.id === "string" && record.id.trim().length > 0
      ? record.id
      : mode === "streaming"
        ? `streaming-question-${index}`
        : null;
  const prompt =
    typeof record.prompt === "string" && record.prompt.trim().length > 0
      ? record.prompt
      : mode === "streaming"
        ? "正在生成问题..."
        : null;
  const kind = record.kind;
  if (!id || !prompt) {
    return null;
  }
  if (kind === "free_text") {
    return { id, prompt, kind };
  }
  if (kind !== "single_choice") {
    if (mode === "streaming") {
      return { id, prompt, kind: "free_text" };
    }
    return null;
  }
  if (!Array.isArray(record.options)) {
    return mode === "streaming" ? { id, prompt, kind, options: [] } : null;
  }
  const options = record.options.flatMap((option) => {
    if (!option || typeof option !== "object") {
      return [];
    }
    const optionRecord = option as Record<string, unknown>;
    if (typeof optionRecord.id !== "string" || typeof optionRecord.label !== "string") {
      return [];
    }
    return [
      {
        id: optionRecord.id,
        label: optionRecord.label,
        ...(typeof optionRecord.description === "string"
          ? { description: optionRecord.description }
          : {}),
      },
    ];
  });
  if (mode === "strict" && options.length !== record.options.length) {
    return null;
  }
  return { id, prompt, kind, options };
}

function parseAskUserAnswers(output: unknown): AssistantAskUserAnswer[] | null {
  if (!output || typeof output !== "object") {
    return null;
  }
  const outputRecord = output as Record<string, unknown>;
  const data =
    outputRecord.data && typeof outputRecord.data === "object"
      ? (outputRecord.data as Record<string, unknown>)
      : null;
  if (!data || !Array.isArray(data.answers)) {
    return null;
  }
  const answers: AssistantAskUserAnswer[] = [];
  data.answers.forEach((answer) => {
    if (!answer || typeof answer !== "object") {
      return;
    }
    const record = answer as Record<string, unknown>;
    if (record.type === "single_choice" && typeof record.questionId === "string") {
      if (typeof record.optionId === "string") {
        answers.push({
          questionId: record.questionId,
          type: "single_choice",
          optionId: record.optionId,
        });
        return;
      }
      if (typeof record.text === "string") {
        answers.push({
          questionId: record.questionId,
          type: "single_choice",
          text: record.text,
        });
        return;
      }
    }
    if (
      record.type === "free_text" &&
      typeof record.questionId === "string" &&
      typeof record.text === "string"
    ) {
      answers.push({
        questionId: record.questionId,
        type: "free_text",
        text: record.text,
      });
    }
  });
  return answers;
}

function ToolCard({
  toolName,
  state,
  input,
  output,
  errorText,
}: {
  toolName: string;
  state: string;
  input: unknown;
  output?: unknown;
  errorText?: string;
}) {
  const status =
    errorText || state === "output-error"
      ? ("error" as const)
      : state === "output-available"
        ? ("success" as const)
        : ("pending" as const);
  const responsePayload =
    errorText && output === undefined
      ? {
          ok: false,
          error: errorText,
        }
      : (output ?? null);
  const entry: AssistantToolTraceEntry = {
    toolCallId: null,
    toolName,
    status,
    summary: buildAssistantToolTraceSummary({
      toolName,
      requestPayload: input ?? null,
      responsePayload,
      status,
    }),
    nodeId: `chat-tool:${toolName}`,
    runId: null,
    requestPayload: input ?? null,
    responsePayload,
    streamingInputTextRaw: null,
    streamingRequestPayload: null,
  };

  return <ToolTraceCard entry={entry} expanded forceExpanded hideToggle onToggle={() => {}} />;
}

export function MessageList({
  messages,
  allMessages,
  candidateGroups,
  isStreaming,
  onSelectBranch,
  onSubmitAskUser,
}: {
  messages: ProjectChatMessage[];
  allMessages: StoredProjectChatMessage[];
  candidateGroups: ProjectChatCandidateGroup[];
  isStreaming: boolean;
  onSelectBranch: (_parentMessageId: string | null, _childMessageId: string) => void;
  onSubmitAskUser: (
    _toolCallId: string,
    _request: { title?: string; questions: AssistantAskUserQuestion[] },
    _answers: AssistantAskUserAnswer[],
  ) => void;
}) {
  const [expandedReasoningKeys, setExpandedReasoningKeys] = useState<Set<string>>(new Set());
  const allMessagesById = useMemo(
    () => new Map(allMessages.map((message) => [message.id, message])),
    [allMessages],
  );

  return (
    <div className="flex min-h-full select-text flex-col gap-3 px-3 py-3">
      {messages.length === 0 ? (
        <div className="py-8 text-center text-[12px] text-foreground-muted">开始一段新的对话。</div>
      ) : (
        messages.map((message) => {
          const branchGroup =
            candidateGroups.find((group) => group.activeMessageId === message.id) ??
            candidateGroups.find(
              (group) =>
                group.parentMessageId ===
                (allMessagesById.get(message.id)?.parentMessageId ?? null),
            );
          const currentBranchIndex = branchGroup ? branchGroup.messageIds.indexOf(message.id) : -1;

          return (
            <div key={message.id} className="flex flex-col gap-1.5">
              {message.role === "user" ? (
                <div className="flex justify-end">
                  <UserMessageBubble
                    text={getMessageText(message)}
                    mentions={getMessageMentions(message)}
                  />
                </div>
              ) : (
                message.parts.map((part, index) => {
                  if (part.type === "text") {
                    if (!part.text.trim() && !isStreaming) {
                      return null;
                    }
                    return (
                      <div key={`${message.id}:text:${index}`} className="text-foreground">
                        <AiMarkdown
                          content={part.text}
                          isStreaming={isStreaming && part.state !== "done"}
                          tableLayout="sidebar-cards"
                          variant="assistant"
                        />
                      </div>
                    );
                  }

                  if (part.type === "reasoning") {
                    const key = `${message.id}:reasoning:${index}`;
                    const expanded = expandedReasoningKeys.has(key);
                    return (
                      <ReasoningTraceCard
                        key={key}
                        reasoningText={part.text}
                        isStreaming={isStreaming && part.state !== "done"}
                        expanded={expanded}
                        onToggle={() =>
                          setExpandedReasoningKeys((current) => {
                            const next = new Set(current);
                            if (next.has(key)) {
                              next.delete(key);
                            } else {
                              next.add(key);
                            }
                            return next;
                          })
                        }
                      />
                    );
                  }

                  const toolName = getToolName(part);
                  if (!toolName) {
                    return null;
                  }

                  if (toolName === "ask_user" && "input" in part && part.input) {
                    const questionParseMode =
                      part.state === "input-streaming" ? "streaming" : "strict";
                    const questions = Array.isArray(
                      (part.input as { questions?: unknown[] }).questions,
                    )
                      ? (part.input as { questions: unknown[] }).questions
                          .map((question, questionIndex) =>
                            parseAskUserQuestionWithMode(
                              question,
                              questionParseMode,
                              questionIndex,
                            ),
                          )
                          .filter(
                            (question): question is AssistantAskUserQuestion => question != null,
                          )
                      : [];
                    const request = {
                      ...(typeof (part.input as { title?: unknown }).title === "string"
                        ? { title: (part.input as { title: string }).title }
                        : {}),
                      questions,
                    };
                    const submittedAnswers =
                      part.state === "output-available" ? parseAskUserAnswers(part.output) : null;

                    return questions.length > 0 ? (
                      <AskUserInlineCard
                        key={`${message.id}:ask-user:${part.toolCallId}`}
                        entry={{
                          toolCallId: part.toolCallId,
                          title: request.title ?? null,
                          questions: request.questions,
                          answers: submittedAnswers,
                        }}
                        submittedAnswers={submittedAnswers}
                        isSubmitting={false}
                        canSubmit={part.state === "input-available"}
                        isStreamingInput={part.state === "input-streaming"}
                        onSubmit={(answers) => onSubmitAskUser(part.toolCallId, request, answers)}
                      />
                    ) : part.state === "input-streaming" ? (
                      <AskUserInlineCard
                        key={`${message.id}:ask-user:${part.toolCallId}`}
                        entry={{
                          toolCallId: part.toolCallId,
                          title:
                            typeof (part.input as { title?: unknown }).title === "string"
                              ? (part.input as { title: string }).title
                              : null,
                          questions: [],
                          answers: null,
                        }}
                        submittedAnswers={null}
                        isSubmitting={false}
                        canSubmit={false}
                        isStreamingInput
                        onSubmit={() => {}}
                      />
                    ) : null;
                  }

                  const toolPart = part as any;

                  return (
                    <ToolCard
                      key={`${message.id}:tool:${toolPart.toolCallId}`}
                      toolName={toolName}
                      state={toolPart.state}
                      input={toolPart.input}
                      output={toolPart.output}
                      errorText={toolPart.errorText}
                    />
                  );
                })
              )}

              {branchGroup && currentBranchIndex >= 0 && branchGroup.messageIds.length > 1 ? (
                <MessageBranchSwitcher
                  currentIndex={currentBranchIndex}
                  total={branchGroup.messageIds.length}
                  onSelect={(index) =>
                    onSelectBranch(
                      branchGroup.parentMessageId,
                      branchGroup.messageIds[index] ?? branchGroup.messageIds[0]!,
                    )
                  }
                />
              ) : null}
            </div>
          );
        })
      )}
    </div>
  );
}

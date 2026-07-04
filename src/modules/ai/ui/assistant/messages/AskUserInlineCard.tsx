import { useEffect, useState } from "react";

import { cn } from "@/shared/lib/cn";

import {
  type AssistantAskUserAnswer,
  type AssistantAskUserEntry,
  type AssistantAskUserQuestion,
  formatAskUserAnswer,
} from "./askUserModel";

function indexAskUserAnswers(
  answers: AssistantAskUserAnswer[] | null,
): Record<string, AssistantAskUserAnswer> {
  if (answers == null) {
    return {};
  }
  return Object.fromEntries(answers.map((answer) => [answer.questionId, answer]));
}

function AskUserQuestionBlock({
  question,
  answer,
  resolved,
  streaming,
  onChange,
}: {
  question: AssistantAskUserQuestion;
  answer: AssistantAskUserAnswer | null;
  resolved: boolean;
  streaming: boolean;
  onChange: (_value: string, _mode?: "option" | "text") => void;
}) {
  const showPreview = streaming && !resolved;

  return (
    <section className="py-2.5 first:pt-2 last:pb-2">
      <div className="text-[12px] text-foreground leading-5">{question.prompt}</div>
      {resolved ? (
        <div className="mt-1.5 flex items-start gap-1.5 text-[12px] text-foreground-muted leading-5">
          <span className="icon-[material-symbols--subdirectory-arrow-right] mt-0.5 shrink-0 text-[14px] text-accent-foreground" />
          <span className="wrap-break-word min-w-0 flex-1 whitespace-pre-wrap">
            {formatAskUserAnswer(question, answer)}
          </span>
        </div>
      ) : showPreview ? (
        question.kind === "single_choice" ? (
          <div className="mt-2 flex flex-col gap-1.5">
            {question.options.length > 0 ? (
              question.options.map((option) => (
                <div
                  key={option.id}
                  className="flex items-start gap-2 rounded-md border border-border bg-sidebar-background/35 px-2 py-2 text-[12px] text-foreground-muted leading-5"
                >
                  <span className="icon-[material-symbols--radio-button-unchecked] mt-0.5 shrink-0 text-[16px]" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-foreground">{option.label}</span>
                    {option.description ? (
                      <span className="mt-0.5 block text-[11px] text-foreground-muted leading-4">
                        {option.description}
                      </span>
                    ) : null}
                  </span>
                </div>
              ))
            ) : (
              <div className="space-y-1.5">
                <div className="h-8 rounded-md border border-border/70 bg-sidebar-background/35" />
                <div className="h-8 rounded-md border border-border/50 bg-sidebar-background/20" />
              </div>
            )}
          </div>
        ) : (
          <div className="mt-2 h-16 rounded-md border border-border/70 bg-sidebar-background/30" />
        )
      ) : question.kind === "single_choice" ? (
        <div className="mt-2 flex flex-col gap-1.5">
          {question.options.map((option) => {
            const selected =
              answer?.type === "single_choice" &&
              "optionId" in answer &&
              answer.optionId === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => onChange(option.id, "option")}
                className={`flex items-start gap-2 rounded-md border px-2 py-2 text-left text-[12px] leading-5 transition ${
                  selected
                    ? "border-accent-foreground/40 bg-accent-foreground/10 text-foreground"
                    : "border-border bg-editor-background text-foreground-muted hover:text-foreground"
                }`}
              >
                <span
                  className={`mt-0.5 shrink-0 text-[16px] ${
                    selected
                      ? "icon-[material-symbols--radio-button-checked] text-accent-foreground"
                      : "icon-[material-symbols--radio-button-unchecked]"
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-foreground">{option.label}</span>
                  {option.description ? (
                    <span className="mt-0.5 block text-[11px] text-foreground-muted leading-4">
                      {option.description}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
          <textarea
            value={answer?.type === "single_choice" && "text" in answer ? answer.text : ""}
            onChange={(event) => onChange(event.target.value, "text")}
            rows={2}
            className="mt-1 w-full resize-y rounded-md border border-border bg-editor-background px-2.5 py-2 text-[12px] text-foreground leading-5 outline-none focus:border-accent-foreground"
            placeholder="或输入自定义回答..."
          />
        </div>
      ) : (
        <textarea
          value={answer?.type === "free_text" ? answer.text : ""}
          onChange={(event) => onChange(event.target.value)}
          rows={3}
          className="mt-2 w-full resize-y rounded-md border border-border bg-editor-background px-2.5 py-2 text-[12px] text-foreground leading-5 outline-none focus:border-accent-foreground"
          placeholder="输入回答..."
        />
      )}
    </section>
  );
}

export function AskUserInlineCard({
  entry,
  submittedAnswers,
  isSubmitting,
  canSubmit,
  isStreamingInput = false,
  onSubmit,
}: {
  entry: AssistantAskUserEntry;
  submittedAnswers: AssistantAskUserAnswer[] | null;
  isSubmitting: boolean;
  canSubmit: boolean;
  isStreamingInput?: boolean;
  onSubmit: (_answers: AssistantAskUserAnswer[]) => void;
}) {
  const [draftAnswers, setDraftAnswers] = useState<Record<string, AssistantAskUserAnswer>>(() =>
    indexAskUserAnswers(submittedAnswers),
  );
  const isResolved = submittedAnswers != null;
  const hasQuestions = entry.questions.length > 0;

  useEffect(() => {
    if (submittedAnswers == null) {
      return;
    }
    setDraftAnswers(indexAskUserAnswers(submittedAnswers));
  }, [submittedAnswers]);

  const normalizedAnswers: AssistantAskUserAnswer[] = [];
  entry.questions.forEach((question) => {
    const answer = draftAnswers[question.id];
    if (!answer) {
      return;
    }
    if (question.kind === "single_choice" && answer.type === "single_choice") {
      if ("optionId" in answer) {
        normalizedAnswers.push(answer);
        return;
      }
      const text = answer.text.trim();
      if (text.length > 0) {
        normalizedAnswers.push({ ...answer, text });
      }
      return;
    }
    if (question.kind === "free_text" && answer.type === "free_text") {
      const text = answer.text.trim();
      if (text.length > 0) {
        normalizedAnswers.push({ ...answer, text });
      }
    }
  });
  const isComplete = hasQuestions && normalizedAnswers.length === entry.questions.length;

  function updateAnswer(
    question: AssistantAskUserQuestion,
    nextValue: string,
    mode: "option" | "text" = "text",
  ) {
    if (question.kind === "single_choice") {
      if (mode === "option") {
        setDraftAnswers((current) => ({
          ...current,
          [question.id]: {
            questionId: question.id,
            type: "single_choice",
            optionId: nextValue,
          },
        }));
        return;
      }
      setDraftAnswers((current) => ({
        ...current,
        [question.id]: {
          questionId: question.id,
          type: "single_choice",
          text: nextValue,
        },
      }));
      return;
    }
    setDraftAnswers((current) => ({
      ...current,
      [question.id]: {
        questionId: question.id,
        type: "free_text",
        text: nextValue,
      },
    }));
  }

  return (
    <div className="overflow-hidden rounded-md border border-border bg-editor-background">
      <div className="flex items-center gap-2 border-border/70 border-b px-2.5 py-2 text-[11px] text-foreground-muted leading-4">
        <span className="icon-[material-symbols--help-outline] shrink-0 text-[14px] text-accent-foreground" />
        <span className="min-w-0 flex-1 truncate">
          {entry.title ??
            (isResolved ? "已提交回答" : isStreamingInput ? "正在生成提问" : "等待回答")}
        </span>
        {isSubmitting ? (
          <span className="text-accent-foreground">提交中</span>
        ) : isStreamingInput ? (
          <span className="text-accent-foreground">生成中</span>
        ) : null}
      </div>

      <div className={cn("px-2.5", isStreamingInput && !hasQuestions && "py-2.5")}>
        {hasQuestions ? (
          <div className="divide-y divide-border/60">
            {entry.questions.map((question) => (
              <AskUserQuestionBlock
                key={question.id}
                question={question}
                answer={draftAnswers[question.id] ?? null}
                resolved={isResolved}
                streaming={isStreamingInput}
                onChange={(value, mode) => updateAnswer(question, value, mode)}
              />
            ))}
          </div>
        ) : (
          <div className="flex min-h-24 items-center gap-2 rounded-md border border-border/70 border-dashed bg-sidebar-background/25 px-3 py-3 text-[12px] text-foreground-muted leading-5">
            <span className="icon-[material-symbols--progress-activity] shrink-0 animate-spin text-[16px] text-accent-foreground" />
            <span className="min-w-0 flex-1">正在整理提问内容...</span>
          </div>
        )}

        {!isResolved && hasQuestions && !isStreamingInput ? (
          <div className="flex justify-end border-border/60 border-t py-2">
            <button
              type="button"
              disabled={!canSubmit || !isComplete || isSubmitting}
              onClick={() => onSubmit(normalizedAnswers)}
              className="inline-flex h-8 items-center gap-1 rounded-md bg-accent-foreground px-3 font-medium text-[12px] text-sidebar-background transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span
                className={`text-sm ${
                  isSubmitting
                    ? "icon-[material-symbols--progress-activity] animate-spin"
                    : "icon-[material-symbols--check]"
                }`}
              />
              <span>提交</span>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

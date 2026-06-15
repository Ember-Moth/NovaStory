import { useEffect, useState } from "react";

import {
  formatAskUserAnswer,
  type AssistantAskUserAnswer,
  type AssistantAskUserEntry,
  type AssistantAskUserQuestion,
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
  onChange,
}: {
  question: AssistantAskUserQuestion;
  answer: AssistantAskUserAnswer | null;
  resolved: boolean;
  onChange: (_value: string, _mode?: "option" | "text") => void;
}) {
  return (
    <section className="py-2.5 first:pt-2 last:pb-2">
      <div className="text-[12px] leading-5 text-foreground">{question.prompt}</div>
      {resolved ? (
        <div className="mt-1.5 flex items-start gap-1.5 text-[12px] leading-5 text-foreground-muted">
          <span className="mt-0.5 icon-[material-symbols--subdirectory-arrow-right] shrink-0 text-[14px] text-accent-foreground" />
          <span className="min-w-0 flex-1 wrap-break-word whitespace-pre-wrap">
            {formatAskUserAnswer(question, answer)}
          </span>
        </div>
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
                    <span className="mt-0.5 block text-[11px] leading-4 text-foreground-muted">
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
            className="mt-1 w-full resize-y rounded-md border border-border bg-editor-background px-2.5 py-2 text-[12px] leading-5 text-foreground outline-none focus:border-accent-foreground"
            placeholder="或输入自定义回答..."
          />
        </div>
      ) : (
        <textarea
          value={answer?.type === "free_text" ? answer.text : ""}
          onChange={(event) => onChange(event.target.value)}
          rows={3}
          className="mt-2 w-full resize-y rounded-md border border-border bg-editor-background px-2.5 py-2 text-[12px] leading-5 text-foreground outline-none focus:border-accent-foreground"
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
  onSubmit,
}: {
  entry: AssistantAskUserEntry;
  submittedAnswers: AssistantAskUserAnswer[] | null;
  isSubmitting: boolean;
  canSubmit: boolean;
  onSubmit: (_answers: AssistantAskUserAnswer[]) => void;
}) {
  const [draftAnswers, setDraftAnswers] = useState<Record<string, AssistantAskUserAnswer>>(() =>
    indexAskUserAnswers(submittedAnswers),
  );
  const isResolved = submittedAnswers != null;

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
  const isComplete = normalizedAnswers.length === entry.questions.length;

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
      <div className="flex items-center gap-2 border-b border-border/70 px-2.5 py-2 text-[11px] leading-4 text-foreground-muted">
        <span className="icon-[material-symbols--help-outline] shrink-0 text-[14px] text-accent-foreground" />
        <span className="min-w-0 flex-1 truncate">
          {entry.title ?? (isResolved ? "已提交回答" : "等待回答")}
        </span>
        {isSubmitting ? <span className="text-accent-foreground">提交中</span> : null}
      </div>

      <div className="px-2.5">
        <div className="divide-y divide-border/60">
          {entry.questions.map((question) => (
            <AskUserQuestionBlock
              key={question.id}
              question={question}
              answer={draftAnswers[question.id] ?? null}
              resolved={isResolved}
              onChange={(value, mode) => updateAnswer(question, value, mode)}
            />
          ))}
        </div>

        {!isResolved ? (
          <div className="flex justify-end border-t border-border/60 py-2">
            <button
              type="button"
              disabled={!canSubmit || !isComplete || isSubmitting}
              onClick={() => onSubmit(normalizedAnswers)}
              className="inline-flex h-8 items-center gap-1 rounded-md bg-accent-foreground px-3 text-[12px] font-medium text-sidebar-background transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
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

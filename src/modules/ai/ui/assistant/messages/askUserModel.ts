import type { AgentThreadNodeView } from "@/modules/ai/domain/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNonNullable<T>(value: T | null | undefined): value is T {
  return value != null;
}

function getRecordField(payload: unknown, key: string) {
  if (!isRecord(payload)) {
    return null;
  }

  return payload[key] ?? null;
}

function getRecordString(payload: unknown, key: string) {
  const value = getRecordField(payload, key);
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function getToolPayloadField(payload: unknown, key: string) {
  if (!isRecord(payload)) {
    return null;
  }

  return payload[key] ?? null;
}

function getToolPayloadString(payload: unknown, key: string) {
  const value = getToolPayloadField(payload, key);
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export interface AssistantAskUserOption {
  id: string;
  label: string;
  description?: string;
}

export type AssistantAskUserQuestion =
  | {
      id: string;
      prompt: string;
      kind: "single_choice";
      options: AssistantAskUserOption[];
    }
  | {
      id: string;
      prompt: string;
      kind: "free_text";
    };

export type AssistantAskUserAnswer =
  | {
      questionId: string;
      type: "single_choice";
      optionId: string;
    }
  | {
      questionId: string;
      type: "single_choice";
      text: string;
    }
  | {
      questionId: string;
      type: "free_text";
      text: string;
    };

export interface AssistantAskUserEntry {
  toolCallId: string;
  title: string | null;
  questions: AssistantAskUserQuestion[];
  answers: AssistantAskUserAnswer[] | null;
}

function parseAskUserQuestionOption(input: unknown): AssistantAskUserOption | null {
  if (!isRecord(input)) {
    return null;
  }
  const id = getRecordString(input, "id");
  const label = getRecordString(input, "label");
  if (!id || !label) {
    return null;
  }
  const description = getRecordString(input, "description");
  return { id, label, ...(description ? { description } : {}) };
}

function parseAskUserQuestion(input: unknown): AssistantAskUserQuestion | null {
  if (!isRecord(input)) {
    return null;
  }
  const id = getRecordString(input, "id");
  const prompt = getRecordString(input, "prompt");
  const kind = getRecordField(input, "kind");
  if (!id || !prompt || (kind !== "single_choice" && kind !== "free_text")) {
    return null;
  }
  if (kind === "free_text") {
    return { id, prompt, kind };
  }
  const rawOptions = getRecordField(input, "options");
  if (!Array.isArray(rawOptions) || rawOptions.length === 0) {
    return null;
  }
  const options = rawOptions.map(parseAskUserQuestionOption).filter(isNonNullable);
  if (options.length !== rawOptions.length) {
    return null;
  }
  return { id, prompt, kind, options };
}

function parseAskUserInput(payload: unknown) {
  if (!isRecord(payload)) {
    return null;
  }
  const rawQuestions = getRecordField(payload, "questions");
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
    return null;
  }
  const questions = rawQuestions.map(parseAskUserQuestion).filter(isNonNullable);
  if (questions.length !== rawQuestions.length) {
    return null;
  }
  return {
    title: getRecordString(payload, "title"),
    questions,
  };
}

function parseAskUserAnswer(input: unknown): AssistantAskUserAnswer | null {
  if (!isRecord(input)) {
    return null;
  }
  const questionId = getRecordString(input, "questionId");
  const type = getRecordField(input, "type");
  if (!questionId || (type !== "single_choice" && type !== "free_text")) {
    return null;
  }
  if (type === "single_choice") {
    const optionId = getRecordString(input, "optionId");
    const text = getRecordString(input, "text");
    if ((optionId ? 1 : 0) + (text ? 1 : 0) !== 1) {
      return null;
    }
    return optionId ? { questionId, type, optionId } : { questionId, type, text: text! };
  }
  const text = getRecordString(input, "text");
  return text ? { questionId, type, text } : null;
}

function unwrapToolOutput(output: unknown) {
  if (!isRecord(output)) {
    return null;
  }
  if (getRecordField(output, "type") === "json") {
    const value = getRecordField(output, "value");
    return isRecord(value) ? value : null;
  }
  return output;
}

function parseAskUserAnswersFromOutput(output: unknown) {
  const unwrapped = unwrapToolOutput(output);
  const data = unwrapped ? getRecordField(unwrapped, "data") : null;
  if (!isRecord(data)) {
    return null;
  }
  const rawAnswers = getRecordField(data, "answers");
  if (!Array.isArray(rawAnswers)) {
    return null;
  }
  const answers = rawAnswers.map(parseAskUserAnswer).filter(isNonNullable);
  return answers.length === rawAnswers.length ? answers : null;
}

export function getAssistantAskUserEntries(
  messages: AgentThreadNodeView[],
  messageIndex: number,
): AssistantAskUserEntry[] {
  const node = messages[messageIndex];
  if (node?.role !== "assistant") {
    return [];
  }

  const entries: AssistantAskUserEntry[] = node.parts.flatMap((part) => {
    if (part.partKind !== "tool-call") {
      return [];
    }
    const toolName = getToolPayloadString(part.payload, "toolName");
    const toolCallId = getToolPayloadString(part.payload, "toolCallId");
    if (toolName !== "ask_user" || !toolCallId) {
      return [];
    }
    const input = parseAskUserInput(getToolPayloadField(part.payload, "input"));
    if (!input) {
      return [];
    }
    return [{ toolCallId, title: input.title, questions: input.questions, answers: null }];
  });

  if (entries.length === 0) {
    return entries;
  }

  const entryByToolCallId = new Map(entries.map((entry) => [entry.toolCallId, entry]));
  for (let index = messageIndex + 1; index < messages.length; index += 1) {
    const toolNode = messages[index];
    if (toolNode?.role !== "tool") {
      break;
    }
    toolNode.parts.forEach((part) => {
      if (part.partKind !== "tool-result") {
        return;
      }
      const toolName = getToolPayloadString(part.payload, "toolName");
      const toolCallId = getToolPayloadString(part.payload, "toolCallId");
      if (toolName !== "ask_user" || !toolCallId) {
        return;
      }
      const entry = entryByToolCallId.get(toolCallId);
      if (!entry || entry.answers != null) {
        return;
      }
      entry.answers = parseAskUserAnswersFromOutput(getToolPayloadField(part.payload, "output"));
    });
  }

  return entries;
}

export function formatAskUserAnswer(
  question: AssistantAskUserQuestion,
  answer: AssistantAskUserAnswer | null,
) {
  if (!answer) {
    return "未回答";
  }
  if (question.kind === "single_choice") {
    if (answer.type === "single_choice" && "text" in answer) {
      return answer.text;
    }
    const matched = question.options.find(
      (option) =>
        answer.type === "single_choice" && "optionId" in answer && option.id === answer.optionId,
    );
    return matched?.label ?? "已选择";
  }
  return answer.type === "free_text" ? answer.text : "已填写";
}

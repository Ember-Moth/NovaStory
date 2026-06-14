import { jsonSchema, tool } from "ai";

import type { ToolBuildContext } from "./context";
import type { InteractionToolName } from "./tool-names";

export const ASK_USER_TOOL_NAME = "ask_user";

export interface AskUserOption {
  id: string;
  label: string;
  description?: string;
}

export type AskUserQuestion =
  | {
      id: string;
      prompt: string;
      kind: "single_choice";
      options: AskUserOption[];
    }
  | {
      id: string;
      prompt: string;
      kind: "free_text";
    };

export interface AskUserInput {
  title?: string;
  questions: AskUserQuestion[];
}

export type AskUserAnswer =
  | {
      questionId: string;
      type: "single_choice";
      optionId: string;
    }
  | {
      questionId: string;
      type: "free_text";
      text: string;
    };

export interface AskUserOutput {
  request: AskUserInput;
  answers: AskUserAnswer[];
}

function normalizeRequiredString(value: unknown, label: string) {
  if (typeof value !== "string") {
    throw new Error(`${label}必须是字符串。`);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label}不能为空。`);
  }
  return normalized;
}

function normalizeOptionalString(value: unknown, label: string) {
  if (value == null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`${label}必须是字符串。`);
  }
  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}必须是对象。`);
  }
  return value as Record<string, unknown>;
}

function normalizeAskUserOption(value: unknown, optionIndex: number): AskUserOption {
  const record = requireRecord(value, `选项 ${optionIndex + 1}`);
  const description = normalizeOptionalString(record.description, `选项 ${optionIndex + 1} 描述`);
  return {
    id: normalizeRequiredString(record.id, `选项 ${optionIndex + 1} ID`),
    label: normalizeRequiredString(record.label, `选项 ${optionIndex + 1} 文案`),
    ...(description ? { description } : {}),
  };
}

export function normalizeAskUserInput(input: unknown): AskUserInput {
  const record = requireRecord(input, "提问工具输入");
  const rawQuestions = record.questions;
  if (!Array.isArray(rawQuestions)) {
    throw new Error("questions 必须是数组。");
  }
  if (rawQuestions.length < 1 || rawQuestions.length > 8) {
    throw new Error("每次提问必须包含 1 到 8 个问题。");
  }

  const questionIds = new Set<string>();
  const questions = rawQuestions.map((rawQuestion, questionIndex): AskUserQuestion => {
    const questionRecord = requireRecord(rawQuestion, `问题 ${questionIndex + 1}`);
    const id = normalizeRequiredString(questionRecord.id, `问题 ${questionIndex + 1} ID`);
    if (questionIds.has(id)) {
      throw new Error(`问题 ID 重复：${id}。`);
    }
    questionIds.add(id);

    const prompt = normalizeRequiredString(questionRecord.prompt, `问题 ${questionIndex + 1} 内容`);
    const kind = questionRecord.kind;
    if (kind !== "single_choice" && kind !== "free_text") {
      throw new Error(`问题 ${id} 的 kind 必须是 single_choice 或 free_text。`);
    }

    if (kind === "free_text") {
      if (questionRecord.options !== undefined) {
        throw new Error(`自由文本问题 ${id} 不能包含 options。`);
      }
      return { id, prompt, kind };
    }

    const rawOptions = questionRecord.options;
    if (!Array.isArray(rawOptions)) {
      throw new Error(`单选问题 ${id} 必须包含 options。`);
    }
    if (rawOptions.length < 2 || rawOptions.length > 8) {
      throw new Error(`单选问题 ${id} 必须包含 2 到 8 个选项。`);
    }
    const optionIds = new Set<string>();
    const options = rawOptions.map((rawOption, optionIndex) => {
      const option = normalizeAskUserOption(rawOption, optionIndex);
      if (optionIds.has(option.id)) {
        throw new Error(`问题 ${id} 的选项 ID 重复：${option.id}。`);
      }
      optionIds.add(option.id);
      return option;
    });
    return { id, prompt, kind, options };
  });

  const title = normalizeOptionalString(record.title, "提问标题");
  return {
    ...(title ? { title } : {}),
    questions,
  };
}

export function normalizeAskUserAnswers({
  request,
  answers,
}: {
  request: AskUserInput;
  answers: unknown;
}): AskUserAnswer[] {
  if (!Array.isArray(answers)) {
    throw new Error("answers 必须是数组。");
  }

  const questionById = new Map(request.questions.map((question) => [question.id, question]));
  const seenQuestionIds = new Set<string>();
  const normalized = answers.map((rawAnswer, answerIndex): AskUserAnswer => {
    const record = requireRecord(rawAnswer, `答案 ${answerIndex + 1}`);
    const questionId = normalizeRequiredString(
      record.questionId,
      `答案 ${answerIndex + 1} 问题 ID`,
    );
    const question = questionById.get(questionId);
    if (!question) {
      throw new Error(`未知问题 ID：${questionId}。`);
    }
    if (seenQuestionIds.has(questionId)) {
      throw new Error(`问题 ${questionId} 被重复回答。`);
    }
    seenQuestionIds.add(questionId);

    if (question.kind === "single_choice") {
      if (record.type !== "single_choice") {
        throw new Error(`问题 ${questionId} 必须提交 single_choice 答案。`);
      }
      const optionId = normalizeRequiredString(record.optionId, `问题 ${questionId} 选项 ID`);
      if (!question.options.some((option) => option.id === optionId)) {
        throw new Error(`问题 ${questionId} 的选项不存在：${optionId}。`);
      }
      return { questionId, type: "single_choice", optionId };
    }

    if (record.type !== "free_text") {
      throw new Error(`问题 ${questionId} 必须提交 free_text 答案。`);
    }
    return {
      questionId,
      type: "free_text",
      text: normalizeRequiredString(record.text, `问题 ${questionId} 文本答案`),
    };
  });

  for (const question of request.questions) {
    if (!seenQuestionIds.has(question.id)) {
      throw new Error(`问题 ${question.id} 缺少答案。`);
    }
  }

  return normalized;
}

export function buildInteractionTools(_ctx: ToolBuildContext) {
  return {
    ask_user: tool({
      description:
        "当继续写作或修改项目之前必须让用户做选择或补充信息时使用。一次性提出 1 到 8 个问题；每个问题只能是单选或自由文本。不要用普通文本伪装结构化提问。",
      inputSchema: jsonSchema<AskUserInput>({
        type: "object",
        required: ["questions"],
        properties: {
          title: {
            type: "string",
            description: "这一组问题的简短标题。",
          },
          questions: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            items: {
              type: "object",
              required: ["id", "prompt", "kind"],
              properties: {
                id: {
                  type: "string",
                  description: "问题 ID。同一批问题内必须唯一，建议使用稳定英文标识。",
                },
                prompt: {
                  type: "string",
                  description: "展示给用户的问题文本。",
                },
                kind: {
                  type: "string",
                  enum: ["single_choice", "free_text"],
                },
                options: {
                  type: "array",
                  minItems: 2,
                  maxItems: 8,
                  description: "仅 single_choice 问题使用；free_text 问题不要提供。",
                  items: {
                    type: "object",
                    required: ["id", "label"],
                    properties: {
                      id: {
                        type: "string",
                        description: "选项 ID。同一问题内必须唯一。",
                      },
                      label: {
                        type: "string",
                        description: "展示给用户的选项文本。",
                      },
                      description: {
                        type: "string",
                        description: "可选的选项说明。",
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    }),
  } satisfies Record<InteractionToolName, unknown>;
}

export function buildAskUserAnswerOutput(input: AskUserOutput) {
  return {
    ok: true,
    truncated: false,
    data: {
      request: input.request,
      answers: [...input.answers],
    },
  };
}

export function validateAskUserSubmission(input: { request: unknown; answers: unknown }) {
  const request = normalizeAskUserInput(input.request);
  const answers = normalizeAskUserAnswers({ request, answers: input.answers });
  return {
    request,
    answers,
    output: buildAskUserAnswerOutput({ request, answers }),
  };
}

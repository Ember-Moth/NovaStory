import { expect, test } from "bun:test";
import { modelMessageSchema, type ModelMessage } from "ai";

import {
  createMockStream,
  createProjectAssistantService,
  seedCustomConnection,
  seedOpenAiConnection,
  seedProject,
  userConfig,
} from "./test-helpers";

test("follow-up send after tool results reuses sanitized history messages", async () => {
  seedProject("assistant_followup_sanitize");
  const seeded = seedCustomConnection({
    connectionId: "conn_followup_sanitize",
    modelId: "story-model",
    modelRowId: "cmodel_followup_sanitize",
    supportsToolUse: true,
  });
  let invocation = 0;
  let secondCallMessages: ModelMessage[] | null = null;
  const service = createProjectAssistantService({
    readStoredSelection: () => seeded.selection,
    streamAssistantText: ((input: { messages: ModelMessage[] }) => {
      invocation += 1;
      if (invocation === 1) {
        return {
          chunks: (async function* () {
            yield { type: "start-step", stepNumber: 0 };
            yield { type: "text-delta", stepNumber: 0, delta: "我先读取设定。" };
            yield {
              type: "tool-call",
              stepNumber: 0,
              toolCall: {
                toolCallId: "call_followup",
                toolName: "read_file",
                input: { path: "/设定" },
              },
            };
            yield {
              type: "tool-result",
              stepNumber: 0,
              toolResult: {
                toolCallId: "call_followup",
                toolName: "read_file",
                output: {
                  ok: true,
                  data: {
                    path: "/设定",
                  },
                },
              },
            };
            yield {
              type: "finish-step",
              stepNumber: 0,
              finishReason: "tool-calls",
              usage: { totalTokens: 10 },
            };
            yield { type: "start-step", stepNumber: 1 };
            yield { type: "text-delta", stepNumber: 1, delta: "设定我已经看完了。" };
            yield {
              type: "finish-step",
              stepNumber: 1,
              finishReason: "stop",
              usage: { totalTokens: 11 },
            };
          })(),
          text: Promise.resolve("设定我已经看完了。"),
          usage: Promise.resolve({ totalTokens: 21 }),
          finishReason: Promise.resolve("stop"),
          steps: Promise.resolve([
            {
              stepNumber: 0,
              preparedMessages: input.messages,
              model: { provider: "openai", modelId: "story-model" },
              finishReason: "tool-calls",
              rawFinishReason: "tool_calls",
              usage: { totalTokens: 10 },
              request: { body: { step: 0 } },
              response: {
                body: { id: "resp_followup_0" },
                messages: [
                  {
                    role: "assistant",
                    content: [
                      { type: "text", text: "我先读取设定。" },
                      {
                        type: "tool-call",
                        toolCallId: "call_followup",
                        toolName: "read_file",
                        input: { path: "/设定" },
                      },
                    ],
                  },
                  {
                    role: "tool",
                    content: [
                      {
                        type: "tool-result",
                        toolCallId: "call_followup",
                        toolName: "read_file",
                        output: {
                          type: "json",
                          value: {
                            ok: true,
                            data: {
                              path: "/设定",
                            },
                          },
                        },
                      },
                    ],
                  },
                ],
              },
              providerMetadata: {},
              toolCalls: [
                {
                  toolCallId: "call_followup",
                  toolName: "read_file",
                  input: { path: "/设定" },
                },
              ],
              toolResults: [
                {
                  toolCallId: "call_followup",
                  toolName: "read_file",
                  output: {
                    ok: true,
                    data: {
                      path: "/设定",
                    },
                  },
                },
              ],
            },
            {
              stepNumber: 1,
              preparedMessages: input.messages,
              model: { provider: "openai", modelId: "story-model" },
              finishReason: "stop",
              rawFinishReason: "stop",
              usage: { totalTokens: 11 },
              request: { body: { step: 1 } },
              response: {
                body: { id: "resp_followup_1" },
                messages: [
                  {
                    role: "assistant",
                    content: [{ type: "text", text: "设定我已经看完了。" }],
                  },
                ],
              },
              providerMetadata: {},
              toolCalls: [],
              toolResults: [],
            },
          ]),
        };
      }

      secondCallMessages = input.messages;
      expect(modelMessageSchema.array().safeParse(input.messages).success).toBe(true);

      return createMockStream({
        chunks: [
          { type: "start-step", stepNumber: 0 },
          { type: "text-delta", stepNumber: 0, delta: "继续分析完成。" },
          {
            type: "finish-step",
            stepNumber: 0,
            finishReason: "stop",
            usage: { totalTokens: 6 },
          },
        ],
        text: "继续分析完成。",
        usage: { totalTokens: 6 },
        finishReason: "stop",
        steps: [
          {
            stepNumber: 0,
            preparedMessages: input.messages,
            model: { provider: "openai", modelId: "story-model" },
            finishReason: "stop",
            rawFinishReason: "stop",
            usage: { totalTokens: 6 },
            request: { body: { prompt: "follow up" } },
            response: {
              body: { id: "resp_followup_final" },
              messages: [
                {
                  role: "assistant",
                  content: [{ type: "text", text: "继续分析完成。" }],
                },
              ],
            },
            providerMetadata: {},
            toolCalls: [],
            toolResults: [],
          },
        ],
      })();
    }) as any,
  });
  const thread = service.createProjectAssistantThread("assistant_followup_sanitize");

  await service.sendProjectAssistantMessage({
    projectId: "assistant_followup_sanitize",
    threadId: thread.id,
    text: "先读一下设定",
  });
  const followUp = await service.sendProjectAssistantMessage({
    projectId: "assistant_followup_sanitize",
    threadId: thread.id,
    text: "继续往下说",
  });

  expect(followUp.run.status).toBe("succeeded");
  expect(secondCallMessages).not.toBeNull();
  expect(secondCallMessages!).toEqual([
    {
      role: "user",
      content: [{ type: "text", text: "先读一下设定" }],
    },
    {
      role: "assistant",
      content: [
        { type: "text", text: "我先读取设定。" },
        {
          type: "tool-call",
          toolCallId: "call_followup",
          toolName: "read_file",
          input: { path: "/设定" },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call_followup",
          toolName: "read_file",
          output: {
            type: "json",
            value: {
              ok: true,
              data: {
                path: "/设定",
              },
            },
          },
        },
      ],
    },
    {
      role: "assistant",
      content: [{ type: "text", text: "设定我已经看完了。" }],
    },
    {
      role: "user",
      content: [{ type: "text", text: "继续往下说" }],
    },
  ]);
});

test("openai follow-up send uses previous response id and only sends incremental messages", async () => {
  seedProject("assistant_openai_followup");
  const seeded = seedOpenAiConnection({
    connectionId: "conn_openai_followup",
    modelId: "gpt-5",
    modelRowId: "cmodel_openai_followup",
  });
  const timestamp = Date.now();
  userConfig.insertGlobalPromptToConfig({
    id: "prompt_openai_followup",
    name: "追问扩写",
    description: null,
    content: "请围绕上一轮方向继续扩写，保持语气克制。",
    isEnabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  let invocation = 0;
  const secondCallInput: {
    current: {
      messages: ModelMessage[];
      providerOptions: unknown;
      system: string | null;
    } | null;
  } = {
    current: null,
  };
  const service = createProjectAssistantService({
    readStoredSelection: () => seeded.selection,
    streamAssistantText: ((input: {
      messages: ModelMessage[];
      providerOptions?: Record<string, unknown>;
      system: string | null;
    }) => {
      invocation += 1;
      if (invocation === 1) {
        return {
          chunks: (async function* () {
            yield { type: "start-step", stepNumber: 0 };
            yield {
              type: "reasoning-start",
              stepNumber: 0,
              id: "rs_1",
              providerMetadata: {
                openai: {
                  itemId: "rs_item_1",
                },
              },
            };
            yield {
              type: "reasoning-delta",
              stepNumber: 0,
              id: "rs_1",
              delta: "先整理设定脉络。",
              providerMetadata: {
                openai: {
                  itemId: "rs_item_1",
                },
              },
            };
            yield {
              type: "reasoning-end",
              stepNumber: 0,
              id: "rs_1",
              providerMetadata: {
                openai: {
                  itemId: "rs_item_1",
                },
              },
            };
            yield { type: "text-delta", stepNumber: 0, delta: "这是第一轮回复。" };
            yield {
              type: "finish-step",
              stepNumber: 0,
              finishReason: "stop",
              usage: { totalTokens: 12 },
            };
          })(),
          text: Promise.resolve("这是第一轮回复。"),
          usage: Promise.resolve({ totalTokens: 12 }),
          finishReason: Promise.resolve("stop"),
          steps: Promise.resolve([
            {
              stepNumber: 0,
              preparedMessages: input.messages,
              model: { provider: "openai", modelId: "gpt-5" },
              finishReason: "stop",
              rawFinishReason: "stop",
              usage: { totalTokens: 12 },
              request: { body: { prompt: "first" } },
              response: {
                body: { id: "resp_openai_first" },
                messages: [
                  {
                    role: "assistant",
                    content: [
                      {
                        type: "reasoning",
                        text: "先整理设定脉络。",
                        providerMetadata: {
                          openai: {
                            itemId: "rs_item_1",
                          },
                        },
                      },
                      { type: "text", text: "这是第一轮回复。" },
                    ],
                  },
                ],
              },
              providerMetadata: {},
              toolCalls: [],
              toolResults: [],
            },
          ]),
        };
      }

      secondCallInput.current = {
        messages: input.messages,
        providerOptions: input.providerOptions ?? null,
        system: input.system,
      };

      return createMockStream({
        chunks: [
          { type: "start-step", stepNumber: 0 },
          { type: "text-delta", stepNumber: 0, delta: "这是继续回复。" },
          {
            type: "finish-step",
            stepNumber: 0,
            finishReason: "stop",
            usage: { totalTokens: 8 },
          },
        ],
        text: "这是继续回复。",
        usage: { totalTokens: 8 },
        finishReason: "stop",
        steps: [
          {
            stepNumber: 0,
            preparedMessages: input.messages,
            model: { provider: "openai", modelId: "gpt-5" },
            finishReason: "stop",
            rawFinishReason: "stop",
            usage: { totalTokens: 8 },
            request: { body: { prompt: "follow-up" } },
            response: {
              body: { id: "resp_openai_second" },
              messages: [
                {
                  role: "assistant",
                  content: [{ type: "text", text: "这是继续回复。" }],
                },
              ],
            },
            providerMetadata: {},
            toolCalls: [],
            toolResults: [],
          },
        ],
      })();
    }) as any,
  });
  const thread = service.createProjectAssistantThread("assistant_openai_followup");

  await service.sendProjectAssistantMessage({
    projectId: "assistant_openai_followup",
    threadId: thread.id,
    text: "先给我一个方向",
  });
  await service.sendProjectAssistantMessage({
    projectId: "assistant_openai_followup",
    threadId: thread.id,
    text: "继续展开",
    mentions: [
      {
        kind: "global-prompt",
        mode: "snapshot-ref",
        targetId: "prompt_openai_followup",
        label: "追问扩写",
      },
    ],
    context: {
      workspaceId: "workspace_openai_followup",
      activeContentNodeId: null,
      activeContentTitle: null,
      activeAuxNodeId: null,
      activeAuxPath: "/设定/角色.md",
      activeTimelinePointId: "point_now",
      activeTimelineLabel: "现在",
    },
  });

  expect(secondCallInput.current).not.toBeNull();
  if (!secondCallInput.current) {
    throw new Error("expected second OpenAI follow-up input");
  }
  const capturedInput = secondCallInput.current;
  expect(capturedInput.system).toBeNull();
  expect(capturedInput.messages).toEqual([
    {
      role: "user",
      content: [{ type: "text", text: "继续展开" }],
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "当前编辑器：辅助路径=/设定/角色.md；时间锚点 id=point_now，label=现在",
        },
      ],
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: [
            "用户通过 @ 引用了以下全局 Prompt：",
            "",
            '<global_prompt id="prompt_openai_followup" name="追问扩写">',
            "请围绕上一轮方向继续扩写，保持语气克制。",
            "</global_prompt>",
          ].join("\n"),
        },
      ],
    },
  ]);
  expect(capturedInput.providerOptions).toMatchObject({
    openai: {
      previousResponseId: "resp_openai_first",
      reasoningSummary: "auto",
    },
  });
  expect(
    String(
      Reflect.get(
        (capturedInput.providerOptions as Record<string, unknown>).openai as Record<
          string,
          unknown
        >,
        "instructions",
      ),
    ),
  ).not.toContain("当前编辑上下文：");
  expect(
    String(
      Reflect.get(
        (capturedInput.providerOptions as Record<string, unknown>).openai as Record<
          string,
          unknown
        >,
        "instructions",
      ),
    ),
  ).not.toContain("当前编辑器：");
  expect(
    typeof Reflect.get(
      (capturedInput.providerOptions as Record<string, unknown>).openai as Record<string, unknown>,
      "instructions",
    ),
  ).toBe("string");

  const state = service.getProjectAssistantState("assistant_openai_followup").state;
  const assistantNodes = state.activePath.filter((node) => node.role === "assistant");
  expect(assistantNodes[0]?.message).toEqual({
    role: "assistant",
    content: [
      {
        type: "reasoning",
        text: "先整理设定脉络。",
        providerOptions: {
          openai: {
            itemId: "rs_item_1",
          },
        },
      },
      {
        type: "text",
        text: "这是第一轮回复。",
      },
    ],
  });
});

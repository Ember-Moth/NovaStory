import { expect, test } from "bun:test";
import { modelMessageSchema, type ModelMessage } from "ai";

import { setupMockDatabase } from "@/test/mock-db";

setupMockDatabase();

const { db, schema } = await import("@/db");
const logs = await import("@/modules/ai/domain/logs");
const { createDefaultWorkspace } = await import("@/modules/workspace/domain");
const { createProjectAssistantService } = await import("./project-assistant");

function createMockStream({
  chunks,
  text,
  finishReason,
  usage,
  steps,
}: {
  chunks: Array<Record<string, unknown>>;
  text: string;
  finishReason: string;
  usage: unknown;
  steps: Array<Record<string, unknown>>;
}) {
  return () => ({
    chunks: (async function* () {
      for (const chunk of chunks) {
        yield chunk;
      }
    })(),
    text: Promise.resolve(text),
    finishReason: Promise.resolve(finishReason),
    usage: Promise.resolve(usage),
    steps: Promise.resolve(steps),
  });
}

function seedProject(projectId: string) {
  db.insert(schema.projects)
    .values({
      id: projectId,
      name: `Project ${projectId}`,
      description: null,
    })
    .run();
}

function seedCustomConnection({
  connectionId,
  modelId,
  modelRowId,
  apiKey = "sk-test",
  supportsToolUse = false,
}: {
  connectionId: string;
  modelId: string;
  modelRowId: string;
  apiKey?: string | null;
  supportsToolUse?: boolean;
}) {
  db.insert(schema.aiConnections)
    .values({
      id: connectionId,
      kind: "custom",
      name: "Primary Connection",
      sdkPackage: "@ai-sdk/openai-compatible",
      baseUrl: "https://example.test/v1",
      apiKey,
      configJson: "{}",
      isEnabled: true,
    })
    .run();
  db.insert(schema.aiConnectionCustomModels)
    .values({
      id: modelRowId,
      connectionId,
      modelId,
      displayName: "Story Model",
      supportsReasoning: true,
      supportsToolUse,
      isEnabled: true,
    })
    .run();

  return {
    selection: {
      connectionId,
      modelId: `custom:${modelRowId}`,
    },
  };
}

function seedOpenAiConnection({
  connectionId,
  modelId,
  modelRowId,
  apiKey = "sk-test",
  supportsReasoning = true,
  supportsToolUse = false,
}: {
  connectionId: string;
  modelId: string;
  modelRowId: string;
  apiKey?: string | null;
  supportsReasoning?: boolean;
  supportsToolUse?: boolean;
}) {
  db.insert(schema.aiConnections)
    .values({
      id: connectionId,
      kind: "custom",
      name: "OpenAI Connection",
      sdkPackage: "@ai-sdk/openai",
      baseUrl: null,
      apiKey,
      configJson: "{}",
      isEnabled: true,
    })
    .run();
  db.insert(schema.aiConnectionCustomModels)
    .values({
      id: modelRowId,
      connectionId,
      modelId,
      displayName: "Reasoning Model",
      supportsReasoning,
      supportsToolUse,
      isEnabled: true,
    })
    .run();

  return {
    selection: {
      connectionId,
      modelId: `custom:${modelRowId}`,
    },
  };
}

test("sendProjectAssistantMessage materializes user and assistant nodes and records a run", async () => {
  seedProject("assistant_send");
  const seeded = seedCustomConnection({
    connectionId: "conn_send",
    modelId: "story-model",
    modelRowId: "cmodel_send",
  });
  const service = createProjectAssistantService({
    readStoredSelection: () => seeded.selection,
    streamAssistantText: createMockStream({
      chunks: [
        {
          type: "start-step",
          stepNumber: 0,
        },
        {
          type: "text-delta",
          stepNumber: 0,
          delta: "Assistant reply",
        },
        {
          type: "finish-step",
          stepNumber: 0,
          finishReason: "stop",
          usage: { totalTokens: 42 },
        },
      ],
      text: "Assistant reply",
      usage: { totalTokens: 42 },
      finishReason: "stop",
      steps: [
        {
          stepNumber: 0,
          preparedMessages: [{ role: "user", content: [{ type: "text", text: "Hello world" }] }],
          model: { provider: "openai", modelId: "story-model" },
          finishReason: "stop",
          rawFinishReason: "stop",
          usage: { totalTokens: 42 },
          request: { body: { prompt: "Hello world" } },
          response: {
            body: { id: "resp_1" },
            messages: [
              {
                role: "assistant",
                content: [{ type: "text", text: "Assistant reply" }],
              },
            ],
          },
          providerMetadata: { openai: { cachedPromptTokens: 0 } },
          toolCalls: [],
          toolResults: [],
        },
      ],
    }) as any,
  });
  const thread = service.createProjectAssistantThread("assistant_send");

  const result = await service.sendProjectAssistantMessage({
    projectId: "assistant_send",
    threadId: thread.id,
    text: "Hello world",
  });

  expect(result.userNode.role).toBe("user");
  expect(result.assistantNode?.role).toBe("assistant");
  expect(result.state.activePath.map((node) => node.role)).toEqual(["user", "assistant"]);
  expect(result.run.status).toBe("succeeded");
  expect(service.getRunTrace(result.run.id).steps).toHaveLength(1);
});

test("retryProjectAssistantMessage creates sibling assistant candidates", async () => {
  seedProject("assistant_retry");
  const seeded = seedCustomConnection({
    connectionId: "conn_retry",
    modelId: "story-model",
    modelRowId: "cmodel_retry",
  });
  const service = createProjectAssistantService({
    readStoredSelection: () => seeded.selection,
    streamAssistantText: createMockStream({
      chunks: [
        {
          type: "start-step",
          stepNumber: 0,
        },
        {
          type: "text-delta",
          stepNumber: 0,
          delta: "Retried reply",
        },
        {
          type: "finish-step",
          stepNumber: 0,
          finishReason: "stop",
          usage: { totalTokens: 9 },
        },
      ],
      text: "Retried reply",
      usage: { totalTokens: 9 },
      finishReason: "stop",
      steps: [
        {
          stepNumber: 0,
          preparedMessages: [{ role: "user", content: [{ type: "text", text: "Need help" }] }],
          model: { provider: "openai", modelId: "story-model" },
          finishReason: "stop",
          rawFinishReason: "stop",
          usage: { totalTokens: 9 },
          request: { body: { prompt: "Need help" } },
          response: {
            body: { id: "resp_retry" },
            messages: [
              {
                role: "assistant",
                content: [{ type: "text", text: "Retried reply" }],
              },
            ],
          },
          providerMetadata: {},
          toolCalls: [],
          toolResults: [],
        },
      ],
    }) as any,
  });
  const thread = service.createProjectAssistantThread("assistant_retry");
  const userNode = logs.appendUserNode({
    threadId: thread.id,
    parentNodeId: null,
    message: {
      role: "user",
      content: [{ type: "text", text: "Need help" }],
    },
  });

  const result = await service.retryProjectAssistantMessage({
    projectId: "assistant_retry",
    threadId: thread.id,
    triggerNodeId: userNode.id,
  });

  expect(result.assistantNode?.summaryText).toBe("Retried reply");
  expect(service.getNodeCandidates(userNode.id)).toHaveLength(1);
});

test("sendProjectAssistantMessage only materializes per-step response deltas into the thread path", async () => {
  seedProject("assistant_multistep");
  const seeded = seedCustomConnection({
    connectionId: "conn_multistep",
    modelId: "story-model",
    modelRowId: "cmodel_multistep",
    supportsToolUse: true,
  });
  const service = createProjectAssistantService({
    readStoredSelection: () => seeded.selection,
    streamAssistantText: ((_input: { messages: ModelMessage[] }) => {
      const stepZeroAssistant = {
        role: "assistant" as const,
        content: [
          { type: "text" as const, text: "先读取当前上下文。" },
          {
            type: "tool-call" as const,
            toolCallId: "tool_call_context",
            toolName: "read_current_writing_context",
            input: {},
          },
        ],
      };
      const stepZeroTool = {
        role: "tool" as const,
        content: [
          {
            type: "tool-result" as const,
            toolCallId: "tool_call_context",
            toolName: "read_current_writing_context",
            output: {
              type: "json" as const,
              value: {
                ok: true,
                data: {
                  activeAuxPath: "/设定",
                },
              },
            },
          },
        ],
      };
      const stepOneAssistant = {
        role: "assistant" as const,
        content: [
          { type: "text" as const, text: "`/设定` 是文件，我再看一下根目录。" },
          {
            type: "tool-call" as const,
            toolCallId: "tool_call_root",
            toolName: "list_aux_dir",
            input: {},
          },
        ],
      };
      const stepOneTool = {
        role: "tool" as const,
        content: [
          {
            type: "tool-result" as const,
            toolCallId: "tool_call_root",
            toolName: "list_aux_dir",
            output: {
              type: "json" as const,
              value: {
                ok: true,
                data: {
                  entries: [{ path: "/设定", nodeType: "file" }],
                },
              },
            },
          },
        ],
      };
      const stepTwoAssistant = {
        role: "assistant" as const,
        content: [{ type: "text" as const, text: "现在可以开始分析设定了。" }],
      };

      return {
        chunks: (async function* () {
          yield { type: "start-step", stepNumber: 0 };
          yield { type: "text-delta", stepNumber: 0, delta: "先读取当前上下文。" };
          yield {
            type: "tool-call",
            stepNumber: 0,
            toolCall: {
              toolCallId: "tool_call_context",
              toolName: "read_current_writing_context",
              input: {},
            },
          };
          yield {
            type: "tool-result",
            stepNumber: 0,
            toolResult: {
              toolCallId: "tool_call_context",
              toolName: "read_current_writing_context",
              output: {
                ok: true,
              },
            },
          };
          yield {
            type: "finish-step",
            stepNumber: 0,
            finishReason: "tool-calls",
            usage: { totalTokens: 40 },
          };
          yield { type: "start-step", stepNumber: 1 };
          yield { type: "text-delta", stepNumber: 1, delta: "`/设定` 是文件，我再看一下根目录。" };
          yield {
            type: "tool-call",
            stepNumber: 1,
            toolCall: {
              toolCallId: "tool_call_root",
              toolName: "list_aux_dir",
              input: {},
            },
          };
          yield {
            type: "tool-result",
            stepNumber: 1,
            toolResult: {
              toolCallId: "tool_call_root",
              toolName: "list_aux_dir",
              output: {
                ok: true,
              },
            },
          };
          yield {
            type: "finish-step",
            stepNumber: 1,
            finishReason: "tool-calls",
            usage: { totalTokens: 41 },
          };
          yield { type: "start-step", stepNumber: 2 };
          yield { type: "text-delta", stepNumber: 2, delta: "现在可以开始分析设定了。" };
          yield {
            type: "finish-step",
            stepNumber: 2,
            finishReason: "stop",
            usage: { totalTokens: 42 },
          };
        })(),
        text: Promise.resolve("现在可以开始分析设定了。"),
        usage: Promise.resolve({ totalTokens: 123 }),
        finishReason: Promise.resolve("stop"),
        steps: Promise.resolve([
          {
            stepNumber: 0,
            preparedMessages: _input.messages,
            model: { provider: "openai", modelId: "story-model" },
            finishReason: "tool-calls",
            rawFinishReason: "tool_calls",
            usage: { totalTokens: 40 },
            request: { body: { step: 0 } },
            response: {
              body: { id: "resp_step_0" },
              messages: [stepZeroAssistant, stepZeroTool],
            },
            providerMetadata: { openai: { cachedPromptTokens: 0 } },
            toolCalls: [
              {
                toolCallId: "tool_call_context",
                toolName: "read_current_writing_context",
                input: {},
              },
            ],
            toolResults: [
              {
                toolCallId: "tool_call_context",
                toolName: "read_current_writing_context",
                output: {
                  ok: true,
                },
              },
            ],
          },
          {
            stepNumber: 1,
            preparedMessages: _input.messages,
            model: { provider: "openai", modelId: "story-model" },
            finishReason: "tool-calls",
            rawFinishReason: "tool_calls",
            usage: { totalTokens: 41 },
            request: { body: { step: 1 } },
            response: {
              body: { id: "resp_step_1" },
              messages: [stepZeroAssistant, stepZeroTool, stepOneAssistant, stepOneTool],
            },
            providerMetadata: { openai: { cachedPromptTokens: 1 } },
            toolCalls: [
              {
                toolCallId: "tool_call_root",
                toolName: "list_aux_dir",
                input: {},
              },
            ],
            toolResults: [
              {
                toolCallId: "tool_call_root",
                toolName: "list_aux_dir",
                output: {
                  ok: true,
                },
              },
            ],
          },
          {
            stepNumber: 2,
            preparedMessages: _input.messages,
            model: { provider: "openai", modelId: "story-model" },
            finishReason: "stop",
            rawFinishReason: "stop",
            usage: { totalTokens: 42 },
            request: { body: { step: 2 } },
            response: {
              body: { id: "resp_step_2" },
              messages: [
                stepZeroAssistant,
                stepZeroTool,
                stepOneAssistant,
                stepOneTool,
                stepTwoAssistant,
              ],
            },
            providerMetadata: { openai: { cachedPromptTokens: 2 } },
            toolCalls: [],
            toolResults: [],
          },
        ]),
      };
    }) as any,
  });
  const thread = service.createProjectAssistantThread("assistant_multistep");

  const result = await service.sendProjectAssistantMessage({
    projectId: "assistant_multistep",
    threadId: thread.id,
    text: "帮我分析当前设定",
  });

  expect(result.state.activePath.map((node) => node.role)).toEqual([
    "user",
    "assistant",
    "tool",
    "assistant",
    "tool",
    "assistant",
  ]);
  expect(
    result.state.activePath
      .filter((node) => node.role === "assistant")
      .map((node) => node.summaryText),
  ).toEqual([
    "先读取当前上下文。",
    "`/设定` 是文件，我再看一下根目录。",
    "现在可以开始分析设定了。",
  ]);

  const trace = service.getRunTrace(result.run.id);
  const responseMessageArtifacts = trace.steps
    .map(
      (step) =>
        trace.artifacts.find((artifact) => artifact.id === step.responseMessagesArtifactId) ?? null,
    )
    .filter((artifact): artifact is NonNullable<typeof artifact> => artifact != null);
  const responseMessageLengths = responseMessageArtifacts.map((artifact) =>
    Array.isArray(artifact.content) ? artifact.content.length : -1,
  );

  expect(responseMessageLengths).toEqual([2, 4, 5]);
  expect(trace.events.filter((event) => event.eventKind === "node-materialized")).toHaveLength(5);
});

test("sendProjectAssistantMessage uses read-only tools by default and can opt into aux write tools", async () => {
  seedProject("assistant_active_tools");
  const seeded = seedCustomConnection({
    connectionId: "conn_active_tools",
    modelId: "story-model",
    modelRowId: "cmodel_active_tools",
    supportsToolUse: true,
  });
  const capturedActiveTools: Array<readonly string[]> = [];
  const service = createProjectAssistantService({
    readStoredSelection: () => seeded.selection,
    streamAssistantText: ((input: { activeTools: readonly string[] }) => {
      capturedActiveTools.push(input.activeTools);
      return createMockStream({
        chunks: [
          { type: "start-step", stepNumber: 0 },
          { type: "text-delta", stepNumber: 0, delta: "收到。" },
          {
            type: "finish-step",
            stepNumber: 0,
            finishReason: "stop",
            usage: { totalTokens: 5 },
          },
        ],
        text: "收到。",
        usage: { totalTokens: 5 },
        finishReason: "stop",
        steps: [
          {
            stepNumber: 0,
            preparedMessages: [],
            model: { provider: "openai", modelId: "story-model" },
            finishReason: "stop",
            rawFinishReason: "stop",
            usage: { totalTokens: 5 },
            request: { body: { prompt: "ok" } },
            response: {
              body: { id: `resp_${capturedActiveTools.length}` },
              messages: [
                {
                  role: "assistant",
                  content: [{ type: "text", text: "收到。" }],
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
  const thread = service.createProjectAssistantThread("assistant_active_tools");

  await service.sendProjectAssistantMessage({
    projectId: "assistant_active_tools",
    threadId: thread.id,
    text: "先默认发送",
  });
  await service.sendProjectAssistantMessage({
    projectId: "assistant_active_tools",
    threadId: thread.id,
    text: "允许你写辅助资料",
    activeTools: [
      "read_current_writing_context",
      "read_content_subtree",
      "list_timeline_points",
      "list_aux_dir",
      "read_aux_path",
      "mkdir_aux_dir",
      "write_aux_file",
    ],
  });

  expect(capturedActiveTools).toEqual([
    [
      "read_current_writing_context",
      "read_content_subtree",
      "list_timeline_points",
      "list_aux_dir",
      "read_aux_path",
    ],
    [
      "read_current_writing_context",
      "read_content_subtree",
      "list_timeline_points",
      "list_aux_dir",
      "read_aux_path",
      "mkdir_aux_dir",
      "write_aux_file",
    ],
  ]);
});

test("sendProjectAssistantMessage rejects explicit tools when the model does not support tool use", async () => {
  seedProject("assistant_tool_guard");
  const seeded = seedCustomConnection({
    connectionId: "conn_tool_guard",
    modelId: "story-model",
    modelRowId: "cmodel_tool_guard",
    supportsToolUse: false,
  });
  let streamCalls = 0;
  const service = createProjectAssistantService({
    readStoredSelection: () => seeded.selection,
    streamAssistantText: (() => {
      streamCalls += 1;
      throw new Error("stream should not run");
    }) as any,
  });
  const thread = service.createProjectAssistantThread("assistant_tool_guard");

  await expect(
    service.sendProjectAssistantMessage({
      projectId: "assistant_tool_guard",
      threadId: thread.id,
      text: "读一下上下文",
      activeTools: ["read_aux_path"],
    }),
  ).rejects.toThrow("当前模型不支持工具调用，无法启用请求级工具。");
  expect(streamCalls).toBe(0);
});

test("sendProjectAssistantMessage records tool input and output artifacts for explicit aux write tools", async () => {
  seedProject("assistant_write_tool_trace");
  const seeded = seedCustomConnection({
    connectionId: "conn_write_tool_trace",
    modelId: "story-model",
    modelRowId: "cmodel_write_tool_trace",
    supportsToolUse: true,
  });
  const service = createProjectAssistantService({
    readStoredSelection: () => seeded.selection,
    streamAssistantText: createMockStream({
      chunks: [
        { type: "start-step", stepNumber: 0 },
        { type: "text-delta", stepNumber: 0, delta: "我来记一条人物资料。" },
        {
          type: "tool-call",
          stepNumber: 0,
          toolCall: {
            toolCallId: "tool_write_1",
            toolName: "write_aux_file",
            input: { path: "/设定/角色.md", content: "主角：林舟" },
          },
        },
        {
          type: "tool-result",
          stepNumber: 0,
          toolResult: {
            toolCallId: "tool_write_1",
            toolName: "write_aux_file",
            output: {
              ok: true,
              data: {
                action: "created",
                path: "/设定/角色.md",
                nodeId: "aux_written",
              },
            },
          },
        },
        {
          type: "finish-step",
          stepNumber: 0,
          finishReason: "tool-calls",
          usage: { totalTokens: 8 },
        },
        { type: "start-step", stepNumber: 1 },
        { type: "text-delta", stepNumber: 1, delta: "人物资料已经写好了。" },
        {
          type: "finish-step",
          stepNumber: 1,
          finishReason: "stop",
          usage: { totalTokens: 9 },
        },
      ],
      text: "人物资料已经写好了。",
      usage: { totalTokens: 17 },
      finishReason: "stop",
      steps: [
        {
          stepNumber: 0,
          preparedMessages: [{ role: "user", content: [{ type: "text", text: "保存人物资料" }] }],
          model: { provider: "openai", modelId: "story-model" },
          finishReason: "tool-calls",
          rawFinishReason: "tool_calls",
          usage: { totalTokens: 8 },
          request: { body: { step: 0 } },
          response: {
            body: { id: "resp_write_0" },
            messages: [
              {
                role: "assistant",
                content: [
                  { type: "text", text: "我来记一条人物资料。" },
                  {
                    type: "tool-call",
                    toolCallId: "tool_write_1",
                    toolName: "write_aux_file",
                    input: { path: "/设定/角色.md", content: "主角：林舟" },
                  },
                ],
              },
              {
                role: "tool",
                content: [
                  {
                    type: "tool-result",
                    toolCallId: "tool_write_1",
                    toolName: "write_aux_file",
                    output: {
                      type: "json",
                      value: {
                        ok: true,
                        data: {
                          action: "created",
                          path: "/设定/角色.md",
                          nodeId: "aux_written",
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
              toolCallId: "tool_write_1",
              toolName: "write_aux_file",
              input: { path: "/设定/角色.md", content: "主角：林舟" },
            },
          ],
          toolResults: [
            {
              toolCallId: "tool_write_1",
              toolName: "write_aux_file",
              output: {
                ok: true,
                data: {
                  action: "created",
                  path: "/设定/角色.md",
                  nodeId: "aux_written",
                },
              },
            },
          ],
        },
        {
          stepNumber: 1,
          preparedMessages: [{ role: "user", content: [{ type: "text", text: "保存人物资料" }] }],
          model: { provider: "openai", modelId: "story-model" },
          finishReason: "stop",
          rawFinishReason: "stop",
          usage: { totalTokens: 9 },
          request: { body: { step: 1 } },
          response: {
            body: { id: "resp_write_1" },
            messages: [
              {
                role: "assistant",
                content: [{ type: "text", text: "人物资料已经写好了。" }],
              },
            ],
          },
          providerMetadata: {},
          toolCalls: [],
          toolResults: [],
        },
      ],
    }) as any,
  });
  const thread = service.createProjectAssistantThread("assistant_write_tool_trace");

  const result = await service.sendProjectAssistantMessage({
    projectId: "assistant_write_tool_trace",
    threadId: thread.id,
    text: "保存人物资料",
    activeTools: [
      "read_current_writing_context",
      "read_content_subtree",
      "list_timeline_points",
      "list_aux_dir",
      "read_aux_path",
      "mkdir_aux_dir",
      "write_aux_file",
    ],
  });
  const trace = service.getRunTrace(result.run.id);

  expect(trace.artifacts.map((artifact) => artifact.artifactKind)).toContain("tool-input");
  expect(trace.artifacts.map((artifact) => artifact.artifactKind)).toContain("tool-output");
  expect(trace.events.some((event) => event.eventKind === "tool-call-started")).toBe(true);
  expect(trace.events.some((event) => event.eventKind === "tool-call-finished")).toBe(true);
});

test("sendProjectAssistantMessageStream emits workspace-mutated after a successful aux write tool", async () => {
  seedProject("assistant_workspace_mutation_stream");
  const workspace = createDefaultWorkspace("assistant_workspace_mutation_stream");
  const seeded = seedCustomConnection({
    connectionId: "conn_workspace_mutation_stream",
    modelId: "story-model",
    modelRowId: "cmodel_workspace_mutation_stream",
    supportsToolUse: true,
  });
  const service = createProjectAssistantService({
    readStoredSelection: () => seeded.selection,
    streamAssistantText: createMockStream({
      chunks: [
        { type: "start-step", stepNumber: 0 },
        {
          type: "tool-result",
          stepNumber: 0,
          toolResult: {
            toolCallId: "tool_write_stream",
            toolName: "write_aux_file",
            output: {
              ok: true,
              data: {
                action: "created",
                path: "/设定/角色.md",
                nodeId: "aux_stream",
              },
            },
          },
        },
        {
          type: "finish-step",
          stepNumber: 0,
          finishReason: "stop",
          usage: { totalTokens: 3 },
        },
      ],
      text: "",
      usage: { totalTokens: 3 },
      finishReason: "stop",
      steps: [
        {
          stepNumber: 0,
          preparedMessages: [],
          model: { provider: "openai", modelId: "story-model" },
          finishReason: "stop",
          rawFinishReason: "stop",
          usage: { totalTokens: 3 },
          request: { body: { step: 0 } },
          response: { body: { id: "resp_workspace_mutation_stream" }, messages: [] },
          providerMetadata: {},
          toolCalls: [],
          toolResults: [
            {
              toolCallId: "tool_write_stream",
              toolName: "write_aux_file",
              output: {
                ok: true,
                data: {
                  action: "created",
                  path: "/设定/角色.md",
                  nodeId: "aux_stream",
                },
              },
            },
          ],
        },
      ],
    }) as any,
  });
  const thread = service.createProjectAssistantThread("assistant_workspace_mutation_stream");
  const emitted: Array<Record<string, unknown>> = [];

  const handle = service.sendProjectAssistantMessageStream({
    projectId: "assistant_workspace_mutation_stream",
    threadId: thread.id,
    text: "写入辅助资料",
    activeTools: [
      "read_current_writing_context",
      "read_content_subtree",
      "list_timeline_points",
      "list_aux_dir",
      "read_aux_path",
      "mkdir_aux_dir",
      "write_aux_file",
    ],
  });
  handle.subscribe((event) => {
    emitted.push(event as Record<string, unknown>);
  });

  await handle.finalResult;

  expect(emitted).toContainEqual({
    type: "workspace-mutated",
    workspaceId: workspace.id,
    area: "aux",
    timelinePointId: "origin",
    toolName: "write_aux_file",
    action: "created",
    path: "/设定/角色.md",
    nodeId: "aux_stream",
  });
});

test("sendProjectAssistantMessageStream emits workspace-mutated for mkdir_aux_dir", async () => {
  seedProject("assistant_workspace_mutation_mkdir");
  const workspace = createDefaultWorkspace("assistant_workspace_mutation_mkdir");
  const seeded = seedCustomConnection({
    connectionId: "conn_workspace_mutation_mkdir",
    modelId: "story-model",
    modelRowId: "cmodel_workspace_mutation_mkdir",
    supportsToolUse: true,
  });
  const service = createProjectAssistantService({
    readStoredSelection: () => seeded.selection,
    streamAssistantText: createMockStream({
      chunks: [
        { type: "start-step", stepNumber: 0 },
        {
          type: "tool-result",
          stepNumber: 0,
          toolResult: {
            toolCallId: "tool_mkdir_stream",
            toolName: "mkdir_aux_dir",
            output: {
              ok: true,
              data: {
                action: "created",
                path: "/设定",
                nodeId: "aux_dir_stream",
              },
            },
          },
        },
        {
          type: "finish-step",
          stepNumber: 0,
          finishReason: "stop",
          usage: { totalTokens: 2 },
        },
      ],
      text: "",
      usage: { totalTokens: 2 },
      finishReason: "stop",
      steps: [
        {
          stepNumber: 0,
          preparedMessages: [],
          model: { provider: "openai", modelId: "story-model" },
          finishReason: "stop",
          rawFinishReason: "stop",
          usage: { totalTokens: 2 },
          request: { body: { step: 0 } },
          response: { body: { id: "resp_workspace_mutation_mkdir" }, messages: [] },
          providerMetadata: {},
          toolCalls: [],
          toolResults: [
            {
              toolCallId: "tool_mkdir_stream",
              toolName: "mkdir_aux_dir",
              output: {
                ok: true,
                data: {
                  action: "created",
                  path: "/设定",
                  nodeId: "aux_dir_stream",
                },
              },
            },
          ],
        },
      ],
    }) as any,
  });
  const thread = service.createProjectAssistantThread("assistant_workspace_mutation_mkdir");
  const emitted: Array<Record<string, unknown>> = [];

  const handle = service.sendProjectAssistantMessageStream({
    projectId: "assistant_workspace_mutation_mkdir",
    threadId: thread.id,
    text: "创建辅助资料目录",
    activeTools: [
      "read_current_writing_context",
      "read_content_subtree",
      "list_timeline_points",
      "list_aux_dir",
      "read_aux_path",
      "mkdir_aux_dir",
      "write_aux_file",
    ],
  });
  handle.subscribe((event) => {
    emitted.push(event as Record<string, unknown>);
  });

  await handle.finalResult;

  expect(emitted).toContainEqual({
    type: "workspace-mutated",
    workspaceId: workspace.id,
    area: "aux",
    timelinePointId: "origin",
    toolName: "mkdir_aux_dir",
    action: "created",
    path: "/设定",
    nodeId: "aux_dir_stream",
  });
});

test("sendProjectAssistantMessageStream does not emit workspace-mutated for non-write or failed tool results", async () => {
  seedProject("assistant_workspace_mutation_filtered");
  const seeded = seedCustomConnection({
    connectionId: "conn_workspace_mutation_filtered",
    modelId: "story-model",
    modelRowId: "cmodel_workspace_mutation_filtered",
    supportsToolUse: true,
  });
  const service = createProjectAssistantService({
    readStoredSelection: () => seeded.selection,
    streamAssistantText: createMockStream({
      chunks: [
        { type: "start-step", stepNumber: 0 },
        {
          type: "tool-result",
          stepNumber: 0,
          toolResult: {
            toolCallId: "tool_read_only",
            toolName: "read_aux_path",
            output: {
              ok: true,
              data: {
                path: "/设定",
              },
            },
          },
        },
        {
          type: "tool-result",
          stepNumber: 0,
          toolResult: {
            toolCallId: "tool_failed_write",
            toolName: "write_aux_file",
            output: {
              ok: false,
              error: "写入失败",
            },
          },
        },
        {
          type: "finish-step",
          stepNumber: 0,
          finishReason: "stop",
          usage: { totalTokens: 3 },
        },
      ],
      text: "",
      usage: { totalTokens: 3 },
      finishReason: "stop",
      steps: [
        {
          stepNumber: 0,
          preparedMessages: [],
          model: { provider: "openai", modelId: "story-model" },
          finishReason: "stop",
          rawFinishReason: "stop",
          usage: { totalTokens: 3 },
          request: { body: { step: 0 } },
          response: { body: { id: "resp_workspace_mutation_filtered" }, messages: [] },
          providerMetadata: {},
          toolCalls: [],
          toolResults: [
            {
              toolCallId: "tool_read_only",
              toolName: "read_aux_path",
              output: {
                ok: true,
                data: {
                  path: "/设定",
                },
              },
            },
            {
              toolCallId: "tool_failed_write",
              toolName: "write_aux_file",
              output: {
                ok: false,
                error: "写入失败",
              },
            },
          ],
        },
      ],
    }) as any,
  });
  const thread = service.createProjectAssistantThread("assistant_workspace_mutation_filtered");
  const emitted: Array<Record<string, unknown>> = [];

  const handle = service.sendProjectAssistantMessageStream({
    projectId: "assistant_workspace_mutation_filtered",
    threadId: thread.id,
    text: "测试刷新事件",
    activeTools: [
      "read_current_writing_context",
      "read_content_subtree",
      "list_timeline_points",
      "list_aux_dir",
      "read_aux_path",
      "mkdir_aux_dir",
      "write_aux_file",
    ],
  });
  handle.subscribe((event) => {
    emitted.push(event as Record<string, unknown>);
  });

  await handle.finalResult;

  expect(emitted.some((event) => event.type === "workspace-mutated")).toBe(false);
});

test("sendProjectAssistantMessageStream keeps running after subscribers detach", async () => {
  seedProject("assistant_background");
  const seeded = seedCustomConnection({
    connectionId: "conn_background",
    modelId: "story-model",
    modelRowId: "cmodel_background",
  });
  const service = createProjectAssistantService({
    readStoredSelection: () => seeded.selection,
    streamAssistantText: createMockStream({
      chunks: [
        { type: "start-step", stepNumber: 0 },
        { type: "text-delta", stepNumber: 0, delta: "Detached reply" },
        {
          type: "finish-step",
          stepNumber: 0,
          finishReason: "stop",
          usage: { totalTokens: 7 },
        },
      ],
      text: "Detached reply",
      usage: { totalTokens: 7 },
      finishReason: "stop",
      steps: [
        {
          stepNumber: 0,
          preparedMessages: [{ role: "user", content: [{ type: "text", text: "Keep going" }] }],
          model: { provider: "openai", modelId: "story-model" },
          finishReason: "stop",
          rawFinishReason: "stop",
          usage: { totalTokens: 7 },
          request: { body: { prompt: "Keep going" } },
          response: {
            body: { id: "resp_background" },
            messages: [
              {
                role: "assistant",
                content: [{ type: "text", text: "Detached reply" }],
              },
            ],
          },
          providerMetadata: {},
          toolCalls: [],
          toolResults: [],
        },
      ],
    }) as any,
  });
  const thread = service.createProjectAssistantThread("assistant_background");

  const handle = service.sendProjectAssistantMessageStream({
    projectId: "assistant_background",
    threadId: thread.id,
    text: "Keep going",
  });
  const unsubscribe = handle.subscribe(() => {
    return;
  });
  unsubscribe();

  const result = await handle.finalResult;

  expect(result.run.status).toBe("succeeded");
  expect(result.state.activePath.map((node) => node.role)).toEqual(["user", "assistant"]);
});

test("sendProjectAssistantMessageStream relays step lifecycle events while streaming", async () => {
  seedProject("assistant_stream_steps");
  const seeded = seedCustomConnection({
    connectionId: "conn_stream_steps",
    modelId: "story-model",
    modelRowId: "cmodel_stream_steps",
  });
  const service = createProjectAssistantService({
    readStoredSelection: () => seeded.selection,
    streamAssistantText: createMockStream({
      chunks: [
        { type: "start-step", stepNumber: 0 },
        { type: "text-delta", stepNumber: 0, delta: "Streaming reply" },
        {
          type: "finish-step",
          stepNumber: 0,
          finishReason: "stop",
          usage: { totalTokens: 13 },
        },
      ],
      text: "Streaming reply",
      usage: { totalTokens: 13 },
      finishReason: "stop",
      steps: [
        {
          stepNumber: 0,
          preparedMessages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
          model: { provider: "openai", modelId: "story-model" },
          finishReason: "stop",
          rawFinishReason: "stop",
          usage: { totalTokens: 13 },
          request: { body: { prompt: "Hello" } },
          response: {
            body: { id: "resp_stream_steps" },
            messages: [
              {
                role: "assistant",
                content: [{ type: "text", text: "Streaming reply" }],
              },
            ],
          },
          providerMetadata: {},
          toolCalls: [],
          toolResults: [],
        },
      ],
    }) as any,
  });
  const thread = service.createProjectAssistantThread("assistant_stream_steps");
  const handle = service.sendProjectAssistantMessageStream({
    projectId: "assistant_stream_steps",
    threadId: thread.id,
    text: "Hello",
  });
  const emitted: Array<Record<string, unknown>> = [];
  handle.subscribe((event) => {
    emitted.push(event as Record<string, unknown>);
  });

  await handle.finalResult;

  expect(emitted.map((event) => event.type)).toEqual([
    "run-started",
    "step-started",
    "assistant-message-started",
    "assistant-text-delta",
    "step-finished",
  ]);
  expect(emitted[1]).toMatchObject({
    type: "step-started",
    stepIndex: 0,
  });
  expect(emitted[4]).toMatchObject({
    type: "step-finished",
    stepIndex: 0,
    usage: { totalTokens: 13 },
  });
});

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
                toolName: "read_aux_path",
                input: { path: "/设定" },
              },
            };
            yield {
              type: "tool-result",
              stepNumber: 0,
              toolResult: {
                toolCallId: "call_followup",
                toolName: "read_aux_path",
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
                        toolName: "read_aux_path",
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
                        toolName: "read_aux_path",
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
                  toolName: "read_aux_path",
                  input: { path: "/设定" },
                },
              ],
              toolResults: [
                {
                  toolCallId: "call_followup",
                  toolName: "read_aux_path",
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
          toolName: "read_aux_path",
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
          toolName: "read_aux_path",
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
  ]);
  expect(capturedInput.providerOptions).toMatchObject({
    openai: {
      previousResponseId: "resp_openai_first",
      reasoningSummary: "auto",
    },
  });
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

import { expect, test } from "bun:test";
import type { ModelMessage } from "ai";

import {
  createMockStream,
  createProjectAssistantService,
  createDefaultWorkspace,
  seedCustomConnection,
  seedProject,
} from "./test-helpers";

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
            toolName: "read_manuscript_node",
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
            toolName: "read_manuscript_node",
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
            toolName: "list_files",
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
            toolName: "list_files",
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
              toolName: "read_manuscript_node",
              input: {},
            },
          };
          yield {
            type: "tool-result",
            stepNumber: 0,
            toolResult: {
              toolCallId: "tool_call_context",
              toolName: "read_manuscript_node",
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
              toolName: "list_files",
              input: {},
            },
          };
          yield {
            type: "tool-result",
            stepNumber: 1,
            toolResult: {
              toolCallId: "tool_call_root",
              toolName: "list_files",
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
                toolName: "read_manuscript_node",
                input: {},
              },
            ],
            toolResults: [
              {
                toolCallId: "tool_call_context",
                toolName: "read_manuscript_node",
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
                toolName: "list_files",
                input: {},
              },
            ],
            toolResults: [
              {
                toolCallId: "tool_call_root",
                toolName: "list_files",
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

test("sendProjectAssistantMessage records tool input and output artifacts for explicit write tools", async () => {
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
            toolName: "write_file",
            input: { path: "/设定/角色.md", content: "主角：林舟" },
          },
        },
        {
          type: "tool-result",
          stepNumber: 0,
          toolResult: {
            toolCallId: "tool_write_1",
            toolName: "write_file",
            output: {
              ok: true,
              data: {
                action: "created",
                path: "/设定/角色.md",
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
                    toolName: "write_file",
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
                    toolName: "write_file",
                    output: {
                      type: "json",
                      value: {
                        ok: true,
                        data: {
                          action: "created",
                          path: "/设定/角色.md",
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
              toolName: "write_file",
              input: { path: "/设定/角色.md", content: "主角：林舟" },
            },
          ],
          toolResults: [
            {
              toolCallId: "tool_write_1",
              toolName: "write_file",
              output: {
                ok: true,
                data: {
                  action: "created",
                  path: "/设定/角色.md",
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
      "list_manuscript_nodes",
      "read_manuscript_node",
      "list_story_timeline_points",
      "list_files",
      "read_file",
      "create_dir",
      "write_file",
      "move_path",
      "create_symlink",
    ],
  });
  const trace = service.getRunTrace(result.run.id);

  expect(trace.artifacts.map((artifact) => artifact.artifactKind)).toContain("tool-input");
  expect(trace.artifacts.map((artifact) => artifact.artifactKind)).toContain("tool-output");
  expect(trace.events.some((event) => event.eventKind === "tool-call-started")).toBe(true);
  expect(trace.events.some((event) => event.eventKind === "tool-call-finished")).toBe(true);
});

test("sendProjectAssistantMessageStream emits workspace-refresh-requested for content writes", async () => {
  seedProject("assistant_workspace_refresh_content");
  const workspace = createDefaultWorkspace("assistant_workspace_refresh_content");
  const seeded = seedCustomConnection({
    connectionId: "conn_workspace_refresh_content",
    modelId: "story-model",
    modelRowId: "cmodel_workspace_refresh_content",
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
            toolCallId: "tool_content_stream",
            toolName: "update_manuscript_node",
            output: {
              ok: true,
              data: {
                action: "updated",
                nodeId: "content_stream",
                timelinePointId: "timeline_written",
              },
            },
          },
        },
        { type: "finish-step", stepNumber: 0, finishReason: "stop", usage: { totalTokens: 2 } },
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
          response: { body: { id: "resp_workspace_refresh_content" }, messages: [] },
          providerMetadata: {},
          toolCalls: [],
          toolResults: [
            {
              toolCallId: "tool_content_stream",
              toolName: "update_manuscript_node",
              output: {
                ok: true,
                data: {
                  action: "updated",
                  nodeId: "content_stream",
                  timelinePointId: "timeline_written",
                },
              },
            },
          ],
        },
      ],
    }) as any,
  });
  const thread = service.createProjectAssistantThread("assistant_workspace_refresh_content");
  const emitted: Array<Record<string, unknown>> = [];

  const handle = service.sendProjectAssistantMessageStream({
    projectId: "assistant_workspace_refresh_content",
    threadId: thread.id,
    text: "更新正文",
    activeTools: ["update_manuscript_node"],
  });
  handle.subscribe((event) => {
    emitted.push(event as Record<string, unknown>);
  });

  await handle.finalResult;

  expect(emitted.find((event) => event.type === "workspace-refresh-requested")).toMatchObject({
    type: "workspace-refresh-requested",
    workspaceId: workspace.id,
    areas: ["content"],
    contentNodeId: "content_stream",
    timelinePointId: "timeline_written",
  });
});

test("sendProjectAssistantMessageStream emits tool call streaming progress before the final tool call", async () => {
  seedProject("assistant_tool_call_streaming");
  const seeded = seedCustomConnection({
    connectionId: "conn_tool_call_streaming",
    modelId: "story-model",
    modelRowId: "cmodel_tool_call_streaming",
    supportsToolUse: true,
  });
  const service = createProjectAssistantService({
    readStoredSelection: () => seeded.selection,
    streamAssistantText: createMockStream({
      chunks: [
        { type: "start-step", stepNumber: 0 },
        {
          type: "tool-input-start",
          stepNumber: 0,
          toolCallId: "tool_stream_1",
          toolName: "write_file",
        },
        {
          type: "tool-input-delta",
          stepNumber: 0,
          toolCallId: "tool_stream_1",
          inputTextDelta: '{"path":"/设定/角色.md"',
        },
        {
          type: "tool-input-delta",
          stepNumber: 0,
          toolCallId: "tool_stream_1",
          inputTextDelta: ',"content":"主角：林舟"}',
        },
        {
          type: "tool-call",
          stepNumber: 0,
          toolCall: {
            toolCallId: "tool_stream_1",
            toolName: "write_file",
            input: {
              path: "/设定/角色.md",
              content: "主角：林舟",
            },
          },
        },
        {
          type: "tool-result",
          stepNumber: 0,
          toolResult: {
            toolCallId: "tool_stream_1",
            toolName: "write_file",
            output: {
              ok: true,
              data: {
                action: "created",
                path: "/设定/角色.md",
              },
            },
          },
        },
        { type: "finish-step", stepNumber: 0, finishReason: "stop", usage: { totalTokens: 5 } },
      ],
      text: "",
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
          request: { body: { step: 0 } },
          response: { body: { id: "resp_tool_call_streaming" }, messages: [] },
          providerMetadata: {},
          toolCalls: [
            {
              toolCallId: "tool_stream_1",
              toolName: "write_file",
              input: {
                path: "/设定/角色.md",
                content: "主角：林舟",
              },
            },
          ],
          toolResults: [
            {
              toolCallId: "tool_stream_1",
              toolName: "write_file",
              output: {
                ok: true,
                data: {
                  action: "created",
                  path: "/设定/角色.md",
                },
              },
            },
          ],
        },
      ],
    }) as any,
  });
  const thread = service.createProjectAssistantThread("assistant_tool_call_streaming");
  const emitted: Array<Record<string, unknown>> = [];

  const handle = service.sendProjectAssistantMessageStream({
    projectId: "assistant_tool_call_streaming",
    threadId: thread.id,
    text: "写入角色资料",
    activeTools: ["write_file"],
  });
  handle.subscribe((event) => {
    emitted.push(event as Record<string, unknown>);
  });

  await handle.finalResult;

  expect(emitted.map((event) => event.type)).toContain("tool-call-streaming-start");
  expect(emitted.filter((event) => event.type === "tool-call-delta")).toHaveLength(2);
  expect(emitted.find((event) => event.type === "tool-call-delta")).toMatchObject({
    type: "tool-call-delta",
    toolCallId: "tool_stream_1",
    toolName: "write_file",
    inputText: '{"path":"/设定/角色.md"',
  });
  expect(emitted.find((event) => event.type === "tool-call")).toMatchObject({
    type: "tool-call",
    toolCallId: "tool_stream_1",
    toolName: "write_file",
    input: {
      path: "/设定/角色.md",
      content: "主角：林舟",
    },
  });
});

test("sendProjectAssistantMessageStream emits workspace-refresh-requested for aux writes", async () => {
  seedProject("assistant_workspace_refresh_aux");
  const workspace = createDefaultWorkspace("assistant_workspace_refresh_aux");
  const seeded = seedCustomConnection({
    connectionId: "conn_workspace_refresh_aux",
    modelId: "story-model",
    modelRowId: "cmodel_workspace_refresh_aux",
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
            toolCallId: "tool_aux_stream",
            toolName: "write_file",
            output: {
              ok: true,
              data: {
                action: "created",
                path: "/设定/角色.md",
                timelinePointId: "timeline_written",
              },
            },
          },
        },
        { type: "finish-step", stepNumber: 0, finishReason: "stop", usage: { totalTokens: 3 } },
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
          response: { body: { id: "resp_workspace_refresh_aux" }, messages: [] },
          providerMetadata: {},
          toolCalls: [],
          toolResults: [
            {
              toolCallId: "tool_aux_stream",
              toolName: "write_file",
              output: {
                ok: true,
                data: {
                  action: "created",
                  path: "/设定/角色.md",
                  timelinePointId: "timeline_written",
                },
              },
            },
          ],
        },
      ],
    }) as any,
  });
  const thread = service.createProjectAssistantThread("assistant_workspace_refresh_aux");
  const emitted: Array<Record<string, unknown>> = [];

  const handle = service.sendProjectAssistantMessageStream({
    projectId: "assistant_workspace_refresh_aux",
    threadId: thread.id,
    text: "写入辅助资料",
    activeTools: ["write_file"],
  });
  handle.subscribe((event) => {
    emitted.push(event as Record<string, unknown>);
  });

  await handle.finalResult;

  expect(emitted.find((event) => event.type === "workspace-refresh-requested")).toMatchObject({
    type: "workspace-refresh-requested",
    workspaceId: workspace.id,
    areas: ["aux"],
    auxPath: "/设定/角色.md",
    timelinePointId: "timeline_written",
  });
});

test("sendProjectAssistantMessageStream emits timeline-selection-updated for set_current_timeline", async () => {
  seedProject("assistant_timeline_selection_event");
  const workspace = createDefaultWorkspace("assistant_timeline_selection_event");
  const seeded = seedCustomConnection({
    connectionId: "conn_timeline_selection_event",
    modelId: "story-model",
    modelRowId: "cmodel_timeline_selection_event",
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
            toolCallId: "tool_select_timeline",
            toolName: "set_current_timeline",
            output: {
              ok: true,
              data: {
                action: "selected",
                timelinePointId: "timeline_selected",
                timelineLabel: "现在",
              },
            },
          },
        },
        { type: "finish-step", stepNumber: 0, finishReason: "stop", usage: { totalTokens: 1 } },
      ],
      text: "",
      usage: { totalTokens: 1 },
      finishReason: "stop",
      steps: [
        {
          stepNumber: 0,
          preparedMessages: [],
          model: { provider: "openai", modelId: "story-model" },
          finishReason: "stop",
          rawFinishReason: "stop",
          usage: { totalTokens: 1 },
          request: { body: { step: 0 } },
          response: { body: { id: "resp_timeline_selection_event" }, messages: [] },
          providerMetadata: {},
          toolCalls: [],
          toolResults: [
            {
              toolCallId: "tool_select_timeline",
              toolName: "set_current_timeline",
              output: {
                ok: true,
                data: {
                  action: "selected",
                  timelinePointId: "timeline_selected",
                  timelineLabel: "现在",
                },
              },
            },
          ],
        },
      ],
    }) as any,
  });
  const thread = service.createProjectAssistantThread("assistant_timeline_selection_event");
  const emitted: Array<Record<string, unknown>> = [];

  const handle = service.sendProjectAssistantMessageStream({
    projectId: "assistant_timeline_selection_event",
    threadId: thread.id,
    text: "切到现在",
    activeTools: ["set_current_timeline"],
  });
  handle.subscribe((event) => {
    emitted.push(event as Record<string, unknown>);
  });

  await handle.finalResult;

  expect(emitted.find((event) => event.type === "timeline-selection-updated")).toMatchObject({
    type: "timeline-selection-updated",
    workspaceId: workspace.id,
    timelinePointId: "timeline_selected",
    timelineLabel: "现在",
  });
  expect(emitted.some((event) => event.type === "workspace-refresh-requested")).toBe(false);
});

test("sendProjectAssistantMessageStream emits workspace-refresh-requested for timeline create move delete", async () => {
  seedProject("assistant_workspace_refresh_timeline_multi");
  const workspace = createDefaultWorkspace("assistant_workspace_refresh_timeline_multi");
  const seeded = seedCustomConnection({
    connectionId: "conn_workspace_refresh_timeline_multi",
    modelId: "story-model",
    modelRowId: "cmodel_workspace_refresh_timeline_multi",
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
            toolCallId: "tool_timeline_create",
            toolName: "create_story_timeline_points",
            output: {
              ok: true,
              data: { action: "created_batch", points: [{ pointId: "point_created" }] },
            },
          },
        },
        {
          type: "tool-result",
          stepNumber: 0,
          toolResult: {
            toolCallId: "tool_timeline_move",
            toolName: "move_story_timeline_point",
            output: { ok: true, data: { action: "moved", pointId: "point_moved" } },
          },
        },
        {
          type: "tool-result",
          stepNumber: 0,
          toolResult: {
            toolCallId: "tool_timeline_delete",
            toolName: "delete_story_timeline_point",
            output: { ok: true, data: { action: "deleted", pointId: "point_deleted" } },
          },
        },
        { type: "finish-step", stepNumber: 0, finishReason: "stop", usage: { totalTokens: 4 } },
      ],
      text: "",
      usage: { totalTokens: 4 },
      finishReason: "stop",
      steps: [
        {
          stepNumber: 0,
          preparedMessages: [],
          model: { provider: "openai", modelId: "story-model" },
          finishReason: "stop",
          rawFinishReason: "stop",
          usage: { totalTokens: 4 },
          request: { body: { step: 0 } },
          response: { body: { id: "resp_workspace_refresh_timeline_multi" }, messages: [] },
          providerMetadata: {},
          toolCalls: [],
          toolResults: [
            {
              toolCallId: "tool_timeline_create",
              toolName: "create_story_timeline_points",
              output: {
                ok: true,
                data: { action: "created_batch", points: [{ pointId: "point_created" }] },
              },
            },
            {
              toolCallId: "tool_timeline_move",
              toolName: "move_story_timeline_point",
              output: { ok: true, data: { action: "moved", pointId: "point_moved" } },
            },
            {
              toolCallId: "tool_timeline_delete",
              toolName: "delete_story_timeline_point",
              output: { ok: true, data: { action: "deleted", pointId: "point_deleted" } },
            },
          ],
        },
      ],
    }) as any,
  });
  const thread = service.createProjectAssistantThread("assistant_workspace_refresh_timeline_multi");
  const emitted: Array<Record<string, unknown>> = [];

  const handle = service.sendProjectAssistantMessageStream({
    projectId: "assistant_workspace_refresh_timeline_multi",
    threadId: thread.id,
    text: "调整时间线",
    activeTools: [
      "create_story_timeline_points",
      "move_story_timeline_point",
      "delete_story_timeline_point",
    ],
  });
  handle.subscribe((event) => {
    emitted.push(event as Record<string, unknown>);
  });

  await handle.finalResult;

  expect(emitted.filter((event) => event.type === "workspace-refresh-requested")).toContainEqual({
    type: "workspace-refresh-requested",
    workspaceId: workspace.id,
    areas: ["timeline", "aux"],
  });
});

test("sendProjectAssistantMessageStream emits workspace-refresh-requested for timeline update", async () => {
  seedProject("assistant_workspace_refresh_timeline_update");
  const workspace = createDefaultWorkspace("assistant_workspace_refresh_timeline_update");
  const seeded = seedCustomConnection({
    connectionId: "conn_workspace_refresh_timeline_update",
    modelId: "story-model",
    modelRowId: "cmodel_workspace_refresh_timeline_update",
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
            toolCallId: "tool_timeline_update",
            toolName: "update_story_timeline_point",
            output: { ok: true, data: { action: "updated", pointId: "point_updated" } },
          },
        },
        { type: "finish-step", stepNumber: 0, finishReason: "stop", usage: { totalTokens: 2 } },
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
          response: { body: { id: "resp_workspace_refresh_timeline_update" }, messages: [] },
          providerMetadata: {},
          toolCalls: [],
          toolResults: [
            {
              toolCallId: "tool_timeline_update",
              toolName: "update_story_timeline_point",
              output: { ok: true, data: { action: "updated", pointId: "point_updated" } },
            },
          ],
        },
      ],
    }) as any,
  });
  const thread = service.createProjectAssistantThread(
    "assistant_workspace_refresh_timeline_update",
  );
  const emitted: Array<Record<string, unknown>> = [];

  const handle = service.sendProjectAssistantMessageStream({
    projectId: "assistant_workspace_refresh_timeline_update",
    threadId: thread.id,
    text: "更新时间点",
    activeTools: ["update_story_timeline_point"],
  });
  handle.subscribe((event) => {
    emitted.push(event as Record<string, unknown>);
  });

  await handle.finalResult;

  expect(emitted.find((event) => event.type === "workspace-refresh-requested")).toMatchObject({
    type: "workspace-refresh-requested",
    workspaceId: workspace.id,
    areas: ["timeline"],
  });
});

test("sendProjectAssistantMessageStream does not emit workspace-refresh-requested for non-write or failed tool results", async () => {
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
            toolName: "read_file",
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
            toolName: "write_file",
            output: {
              ok: false,
              error: "写入失败",
            },
          },
        },
        {
          type: "tool-result",
          stepNumber: 0,
          toolResult: {
            toolCallId: "tool_failed_move",
            toolName: "move_path",
            output: {
              ok: false,
              error: "移动失败",
            },
          },
        },
        {
          type: "finish-step",
          stepNumber: 0,
          finishReason: "stop",
          usage: { totalTokens: 4 },
        },
      ],
      text: "",
      usage: { totalTokens: 4 },
      finishReason: "stop",
      steps: [
        {
          stepNumber: 0,
          preparedMessages: [],
          model: { provider: "openai", modelId: "story-model" },
          finishReason: "stop",
          rawFinishReason: "stop",
          usage: { totalTokens: 4 },
          request: { body: { step: 0 } },
          response: { body: { id: "resp_workspace_mutation_filtered" }, messages: [] },
          providerMetadata: {},
          toolCalls: [],
          toolResults: [
            {
              toolCallId: "tool_read_only",
              toolName: "read_file",
              output: {
                ok: true,
                data: {
                  path: "/设定",
                },
              },
            },
            {
              toolCallId: "tool_failed_write",
              toolName: "write_file",
              output: {
                ok: false,
                error: "写入失败",
              },
            },
            {
              toolCallId: "tool_failed_move",
              toolName: "move_path",
              output: {
                ok: false,
                error: "移动失败",
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
      "list_manuscript_nodes",
      "read_manuscript_node",
      "list_story_timeline_points",
      "list_files",
      "read_file",
      "create_dir",
      "write_file",
      "move_path",
      "create_symlink",
    ],
  });
  handle.subscribe((event) => {
    emitted.push(event as Record<string, unknown>);
  });

  await handle.finalResult;

  expect(emitted.some((event) => event.type === "workspace-refresh-requested")).toBe(false);
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

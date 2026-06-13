import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import {
  PROJECT_ASSISTANT_MAX_STEPS,
  type ProjectAssistantToolName,
} from "@/modules/ai/domain/types";

import {
  createDeferred,
  createMockStream,
  createProjectAssistantService,
  createStepLimitMockStream,
  createDefaultWorkspace,
  db,
  logs,
  schema,
  seedCustomConnection,
  seedProject,
  workspaceDomain,
} from "./test-helpers";

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
        { type: "start-step", stepNumber: 0 },
        { type: "text-delta", stepNumber: 0, delta: "Assistant reply" },
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

test("sendProjectAssistantMessage resolves global prompt mentions into run refs and user display parts", async () => {
  seedProject("assistant_send_refs");
  const seeded = seedCustomConnection({
    connectionId: "conn_send_refs",
    modelId: "story-model",
    modelRowId: "cmodel_send_refs",
  });
  db.insert(schema.globalPrompts)
    .values({
      id: "prompt_expand",
      name: "章节扩写",
      description: "扩写当前章节",
      content: "请扩写正文，但不要改变视角。",
      isEnabled: true,
      createdAt: 100,
      updatedAt: 200,
    })
    .run();
  let capturedMessages: unknown[] = [];
  const service = createProjectAssistantService({
    readStoredSelection: () => seeded.selection,
    streamAssistantText: ((input: { messages: unknown[] }) => {
      capturedMessages = input.messages;
      return createMockStream({
        chunks: [
          { type: "start-step", stepNumber: 0 },
          { type: "text-delta", stepNumber: 0, delta: "Assistant reply" },
          { type: "finish-step", stepNumber: 0, finishReason: "stop", usage: { totalTokens: 1 } },
        ],
        text: "Assistant reply",
        usage: { totalTokens: 1 },
        finishReason: "stop",
        steps: [
          {
            stepNumber: 0,
            preparedMessages: input.messages as never,
            model: { provider: "openai", modelId: "story-model" },
            finishReason: "stop",
            rawFinishReason: "stop",
            usage: { totalTokens: 1 },
            request: { body: {} },
            response: { body: {}, messages: [] },
            providerMetadata: {},
            toolCalls: [],
            toolResults: [],
          },
        ],
      })();
    }) as any,
  });
  const thread = service.createProjectAssistantThread("assistant_send_refs");

  const result = await service.sendProjectAssistantMessage({
    projectId: "assistant_send_refs",
    threadId: thread.id,
    text: "请处理当前段落",
    mentions: [
      {
        kind: "global-prompt",
        mode: "snapshot-ref",
        targetId: "prompt_expand",
        label: "旧标签会被服务端快照覆盖",
      },
    ],
  });

  expect(result.userNode.message).toEqual({
    role: "user",
    content: [{ type: "text", text: "请处理当前段落" }],
  });
  expect(JSON.stringify(result.userNode.message)).not.toContain("请扩写正文");
  expect(capturedMessages).toEqual([
    {
      role: "user",
      content: [{ type: "text", text: "请处理当前段落" }],
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: [
            "用户通过 @ 引用了以下全局 Prompt：",
            "",
            '<global_prompt id="prompt_expand" name="章节扩写">',
            "请扩写正文，但不要改变视角。",
            "</global_prompt>",
          ].join("\n"),
        },
      ],
    },
  ]);
  expect(result.userNode.parts).toContainEqual(
    expect.objectContaining({
      partKind: "data-assistant-ref",
      payload: expect.objectContaining({
        kind: "global-prompt",
        mode: "snapshot-ref",
        label: "章节扩写",
      }),
    }),
  );
  expect(result.run.inputRefsSnapshot).toEqual([
    expect.objectContaining({
      kind: "global-prompt",
      mode: "snapshot-ref",
      label: "章节扩写",
      source: { promptId: "prompt_expand" },
      snapshot: expect.objectContaining({
        id: "prompt_expand",
        name: "章节扩写",
        description: "扩写当前章节",
        content: "请扩写正文，但不要改变视角。",
        updatedAt: 200,
      }),
    }),
  ]);
});

test("sendProjectAssistantMessage rejects disabled global prompt mentions", async () => {
  seedProject("assistant_send_disabled_refs");
  const seeded = seedCustomConnection({
    connectionId: "conn_send_disabled_refs",
    modelId: "story-model",
    modelRowId: "cmodel_send_disabled_refs",
  });
  db.insert(schema.globalPrompts)
    .values({
      id: "prompt_disabled",
      name: "已停用",
      description: null,
      content: "disabled content",
      isEnabled: false,
    })
    .run();
  const service = createProjectAssistantService({
    readStoredSelection: () => seeded.selection,
  });
  const thread = service.createProjectAssistantThread("assistant_send_disabled_refs");

  await expect(
    service.sendProjectAssistantMessage({
      projectId: "assistant_send_disabled_refs",
      threadId: thread.id,
      text: "请处理",
      mentions: [
        {
          kind: "global-prompt",
          mode: "snapshot-ref",
          targetId: "prompt_disabled",
          label: "已停用",
        },
      ],
    }),
  ).rejects.toThrow("引用的 Prompt 已被禁用。");
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
        { type: "start-step", stepNumber: 0 },
        { type: "text-delta", stepNumber: 0, delta: "Retried reply" },
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

test("retryProjectAssistantMessage reuses original prompt ref snapshots", async () => {
  seedProject("assistant_retry_refs");
  const seeded = seedCustomConnection({
    connectionId: "conn_retry_refs",
    modelId: "story-model",
    modelRowId: "cmodel_retry_refs",
  });
  db.insert(schema.globalPrompts)
    .values({
      id: "prompt_retry_refs",
      name: "重试引用",
      description: null,
      content: "旧版 Prompt 内容。",
      isEnabled: true,
      updatedAt: 100,
    })
    .run();
  const capturedMessages: unknown[][] = [];
  const service = createProjectAssistantService({
    readStoredSelection: () => seeded.selection,
    streamAssistantText: ((input: { messages: unknown[] }) => {
      capturedMessages.push(input.messages);
      return createMockStream({
        chunks: [
          { type: "start-step", stepNumber: 0 },
          { type: "text-delta", stepNumber: 0, delta: "收到。" },
          { type: "finish-step", stepNumber: 0, finishReason: "stop", usage: { totalTokens: 1 } },
        ],
        text: "收到。",
        usage: { totalTokens: 1 },
        finishReason: "stop",
        steps: [
          {
            stepNumber: 0,
            preparedMessages: input.messages as never,
            model: { provider: "openai", modelId: "story-model" },
            finishReason: "stop",
            rawFinishReason: "stop",
            usage: { totalTokens: 1 },
            request: { body: {} },
            response: {
              body: { id: `resp_retry_refs_${capturedMessages.length}` },
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
  const thread = service.createProjectAssistantThread("assistant_retry_refs");

  const first = await service.sendProjectAssistantMessage({
    projectId: "assistant_retry_refs",
    threadId: thread.id,
    text: "按这个处理",
    mentions: [
      {
        kind: "global-prompt",
        mode: "snapshot-ref",
        targetId: "prompt_retry_refs",
        label: "重试引用",
      },
    ],
  });
  db.update(schema.globalPrompts)
    .set({
      name: "重试引用新版",
      content: "新版 Prompt 内容。",
      updatedAt: 200,
    })
    .where(eq(schema.globalPrompts.id, "prompt_retry_refs"))
    .run();
  const retried = await service.retryProjectAssistantMessage({
    projectId: "assistant_retry_refs",
    threadId: thread.id,
    triggerNodeId: first.userNode.id,
  });

  expect(retried.run.inputRefsSnapshot).toEqual(first.run.inputRefsSnapshot);
  expect(JSON.stringify(capturedMessages.at(-1))).toContain("旧版 Prompt 内容。");
  expect(JSON.stringify(capturedMessages.at(-1))).not.toContain("新版 Prompt 内容。");
});

test("sendProjectAssistantMessage uses read-only tools by default and can opt into write tools", async () => {
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

  expect(capturedActiveTools).toEqual([
    [
      "list_manuscript_nodes",
      "read_manuscript_node",
      "list_story_timeline_points",
      "list_current_timeline_aux_changes",
      "set_current_timeline",
      "list_files",
      "read_file",
    ],
    [
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
  ]);
});

test("sendProjectAssistantMessage appends minimal editor context without changing user message", async () => {
  seedProject("assistant_editor_context");
  const seeded = seedCustomConnection({
    connectionId: "conn_editor_context",
    modelId: "story-model",
    modelRowId: "cmodel_editor_context",
  });
  let capturedMessages: unknown[] = [];
  const service = createProjectAssistantService({
    readStoredSelection: () => seeded.selection,
    streamAssistantText: ((input: { messages: unknown[] }) => {
      capturedMessages = input.messages;
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
            preparedMessages: input.messages as never,
            model: { provider: "openai", modelId: "story-model" },
            finishReason: "stop",
            rawFinishReason: "stop",
            usage: { totalTokens: 5 },
            request: { body: { prompt: "ok" } },
            response: {
              body: { id: "resp_editor_context" },
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
  const thread = service.createProjectAssistantThread("assistant_editor_context");

  const result = await service.sendProjectAssistantMessage({
    projectId: "assistant_editor_context",
    threadId: thread.id,
    text: "看一下当前文件",
    context: {
      workspaceId: "workspace_editor_context",
      activeContentNodeId: "content_123",
      activeContentTitle: null,
      activeAuxNodeId: null,
      activeAuxPath: null,
      activeTimelinePointId: "point_now",
      activeTimelineLabel: "现在",
    },
  });

  expect(result.userNode.message).toEqual({
    role: "user",
    content: [{ type: "text", text: "看一下当前文件" }],
  });
  expect(result.run.contextSnapshot).toMatchObject({
    activeContentNodeId: "content_123",
    activeAuxPath: null,
    activeTimelinePointId: "point_now",
    activeTimelineLabel: "现在",
  });
  expect(capturedMessages).toEqual([
    {
      role: "user",
      content: [{ type: "text", text: "看一下当前文件" }],
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "当前编辑器：正文节点 id=content_123；时间锚点 id=point_now，label=现在",
        },
      ],
    },
  ]);
});

test("step-limited tool runs are marked continueable without failing", async () => {
  seedProject("assistant_step_limit");
  const seeded = seedCustomConnection({
    connectionId: "conn_step_limit",
    modelId: "story-model",
    modelRowId: "cmodel_step_limit",
    supportsToolUse: true,
  });
  const service = createProjectAssistantService({
    readStoredSelection: () => seeded.selection,
    streamAssistantText: createStepLimitMockStream({
      modelId: "story-model",
      finalFinishReason: "tool-calls",
    }) as any,
  });
  const thread = service.createProjectAssistantThread("assistant_step_limit");

  const result = await service.sendProjectAssistantMessage({
    projectId: "assistant_step_limit",
    threadId: thread.id,
    text: "连续读取资料",
    activeTools: ["read_file"],
  });
  const summary = result.state.runSummaries.find((entry) => entry.runId === result.run.id);

  expect(result.run.status).toBe("succeeded");
  expect(result.run.activeTools).toEqual(["read_file"]);
  expect(summary).toMatchObject({
    status: "succeeded",
    stepCount: PROJECT_ASSISTANT_MAX_STEPS,
    needsContinuation: true,
    continuationReason: "step-limit",
    continuedByRunId: null,
  });
});

test("step-limited runs ending with stop are not continueable", async () => {
  seedProject("assistant_step_limit_stop");
  const seeded = seedCustomConnection({
    connectionId: "conn_step_limit_stop",
    modelId: "story-model",
    modelRowId: "cmodel_step_limit_stop",
    supportsToolUse: true,
  });
  const service = createProjectAssistantService({
    readStoredSelection: () => seeded.selection,
    streamAssistantText: createStepLimitMockStream({
      modelId: "story-model",
      finalFinishReason: "stop",
    }) as any,
  });
  const thread = service.createProjectAssistantThread("assistant_step_limit_stop");

  const result = await service.sendProjectAssistantMessage({
    projectId: "assistant_step_limit_stop",
    threadId: thread.id,
    text: "刚好二十步后完成",
    activeTools: ["read_file"],
  });
  const summary = result.state.runSummaries.find((entry) => entry.runId === result.run.id);

  expect(summary?.needsContinuation).toBe(false);
  expect(summary?.continuationReason).toBeNull();
});

test("continueProjectAssistantRun creates a child run and inherits original active tools", async () => {
  seedProject("assistant_continue");
  const seeded = seedCustomConnection({
    connectionId: "conn_continue",
    modelId: "story-model",
    modelRowId: "cmodel_continue",
    supportsToolUse: true,
  });
  const capturedActiveTools: ProjectAssistantToolName[][] = [];
  const service = createProjectAssistantService({
    readStoredSelection: () => seeded.selection,
    streamAssistantText: ((input: { activeTools: ProjectAssistantToolName[] }) => {
      capturedActiveTools.push([...input.activeTools]);
      if (capturedActiveTools.length === 1) {
        return createStepLimitMockStream({
          modelId: "story-model",
          finalFinishReason: "tool-calls",
        })();
      }
      return createMockStream({
        chunks: [
          { type: "start-step", stepNumber: 0 },
          { type: "text-delta", stepNumber: 0, delta: "继续完成。" },
          {
            type: "finish-step",
            stepNumber: 0,
            finishReason: "stop",
            usage: { totalTokens: 3 },
          },
        ],
        text: "继续完成。",
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
            response: {
              body: { id: "resp_continue" },
              messages: [
                {
                  role: "assistant",
                  content: [{ type: "text", text: "继续完成。" }],
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
  const thread = service.createProjectAssistantThread("assistant_continue");

  const first = await service.sendProjectAssistantMessage({
    projectId: "assistant_continue",
    threadId: thread.id,
    text: "继续读取",
    activeTools: ["read_file", "write_file"],
  });
  const continued = await service.continueProjectAssistantRun({
    projectId: "assistant_continue",
    threadId: thread.id,
    runId: first.run.id,
  });
  const parentSummary = continued.state.runSummaries.find((entry) => entry.runId === first.run.id);

  expect(continued.run.runMode).toBe("continue");
  expect(continued.run.parentRunId).toBe(first.run.id);
  expect(continued.run.activeTools).toEqual(["read_file", "write_file"]);
  expect(capturedActiveTools).toEqual([
    ["read_file", "write_file"],
    ["read_file", "write_file"],
  ]);
  expect(parentSummary?.needsContinuation).toBe(false);
  expect(parentSummary?.continuedByRunId).toBe(continued.run.id);
});

test("continueProjectAssistantRun inherits the updated timeline context snapshot", async () => {
  seedProject("assistant_continue_timeline_context");
  const workspace = createDefaultWorkspace("assistant_continue_timeline_context");
  const timelinePoint = workspaceDomain.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: workspaceDomain.ORIGIN_TIMELINE_POINT_ID,
    label: "现在",
  });
  const seeded = seedCustomConnection({
    connectionId: "conn_continue_timeline_context",
    modelId: "story-model",
    modelRowId: "cmodel_continue_timeline_context",
    supportsToolUse: true,
  });
  const service = createProjectAssistantService({
    readStoredSelection: () => seeded.selection,
    streamAssistantText: createStepLimitMockStream({
      modelId: "story-model",
      finalFinishReason: "tool-calls",
    }) as any,
  });
  const thread = service.createProjectAssistantThread("assistant_continue_timeline_context");

  const first = await service.sendProjectAssistantMessage({
    projectId: "assistant_continue_timeline_context",
    threadId: thread.id,
    text: "切换当前时间线并继续",
    context: {
      workspaceId: workspace.id,
      activeContentNodeId: null,
      activeContentTitle: null,
      activeAuxNodeId: null,
      activeAuxPath: null,
      activeTimelinePointId: "origin",
      activeTimelineLabel: "原点",
    },
    activeTools: ["read_file"],
  });
  logs.updateRunContextSnapshot(first.run.id, {
    workspaceId: workspace.id,
    activeContentNodeId: null,
    activeContentTitle: null,
    activeAuxNodeId: null,
    activeAuxPath: null,
    activeTimelinePointId: timelinePoint.id,
    activeTimelineLabel: timelinePoint.label,
  });
  const continued = await service.continueProjectAssistantRun({
    projectId: "assistant_continue_timeline_context",
    threadId: thread.id,
    runId: first.run.id,
  });

  const updatedParentRun = service.getRunTrace(first.run.id).run;
  expect(updatedParentRun.contextSnapshot).toMatchObject({
    activeTimelinePointId: timelinePoint.id,
    activeTimelineLabel: "现在",
  });
  expect(continued.run.contextSnapshot).toMatchObject({
    activeTimelinePointId: timelinePoint.id,
    activeTimelineLabel: "现在",
  });
});

test("continueProjectAssistantRun reuses parent prompt ref snapshots", async () => {
  seedProject("assistant_continue_refs");
  const seeded = seedCustomConnection({
    connectionId: "conn_continue_refs",
    modelId: "story-model",
    modelRowId: "cmodel_continue_refs",
    supportsToolUse: true,
  });
  db.insert(schema.globalPrompts)
    .values({
      id: "prompt_continue_refs",
      name: "继续引用",
      description: null,
      content: "继续旧版 Prompt 内容。",
      isEnabled: true,
      updatedAt: 100,
    })
    .run();
  const capturedMessages: unknown[][] = [];
  const service = createProjectAssistantService({
    readStoredSelection: () => seeded.selection,
    streamAssistantText: ((input: { messages: unknown[] }) => {
      capturedMessages.push(input.messages);
      if (capturedMessages.length === 1) {
        return createStepLimitMockStream({
          modelId: "story-model",
          finalFinishReason: "tool-calls",
        })();
      }
      return createMockStream({
        chunks: [
          { type: "start-step", stepNumber: 0 },
          { type: "text-delta", stepNumber: 0, delta: "继续完成。" },
          { type: "finish-step", stepNumber: 0, finishReason: "stop", usage: { totalTokens: 1 } },
        ],
        text: "继续完成。",
        usage: { totalTokens: 1 },
        finishReason: "stop",
        steps: [
          {
            stepNumber: 0,
            preparedMessages: input.messages as never,
            model: { provider: "openai", modelId: "story-model" },
            finishReason: "stop",
            rawFinishReason: "stop",
            usage: { totalTokens: 1 },
            request: { body: {} },
            response: {
              body: { id: "resp_continue_refs" },
              messages: [
                {
                  role: "assistant",
                  content: [{ type: "text", text: "继续完成。" }],
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
  const thread = service.createProjectAssistantThread("assistant_continue_refs");

  const first = await service.sendProjectAssistantMessage({
    projectId: "assistant_continue_refs",
    threadId: thread.id,
    text: "连续执行",
    mentions: [
      {
        kind: "global-prompt",
        mode: "snapshot-ref",
        targetId: "prompt_continue_refs",
        label: "继续引用",
      },
    ],
    activeTools: ["read_file"],
  });
  db.update(schema.globalPrompts)
    .set({
      name: "继续引用新版",
      content: "继续新版 Prompt 内容。",
      updatedAt: 200,
    })
    .where(eq(schema.globalPrompts.id, "prompt_continue_refs"))
    .run();
  const continued = await service.continueProjectAssistantRun({
    projectId: "assistant_continue_refs",
    threadId: thread.id,
    runId: first.run.id,
  });

  expect(continued.run.inputRefsSnapshot).toEqual(first.run.inputRefsSnapshot);
  expect(JSON.stringify(capturedMessages.at(-1))).toContain("继续旧版 Prompt 内容。");
  expect(JSON.stringify(capturedMessages.at(-1))).not.toContain("继续新版 Prompt 内容。");
});

test("editProjectAssistantMessage resolves edited mentions into fresh prompt ref snapshots", async () => {
  seedProject("assistant_edit_refs");
  const seeded = seedCustomConnection({
    connectionId: "conn_edit_refs",
    modelId: "story-model",
    modelRowId: "cmodel_edit_refs",
  });
  db.insert(schema.globalPrompts)
    .values([
      {
        id: "prompt_edit_old",
        name: "旧 Prompt",
        description: null,
        content: "编辑前 Prompt 内容。",
        isEnabled: true,
        updatedAt: 100,
      },
      {
        id: "prompt_edit_new",
        name: "新 Prompt",
        description: null,
        content: "编辑后 Prompt 内容。",
        isEnabled: true,
        updatedAt: 200,
      },
    ])
    .run();
  const capturedMessages: unknown[][] = [];
  const service = createProjectAssistantService({
    readStoredSelection: () => seeded.selection,
    streamAssistantText: ((input: { messages: unknown[] }) => {
      capturedMessages.push(input.messages);
      return createMockStream({
        chunks: [
          { type: "start-step", stepNumber: 0 },
          { type: "text-delta", stepNumber: 0, delta: "收到。" },
          { type: "finish-step", stepNumber: 0, finishReason: "stop", usage: { totalTokens: 1 } },
        ],
        text: "收到。",
        usage: { totalTokens: 1 },
        finishReason: "stop",
        steps: [
          {
            stepNumber: 0,
            preparedMessages: input.messages as never,
            model: { provider: "openai", modelId: "story-model" },
            finishReason: "stop",
            rawFinishReason: "stop",
            usage: { totalTokens: 1 },
            request: { body: {} },
            response: {
              body: { id: `resp_edit_refs_${capturedMessages.length}` },
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
  const thread = service.createProjectAssistantThread("assistant_edit_refs");

  const first = await service.sendProjectAssistantMessage({
    projectId: "assistant_edit_refs",
    threadId: thread.id,
    text: "按旧版本处理",
    mentions: [
      {
        kind: "global-prompt",
        mode: "snapshot-ref",
        targetId: "prompt_edit_old",
        label: "旧 Prompt",
      },
    ],
  });
  const edited = await service.editProjectAssistantMessage({
    projectId: "assistant_edit_refs",
    threadId: thread.id,
    nodeId: first.userNode.id,
    text: "按新版本处理",
    mentions: [
      {
        kind: "global-prompt",
        mode: "snapshot-ref",
        targetId: "prompt_edit_new",
        label: "新 Prompt",
      },
    ],
  });

  expect(edited.run.inputRefsSnapshot).toEqual([
    expect.objectContaining({
      source: { promptId: "prompt_edit_new" },
      snapshot: expect.objectContaining({
        content: "编辑后 Prompt 内容。",
      }),
    }),
  ]);
  expect(JSON.stringify(edited.run.inputRefsSnapshot)).not.toContain("编辑前 Prompt 内容。");
  expect(JSON.stringify(capturedMessages.at(-1))).toContain("编辑后 Prompt 内容。");
  expect(JSON.stringify(capturedMessages.at(-1))).not.toContain("编辑前 Prompt 内容。");
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
      activeTools: ["read_file"],
    }),
  ).rejects.toThrow("当前模型不支持工具调用，无法启用请求级工具。");
  expect(streamCalls).toBe(0);
});

test("cancelProjectAssistantRun aborts the active backend run and marks it cancelled", async () => {
  seedProject("assistant_cancel");
  const seeded = seedCustomConnection({
    connectionId: "conn_cancel",
    modelId: "story-model",
    modelRowId: "cmodel_cancel",
    supportsToolUse: true,
  });
  const releaseSecondStep = createDeferred<void>();
  let aborted = false;
  const service = createProjectAssistantService({
    readStoredSelection: () => seeded.selection,
    streamAssistantText: ((input: { abortSignal?: AbortSignal }) => ({
      chunks: (async function* () {
        yield { type: "start-step", stepNumber: 0 };
        yield { type: "text-delta", stepNumber: 0, delta: "先执行。" };
        yield {
          type: "finish-step",
          stepNumber: 0,
          finishReason: "tool-calls",
          usage: { totalTokens: 2 },
        };
        await Promise.race([
          releaseSecondStep.promise,
          new Promise<void>((resolve) => {
            input.abortSignal?.addEventListener(
              "abort",
              () => {
                aborted = true;
                resolve();
              },
              { once: true },
            );
          }),
        ]);
        if (input.abortSignal?.aborted) {
          throw input.abortSignal.reason ?? new Error("aborted");
        }
        yield { type: "start-step", stepNumber: 1 };
        yield { type: "text-delta", stepNumber: 1, delta: "这一步不该出现。" };
        yield {
          type: "finish-step",
          stepNumber: 1,
          finishReason: "stop",
          usage: { totalTokens: 3 },
        };
      })(),
      text: Promise.resolve("cancelled"),
      finishReason: Promise.resolve("stop"),
      usage: Promise.resolve({ totalTokens: 5 }),
      steps: Promise.resolve([
        {
          stepNumber: 0,
          preparedMessages: [],
          model: { provider: "openai", modelId: "story-model" },
          finishReason: "tool-calls",
          rawFinishReason: "tool_calls",
          usage: { totalTokens: 2 },
          request: { body: { step: 0 } },
          response: {
            body: { id: "resp_cancel_0" },
            messages: [
              {
                role: "assistant",
                content: [{ type: "text", text: "先执行。" }],
              },
            ],
          },
          providerMetadata: {},
          toolCalls: [],
          toolResults: [],
        },
      ]),
    })) as any,
  });
  const thread = service.createProjectAssistantThread("assistant_cancel");
  const handle = service.sendProjectAssistantMessageStream({
    projectId: "assistant_cancel",
    threadId: thread.id,
    text: "开始后我会取消",
    activeTools: ["read_file"],
  });

  const started = createDeferred<void>();
  handle.subscribe((event) => {
    if (event.type === "step-finished" && event.stepIndex === 0) {
      started.resolve();
    }
  });
  await started.promise;

  const runId = handle.initialResult.run.id;
  const cancelResult = service.cancelProjectAssistantRun({
    projectId: "assistant_cancel",
    threadId: thread.id,
    runId,
  });
  const result = await handle.finalResult;

  expect(cancelResult).toEqual({ runId });
  expect(aborted).toBe(true);
  expect(result.run.status).toBe("cancelled");
  expect(result.state.latestRuns[0]?.status).toBe("cancelled");
  expect(
    result.state.activePath.some((node) => node.summaryText?.includes("这一步不该出现。")),
  ).toBe(false);
});

import { expect, test } from "bun:test";

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
  logs,
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

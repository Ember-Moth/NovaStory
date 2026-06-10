import { expect, test } from "bun:test";

import { getAssistantToolTrace, listAssistantContextDetails } from "./assistantState";

test("getAssistantToolTrace merges tool call and tool result into one trace entry", () => {
  expect(
    getAssistantToolTrace(
      [
        {
          id: "node_tool",
          threadId: "thread_1",
          parentNodeId: "node_user",
          role: "assistant",
          createdByRunId: "run_1",
          sourceStepId: "step_1",
          sourceKind: "model_response",
          summaryText: "tool call",
          message: {
            role: "assistant",
            content: [{ type: "tool-call", toolCallId: "tool_1", toolName: "lookup", input: {} }],
          },
          parts: [
            {
              id: "part_1",
              nodeId: "node_tool",
              partIndex: 0,
              partKind: "tool-call",
              visibility: "internal",
              state: "done",
              providerOptions: null,
              providerMetadata: null,
              payload: {
                type: "tool-call",
                toolCallId: "tool_1",
                toolName: "lookup",
                input: {},
              },
              createdAt: 1,
            },
          ],
          createdAt: 1,
        },
        {
          id: "node_tool_result",
          threadId: "thread_1",
          parentNodeId: "node_tool",
          role: "tool",
          createdByRunId: "run_1",
          sourceStepId: "step_1",
          sourceKind: "tool_result",
          summaryText: "tool result",
          message: {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "tool_1",
                toolName: "lookup",
                output: { type: "json", value: { ok: true, data: { answer: 42 } } },
              },
            ],
          },
          parts: [
            {
              id: "part_2",
              nodeId: "node_tool_result",
              partIndex: 0,
              partKind: "tool-result",
              visibility: "internal",
              state: "done",
              providerOptions: null,
              providerMetadata: null,
              payload: {
                type: "tool-result",
                toolCallId: "tool_1",
                toolName: "lookup",
                output: { type: "json", value: { ok: true, data: { answer: 42 } } },
              },
              createdAt: 2,
            },
          ],
          createdAt: 2,
        },
      ],
      0,
    ),
  ).toEqual([
    {
      toolCallId: "tool_1",
      toolName: "lookup",
      summary: "调用 lookup",
      status: "success",
      nodeId: "node_tool",
      runId: "run_1",
      requestPayload: {},
      responsePayload: { type: "json", value: { ok: true, data: { answer: 42 } } },
    },
  ]);
});

test("getAssistantToolTrace marks tool failures from tool result payloads", () => {
  expect(
    getAssistantToolTrace(
      [
        {
          id: "node_tool",
          threadId: "thread_1",
          parentNodeId: "node_user",
          role: "assistant",
          createdByRunId: "run_1",
          sourceStepId: "step_1",
          sourceKind: "model_response",
          summaryText: "tool call",
          message: {
            role: "assistant",
            content: [{ type: "tool-call", toolCallId: "tool_1", toolName: "lookup", input: {} }],
          },
          parts: [
            {
              id: "part_1",
              nodeId: "node_tool",
              partIndex: 0,
              partKind: "tool-call",
              visibility: "internal",
              state: "done",
              providerOptions: null,
              providerMetadata: null,
              payload: {
                type: "tool-call",
                toolCallId: "tool_1",
                toolName: "lookup",
                input: {},
              },
              createdAt: 1,
            },
          ],
          createdAt: 1,
        },
        {
          id: "node_tool_result",
          threadId: "thread_1",
          parentNodeId: "node_tool",
          role: "tool",
          createdByRunId: "run_1",
          sourceStepId: "step_1",
          sourceKind: "tool_result",
          summaryText: "tool result",
          message: {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "tool_1",
                toolName: "lookup",
                output: { type: "json", value: { ok: false, error: "boom" } },
              },
            ],
          },
          parts: [
            {
              id: "part_2",
              nodeId: "node_tool_result",
              partIndex: 0,
              partKind: "tool-result",
              visibility: "internal",
              state: "done",
              providerOptions: null,
              providerMetadata: null,
              payload: {
                type: "tool-result",
                toolCallId: "tool_1",
                toolName: "lookup",
                output: { type: "json", value: { ok: false, error: "boom" } },
              },
              createdAt: 2,
            },
          ],
          createdAt: 2,
        },
      ],
      0,
    ),
  ).toEqual([
    {
      toolCallId: "tool_1",
      toolName: "lookup",
      summary: "lookup 执行失败",
      status: "error",
      nodeId: "node_tool",
      runId: "run_1",
      requestPayload: {},
      responsePayload: { type: "json", value: { ok: false, error: "boom" } },
    },
  ]);
});

test("listAssistantContextDetails formats current context chips", () => {
  expect(
    listAssistantContextDetails({
      workspaceId: "workspace_main",
      activeContentNodeId: "content_1",
      activeContentTitle: "第 1 场",
      activeAuxNodeId: "aux_1",
      activeAuxPath: "notes/scene-1.md",
      activeTimelinePointId: "timeline_now",
      activeTimelineLabel: "现在",
    }),
  ).toEqual([
    {
      label: "正文",
      value: "第 1 场",
    },
    {
      label: "辅助",
      value: "notes/scene-1.md",
    },
    {
      label: "时间",
      value: "现在",
    },
  ]);
});

import { expect, test } from "bun:test";

import {
  buildAssistantToolTraceSummary,
  getAssistantContentBlocks,
  getAssistantAskUserEntries,
  getAssistantReasoning,
  getRunSummaryByDisplayNode,
  getAssistantToolTrace,
  getUsageTotalTokens,
  listAssistantContextDetails,
  canSendAssistantMessage,
  type AssistantAskUserAnswer,
  type AssistantAskUserQuestion,
} from "./assistantState";
import type { AgentThreadNodeView } from "@/modules/ai/domain/types";

const baseNode = {
  id: "node_base",
  threadId: "thread_1",
  parentNodeId: null,
  role: "assistant",
  createdByRunId: "run_1",
  sourceStepId: "step_1",
  sourceKind: "model_response",
  summaryText: null,
  message: {
    role: "assistant",
    content: [],
  },
  parts: [],
  createdAt: 1,
} as const;

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

test("getAssistantAskUserEntries reads pending requests and submitted answers", () => {
  const askUserInput = {
    title: "确认方向",
    questions: [
      {
        id: "tone",
        prompt: "这段要偏什么语气？",
        kind: "single_choice",
        options: [
          { id: "quiet", label: "克制" },
          { id: "sharp", label: "锋利", description: "冲突更强" },
        ],
      },
      {
        id: "note",
        prompt: "还有什么必须保留？",
        kind: "free_text",
      },
    ],
  } satisfies { title: string; questions: AssistantAskUserQuestion[] };
  const answers = [
    { questionId: "tone", type: "single_choice", optionId: "sharp" },
    { questionId: "note", type: "free_text", text: "保留雨声。" },
  ] satisfies AssistantAskUserAnswer[];
  const assistantNode = {
    ...baseNode,
    id: "node_ask",
    message: {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "tool_ask",
          toolName: "ask_user",
          input: askUserInput,
        },
        {
          type: "tool-approval-request",
          approvalId: "approval_ask",
          toolCallId: "tool_ask",
        },
      ],
    },
    parts: [
      {
        id: "part_call",
        nodeId: "node_ask",
        partIndex: 0,
        partKind: "tool-call",
        visibility: "internal",
        state: "done",
        providerOptions: null,
        providerMetadata: null,
        payload: {
          type: "tool-call",
          toolCallId: "tool_ask",
          toolName: "ask_user",
          input: askUserInput,
        },
        createdAt: 1,
      },
      {
        id: "part_request",
        nodeId: "node_ask",
        partIndex: 1,
        partKind: "tool-approval-request",
        visibility: "internal",
        state: "done",
        providerOptions: null,
        providerMetadata: null,
        payload: {
          type: "tool-approval-request",
          approvalId: "approval_ask",
          toolCallId: "tool_ask",
        },
        createdAt: 1,
      },
    ],
  } as AgentThreadNodeView;
  const toolNode = {
    ...baseNode,
    id: "node_answer",
    parentNodeId: "node_ask",
    role: "tool",
    sourceKind: "tool_result",
    message: {
      role: "tool",
      content: [
        {
          type: "tool-approval-response",
          approvalId: "approval_ask",
          approved: true,
          reason: JSON.stringify({ answers }),
        },
      ],
    },
    parts: [
      {
        id: "part_response",
        nodeId: "node_answer",
        partIndex: 0,
        partKind: "tool-approval-response",
        visibility: "internal",
        state: "done",
        providerOptions: null,
        providerMetadata: null,
        payload: {
          type: "tool-approval-response",
          approvalId: "approval_ask",
          approved: true,
          reason: JSON.stringify({ answers }),
        },
        createdAt: 2,
      },
    ],
  } as AgentThreadNodeView;

  expect(getAssistantAskUserEntries([assistantNode], 0)).toEqual([
    {
      approvalId: "approval_ask",
      toolCallId: "tool_ask",
      title: "确认方向",
      questions: askUserInput.questions,
      answers: null,
    },
  ]);
  expect(getAssistantAskUserEntries([assistantNode, toolNode], 0)).toEqual([
    {
      approvalId: "approval_ask",
      toolCallId: "tool_ask",
      title: "确认方向",
      questions: askUserInput.questions,
      answers,
    },
  ]);
});

test("buildAssistantToolTraceSummary describes auxiliary file writes", () => {
  expect(
    buildAssistantToolTraceSummary({
      toolName: "write_file",
      requestPayload: {
        path: "/世界观/核心设定.md",
        content: "这段大文本不应该进入折叠摘要。",
      },
    }),
  ).toBe("写入辅助信息 /世界观/核心设定.md");
});

test("buildAssistantToolTraceSummary falls back for unknown tools", () => {
  expect(
    buildAssistantToolTraceSummary({
      toolName: "lookup",
      requestPayload: {
        query: "scene",
      },
    }),
  ).toBe("调用 lookup");
  expect(
    buildAssistantToolTraceSummary({
      toolName: "lookup",
      requestPayload: {
        query: "scene",
      },
      status: "error",
    }),
  ).toBe("lookup 执行失败");
});

test("buildAssistantToolTraceSummary prefers returned manuscript titles", () => {
  expect(
    buildAssistantToolTraceSummary({
      toolName: "read_manuscript_node",
      requestPayload: {
        nodeId: "content_123",
      },
      responsePayload: {
        ok: true,
        data: {
          node: {
            id: "content_123",
            title: "序章：倒数三秒",
            body: "正文",
            children: [],
          },
        },
      },
      status: "success",
    }),
  ).toBe("读取正文 序章：倒数三秒");

  expect(
    buildAssistantToolTraceSummary({
      toolName: "read_manuscript_node",
      requestPayload: {},
      responsePayload: {
        ok: true,
        data: {
          node: {
            id: "content_123",
            title: "当前章节",
            body: "正文",
            children: [],
          },
        },
      },
      status: "success",
    }),
  ).toBe("读取正文 当前章节");

  expect(
    buildAssistantToolTraceSummary({
      toolName: "move_manuscript_node",
      requestPayload: {
        nodeId: "content_123",
      },
      responsePayload: {
        ok: true,
        data: {
          action: "moved",
          nodeId: "content_123",
          title: "雨夜重逢",
        },
      },
      status: "success",
    }),
  ).toBe("移动正文 雨夜重逢");
});

test("buildAssistantToolTraceSummary prefers returned timeline labels", () => {
  expect(
    buildAssistantToolTraceSummary({
      toolName: "set_current_timeline",
      requestPayload: {
        timelinePointId: "timeline_123",
      },
      responsePayload: {
        ok: true,
        data: {
          action: "selected",
          timelinePointId: "timeline_123",
          timelineLabel: "第二幕",
        },
      },
      status: "success",
    }),
  ).toBe("切换时间点 第二幕");

  expect(
    buildAssistantToolTraceSummary({
      toolName: "move_story_timeline_point",
      requestPayload: {
        pointId: "timeline_123",
      },
      responsePayload: {
        ok: true,
        data: {
          action: "moved",
          pointId: "timeline_123",
          label: "第二幕",
        },
      },
      status: "success",
    }),
  ).toBe("移动时间点 第二幕");
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
      activeAuxPath: "/notes/scene-1.md",
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
      value: "/notes/scene-1.md",
    },
    {
      label: "时间",
      value: "现在",
    },
  ]);
});

test("getAssistantReasoning returns persisted reasoning parts", () => {
  expect(
    getAssistantReasoning({
      id: "node_reasoning",
      threadId: "thread_1",
      parentNodeId: "node_user",
      role: "assistant",
      createdByRunId: "run_1",
      sourceStepId: "step_1",
      sourceKind: "model_response",
      summaryText: "assistant reply",
      message: {
        role: "assistant",
        content: [
          { type: "reasoning", text: "先确认上下文。" },
          { type: "text", text: "这是最终回答。" },
        ],
      },
      parts: [
        {
          id: "part_reasoning",
          nodeId: "node_reasoning",
          partIndex: 0,
          partKind: "reasoning",
          visibility: "hidden",
          state: "done",
          providerOptions: null,
          providerMetadata: null,
          payload: {
            type: "reasoning",
            text: "先确认上下文。",
          },
          createdAt: 1,
        },
        {
          id: "part_text",
          nodeId: "node_reasoning",
          partIndex: 1,
          partKind: "text",
          visibility: "public",
          state: "done",
          providerOptions: null,
          providerMetadata: null,
          payload: {
            type: "text",
            text: "这是最终回答。",
          },
          createdAt: 1,
        },
      ],
      createdAt: 1,
    }),
  ).toEqual([
    {
      partId: "part_reasoning",
      text: "先确认上下文。",
    },
  ]);
});

test("getAssistantContentBlocks preserves reasoning and text order", () => {
  expect(
    getAssistantContentBlocks({
      id: "node_blocks",
      threadId: "thread_1",
      parentNodeId: "node_user",
      role: "assistant",
      createdByRunId: "run_1",
      sourceStepId: "step_1",
      sourceKind: "model_response",
      summaryText: "assistant reply",
      message: {
        role: "assistant",
        content: [
          { type: "reasoning", text: "先看上下文。" },
          { type: "text", text: "这是回复正文。" },
        ],
      },
      parts: [
        {
          id: "part_reasoning",
          nodeId: "node_blocks",
          partIndex: 0,
          partKind: "reasoning",
          visibility: "hidden",
          state: "done",
          providerOptions: null,
          providerMetadata: null,
          payload: {
            type: "reasoning",
            text: "先看上下文。",
          },
          createdAt: 1,
        },
        {
          id: "part_text",
          nodeId: "node_blocks",
          partIndex: 1,
          partKind: "text",
          visibility: "public",
          state: "done",
          providerOptions: null,
          providerMetadata: null,
          payload: {
            type: "text",
            text: "这是回复正文。",
          },
          createdAt: 2,
        },
      ],
      createdAt: 1,
    }),
  ).toEqual([
    {
      kind: "reasoning",
      blockId: "part_reasoning",
      text: "先看上下文。",
    },
    {
      kind: "text",
      blockId: "part_text",
      text: "这是回复正文。",
    },
  ]);
});

test("getAssistantContentBlocks preserves markdown-significant whitespace between text parts", () => {
  expect(
    getAssistantContentBlocks({
      id: "node_markdown",
      threadId: "thread_1",
      parentNodeId: "node_user",
      role: "assistant",
      createdByRunId: "run_1",
      sourceStepId: "step_1",
      sourceKind: "model_response",
      summaryText: "assistant markdown",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "```md\n# 标题" },
          { type: "text", text: "\n\n- 列表项\n```" },
        ],
      },
      parts: [
        {
          id: "part_markdown_1",
          nodeId: "node_markdown",
          partIndex: 0,
          partKind: "text",
          visibility: "public",
          state: "done",
          providerOptions: null,
          providerMetadata: null,
          payload: {
            type: "text",
            text: "```md\n# 标题",
          },
          createdAt: 1,
        },
        {
          id: "part_markdown_2",
          nodeId: "node_markdown",
          partIndex: 1,
          partKind: "text",
          visibility: "public",
          state: "done",
          providerOptions: null,
          providerMetadata: null,
          payload: {
            type: "text",
            text: "\n\n- 列表项\n```",
          },
          createdAt: 2,
        },
      ],
      createdAt: 1,
    }),
  ).toEqual([
    {
      kind: "text",
      blockId: "part_markdown_1",
      text: "```md\n# 标题\n\n\n- 列表项\n```",
    },
  ]);
});

test("getUsageTotalTokens prefers totalTokens and falls back to input/output sum", () => {
  expect(getUsageTotalTokens({ totalTokens: 12, inputTokens: 1, outputTokens: 2 })).toBe(12);
  expect(getUsageTotalTokens({ inputTokens: 4, outputTokens: 6 })).toBe(10);
  expect(getUsageTotalTokens({ inputTokens: 4 })).toBeNull();
});

test("getRunSummaryByDisplayNode returns summaries for the matched node", () => {
  expect(
    getRunSummaryByDisplayNode(
      [
        {
          runId: "run_1",
          triggerNodeId: "node_user",
          displayNodeId: "node_assistant",
          status: "succeeded",
          stepCount: 1,
          totalTokens: 8,
          durationMs: 1200,
          errorMessage: null,
        },
        {
          runId: "run_2",
          triggerNodeId: "node_user",
          displayNodeId: "node_user",
          status: "failed",
          stepCount: 0,
          totalTokens: null,
          durationMs: 300,
          errorMessage: "boom",
        },
      ],
      "node_user",
    ),
  ).toEqual([
    {
      runId: "run_2",
      triggerNodeId: "node_user",
      displayNodeId: "node_user",
      status: "failed",
      stepCount: 0,
      totalTokens: null,
      durationMs: 300,
      errorMessage: "boom",
    },
  ]);
});

test("canSendAssistantMessage allows sending before a thread exists", () => {
  expect(
    canSendAssistantMessage({
      draft: "开始新对话",
      selectedConnectionId: "connection_1",
      selectedModelId: "model_1",
      selectionHydrated: true,
      isBusy: false,
      hasPendingRun: false,
    }),
  ).toBe(true);
});

test("canSendAssistantMessage allows mention-only drafts", () => {
  expect(
    canSendAssistantMessage({
      draft: "",
      mentionCount: 1,
      selectedConnectionId: "connection_1",
      selectedModelId: "model_1",
      selectionHydrated: true,
      isBusy: false,
      hasPendingRun: false,
    }),
  ).toBe(true);
});

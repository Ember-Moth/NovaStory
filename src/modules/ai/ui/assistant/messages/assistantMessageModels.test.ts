import { expect, test } from "vitest";
import type { AgentThreadNodeView } from "@/modules/ai/domain/types";
import {
  type AssistantAskUserAnswer,
  type AssistantAskUserQuestion,
  getAssistantAskUserEntries,
} from "./askUserModel";
import {
  buildAssistantToolTraceSummary,
  buildStreamingAssistantToolTraceSummary,
  getAssistantToolTrace,
} from "./toolTraceModel";

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
      streamingInputTextRaw: null,
      streamingRequestPayload: null,
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
    ],
  } as unknown as AgentThreadNodeView;
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
          type: "tool-result",
          toolCallId: "tool_ask",
          toolName: "ask_user",
          output: {
            type: "json",
            value: {
              ok: true,
              truncated: false,
              data: {
                request: askUserInput,
                answers,
              },
            },
          },
        },
      ],
    },
    parts: [
      {
        id: "part_result",
        nodeId: "node_answer",
        partIndex: 0,
        partKind: "tool-result",
        visibility: "internal",
        state: "done",
        providerOptions: null,
        providerMetadata: null,
        payload: {
          type: "tool-result",
          toolCallId: "tool_ask",
          toolName: "ask_user",
          output: {
            type: "json",
            value: {
              ok: true,
              truncated: false,
              data: {
                request: askUserInput,
                answers,
              },
            },
          },
        },
        createdAt: 2,
      },
    ],
  } as unknown as AgentThreadNodeView;

  expect(getAssistantAskUserEntries([assistantNode], 0)).toEqual([
    {
      toolCallId: "tool_ask",
      title: "确认方向",
      questions: askUserInput.questions,
      answers: null,
    },
  ]);
  expect(getAssistantAskUserEntries([assistantNode, toolNode], 0)).toEqual([
    {
      toolCallId: "tool_ask",
      title: "确认方向",
      questions: askUserInput.questions,
      answers,
    },
  ]);
});

test("getAssistantAskUserEntries parses custom single_choice text answers", () => {
  const askUserInput = {
    title: "确认方向",
    questions: [
      {
        id: "tone",
        prompt: "这段要偏什么语气？",
        kind: "single_choice",
        options: [
          { id: "quiet", label: "克制" },
          { id: "sharp", label: "锋利" },
        ],
      },
    ],
  } satisfies { title: string; questions: AssistantAskUserQuestion[] };
  const answers = [
    { questionId: "tone", type: "single_choice", text: "更梦幻一点" },
  ] satisfies AssistantAskUserAnswer[];
  const assistantNode = {
    ...baseNode,
    id: "node_ask_custom",
    message: {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "tool_ask_custom",
          toolName: "ask_user",
          input: askUserInput,
        },
      ],
    },
    parts: [
      {
        id: "part_call_custom",
        nodeId: "node_ask_custom",
        partIndex: 0,
        partKind: "tool-call",
        visibility: "internal",
        state: "done",
        providerOptions: null,
        providerMetadata: null,
        payload: {
          type: "tool-call",
          toolCallId: "tool_ask_custom",
          toolName: "ask_user",
          input: askUserInput,
        },
        createdAt: 1,
      },
    ],
  } as unknown as AgentThreadNodeView;
  const toolNode = {
    ...baseNode,
    id: "node_answer_custom",
    parentNodeId: "node_ask_custom",
    role: "tool",
    sourceKind: "tool_result",
    message: {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "tool_ask_custom",
          toolName: "ask_user",
          output: {
            type: "json",
            value: {
              ok: true,
              truncated: false,
              data: {
                request: askUserInput,
                answers,
              },
            },
          },
        },
      ],
    },
    parts: [
      {
        id: "part_result_custom",
        nodeId: "node_answer_custom",
        partIndex: 0,
        partKind: "tool-result",
        visibility: "internal",
        state: "done",
        providerOptions: null,
        providerMetadata: null,
        payload: {
          type: "tool-result",
          toolCallId: "tool_ask_custom",
          toolName: "ask_user",
          output: {
            type: "json",
            value: {
              ok: true,
              truncated: false,
              data: {
                request: askUserInput,
                answers,
              },
            },
          },
        },
        createdAt: 2,
      },
    ],
  } as unknown as AgentThreadNodeView;

  expect(getAssistantAskUserEntries([assistantNode, toolNode], 0)).toEqual([
    {
      toolCallId: "tool_ask_custom",
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

test("buildStreamingAssistantToolTraceSummary keeps only short tool hints", () => {
  expect(
    buildStreamingAssistantToolTraceSummary({
      toolName: "write_file",
      requestPayload: {
        path: "/世界观/核心设定.md",
        content: "这段大文本不应该进入折叠摘要。",
      },
    }),
  ).toBe("正在写入辅助信息 /世界观/核心设定.md");
  expect(
    buildStreamingAssistantToolTraceSummary({
      toolName: "unknown_tool",
      requestPayload: {
        content: "很长的正文",
      },
    }),
  ).toBe("正在调用 unknown_tool");
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
      streamingInputTextRaw: null,
      streamingRequestPayload: null,
    },
  ]);
});

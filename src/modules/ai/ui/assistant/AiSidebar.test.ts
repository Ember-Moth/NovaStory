import { expect, test } from "bun:test";

import { getMessagesViewportSessionKey, shouldAnimateMessageMount } from "./AiSidebar";
import {
  applyStreamEvent,
  buildProjectAssistantRetryActiveTools,
  buildProjectAssistantSendActiveTools,
  buildSessionRows,
  createStreamOverlay,
  DEFAULT_ALLOW_WRITES_FOR_NEXT_SEND,
  resolveExpectedActiveThreadAfterArchiveToggle,
} from "./useAiAssistantController";

const baseThread = {
  projectId: "project_1",
  agentProfile: "project-assistant",
  activeTipNodeId: null,
  createdAt: 1,
  updatedAt: 1,
} as const;

test("buildSessionRows adds archived toggle and archived rows when expanded", () => {
  const rows = buildSessionRows({
    unarchivedThreads: [
      {
        ...baseThread,
        id: "thread_a",
        title: "A",
        archivedAt: null,
      },
    ],
    archivedThreads: [
      {
        ...baseThread,
        id: "thread_b",
        title: "B",
        archivedAt: 2,
      },
    ],
    showArchivedThreads: true,
  });

  expect(rows.map((row) => row.type)).toEqual(["thread", "archived-toggle", "thread"]);
});

test("resolveExpectedActiveThreadAfterArchiveToggle chooses fallback when archiving active thread", () => {
  const result = resolveExpectedActiveThreadAfterArchiveToggle({
    activeThreadId: "thread_a",
    thread: {
      ...baseThread,
      id: "thread_a",
      title: "A",
      archivedAt: null,
    },
    archived: true,
    unarchivedThreads: [
      {
        ...baseThread,
        id: "thread_a",
        title: "A",
        archivedAt: null,
      },
      {
        ...baseThread,
        id: "thread_b",
        title: "B",
        archivedAt: null,
      },
    ],
  });

  expect(result).toBe("thread_b");
});

test("applyStreamEvent updates step count as soon as a step starts", () => {
  const overlay = createStreamOverlay({
    kind: "send",
    threadId: "thread_a",
    triggerNodeId: null,
  });

  expect(
    applyStreamEvent(overlay, {
      type: "step-started",
      stepIndex: 0,
    }).stepCount,
  ).toBe(1);
});

test("applyStreamEvent accumulates usage tokens as steps finish", () => {
  const overlay = createStreamOverlay({
    kind: "send",
    threadId: "thread_a",
    triggerNodeId: null,
  });

  const afterFirstStep = applyStreamEvent(overlay, {
    type: "step-finished",
    stepIndex: 0,
    finishReason: "tool-calls",
    usage: { totalTokens: 40 },
  });
  const afterSecondStep = applyStreamEvent(afterFirstStep, {
    type: "step-finished",
    stepIndex: 1,
    finishReason: "stop",
    usage: { totalTokens: 41 },
  });

  expect(afterSecondStep.stepCount).toBe(2);
  expect(afterSecondStep.totalTokens).toBe(81);
});

test("applyStreamEvent keeps reasoning, text, and tool traces aligned in one stream block", () => {
  const overlay = createStreamOverlay({
    kind: "send",
    threadId: "thread_a",
    triggerNodeId: null,
  });

  const nextOverlay = [
    {
      type: "assistant-message-started" as const,
      nodeId: "assistant_1",
      parentNodeId: "user_1",
      stepIndex: 0,
    },
    {
      type: "assistant-reasoning-delta" as const,
      nodeId: "assistant_1",
      reasoningId: "reasoning_1",
      delta: "先检查上下文。",
      accumulatedText: "先检查上下文。",
    },
    {
      type: "assistant-text-delta" as const,
      nodeId: "assistant_1",
      delta: "最终回复",
      accumulatedText: "最终回复",
    },
    {
      type: "tool-call" as const,
      assistantNodeId: "assistant_1",
      toolCallId: "tool_1",
      toolName: "lookup",
      input: { query: "scene" },
    },
    {
      type: "tool-result" as const,
      toolNodeId: "tool_node_1",
      toolCallId: "tool_1",
      toolName: "lookup",
      output: { ok: true },
      status: "success" as const,
    },
  ].reduce(applyStreamEvent, overlay);

  expect(nextOverlay.blocks).toEqual([
    {
      assistantNodeId: "assistant_1",
      assistantText: "最终回复",
      reasoningTrace: [
        {
          reasoningId: "reasoning_1",
          text: "先检查上下文。",
        },
      ],
      contentOrder: [
        {
          kind: "reasoning",
          id: "reasoning_1",
        },
        {
          kind: "text",
          id: "text",
        },
      ],
      toolTrace: [
        {
          toolCallId: "tool_1",
          toolName: "lookup",
          status: "success",
          summary: "调用 lookup",
          nodeId: "assistant_1",
          runId: null,
          requestPayload: { query: "scene" },
          responsePayload: { ok: true },
        },
      ],
    },
  ]);
});

test("shouldAnimateMessageMount skips enter animation for streamed assistant messages", () => {
  expect(shouldAnimateMessageMount("assistant", "assistant_1", new Set(["assistant_1"]))).toBe(
    false,
  );
  expect(shouldAnimateMessageMount("assistant", "assistant_2", new Set(["assistant_1"]))).toBe(
    true,
  );
  expect(shouldAnimateMessageMount("user", "assistant_1", new Set(["assistant_1"]))).toBe(true);
});

test("getMessagesViewportSessionKey falls back for empty thread selection", () => {
  expect(getMessagesViewportSessionKey("thread_a")).toBe("thread_a");
  expect(getMessagesViewportSessionKey(null)).toBe("__empty-thread__");
});

test("buildProjectAssistantSendActiveTools adds write tools only when writes are enabled", () => {
  expect(buildProjectAssistantSendActiveTools({ allowWrites: false })).toEqual([
    "read_current_writing_context",
    "read_content_subtree",
    "list_timeline_points",
    "list_aux_dir",
    "read_aux_path",
  ]);
  expect(buildProjectAssistantSendActiveTools({ allowWrites: true })).toEqual([
    "read_current_writing_context",
    "read_content_subtree",
    "list_timeline_points",
    "list_aux_dir",
    "read_aux_path",
    "create_content_node",
    "update_content_node",
    "move_content_node",
    "delete_content_node",
    "mkdir_aux_dir",
    "write_aux_file",
    "move_aux_node",
    "delete_aux_node",
    "create_aux_symlink",
    "retarget_aux_symlink",
  ]);
});

test("project assistant send tools include writes by default", () => {
  expect(
    buildProjectAssistantSendActiveTools({
      allowWrites: DEFAULT_ALLOW_WRITES_FOR_NEXT_SEND,
    }),
  ).toContain("write_aux_file");
});

test("buildProjectAssistantRetryActiveTools stays read-only", () => {
  expect(buildProjectAssistantRetryActiveTools()).toEqual([
    "read_current_writing_context",
    "read_content_subtree",
    "list_timeline_points",
    "list_aux_dir",
    "read_aux_path",
  ]);
});

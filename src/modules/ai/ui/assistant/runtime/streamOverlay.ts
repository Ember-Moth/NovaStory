import type { ProjectAssistantStreamEvent } from "@/modules/ai/domain/types";

import {
  buildAssistantToolTraceSummary,
  buildStreamingAssistantToolTraceSummary,
  type AssistantToolTraceEntry,
} from "../messages/toolTraceModel";
import { getRunErrorMessage, getUsageTotalTokens } from "../messages/runSummaryModel";

export interface AssistantStreamOverlay {
  kind: "send" | "retry" | "continue" | "tool-input";
  threadId: string;
  triggerNodeId: string | null;
  runId: string | null;
  activeAssistantNodeId: string | null;
  startedAt: number;
  completedAt: number | null;
  status: "running" | "failed";
  stepCount: number;
  totalTokens: number | null;
  errorMessage: string | null;
  blocks: Array<{
    assistantNodeId: string;
    assistantText: string;
    reasoningTrace: Array<{
      reasoningId: string;
      text: string;
    }>;
    contentOrder: Array<
      | {
          kind: "text";
          id: "text";
        }
      | {
          kind: "reasoning";
          id: string;
        }
    >;
    toolTrace: AssistantToolTraceEntry[];
  }>;
}

export function createStreamOverlay({
  kind,
  threadId,
  triggerNodeId,
  runId = null,
}: {
  kind: "send" | "retry" | "continue" | "tool-input";
  threadId: string;
  triggerNodeId: string | null;
  runId?: string | null;
}): AssistantStreamOverlay {
  return {
    kind,
    threadId,
    triggerNodeId,
    runId,
    activeAssistantNodeId: null,
    startedAt: Date.now(),
    completedAt: null,
    status: "running",
    stepCount: 0,
    totalTokens: null,
    errorMessage: null,
    blocks: [],
  };
}

export function shouldRenderPendingStreamBlocks(
  overlay: AssistantStreamOverlay | null,
): overlay is AssistantStreamOverlay & { kind: "send" | "continue" | "tool-input" } {
  return overlay?.kind === "send" || overlay?.kind === "continue" || overlay?.kind === "tool-input";
}

function updateStreamToolTrace(
  current: AssistantToolTraceEntry[],
  event: Extract<
    ProjectAssistantStreamEvent,
    { type: "tool-call-streaming-start" | "tool-call-delta" | "tool-call" | "tool-result" }
  >,
) {
  if (event.type === "tool-call-streaming-start") {
    const index = current.findIndex(
      (entry) => entry.toolCallId === event.toolCallId || entry.toolName === event.toolName,
    );
    if (index >= 0) {
      return current.map((entry, entryIndex) =>
        entryIndex === index
          ? {
              ...entry,
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              nodeId: event.assistantNodeId,
              summary: buildStreamingAssistantToolTraceSummary({
                toolName: event.toolName,
                inputText: entry.streamingInputText ?? "",
              }),
            }
          : entry,
      );
    }

    return [
      ...current,
      {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        status: "pending" as const,
        summary: buildStreamingAssistantToolTraceSummary({
          toolName: event.toolName,
          inputText: "",
        }),
        nodeId: event.assistantNodeId,
        runId: null,
        requestPayload: null,
        responsePayload: null,
        streamingInputText: "",
      },
    ];
  }

  if (event.type === "tool-call-delta") {
    const index = current.findIndex(
      (entry) => entry.toolCallId === event.toolCallId || entry.toolName === event.toolName,
    );
    if (index < 0) {
      return current;
    }

    return current.map((entry, entryIndex) =>
      entryIndex === index
        ? {
            ...entry,
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            nodeId: event.assistantNodeId,
            summary: buildStreamingAssistantToolTraceSummary({
              toolName: event.toolName,
              inputText: event.inputText,
            }),
            streamingInputText: event.inputText,
          }
        : entry,
    );
  }

  if (event.type === "tool-call") {
    const index = current.findIndex(
      (entry) =>
        (entry.toolCallId != null &&
          event.toolCallId != null &&
          entry.toolCallId === event.toolCallId) ||
        (event.toolCallId == null &&
          entry.toolName === event.toolName &&
          entry.status === "pending"),
    );
    if (index >= 0) {
      return current.map((entry, entryIndex) =>
        entryIndex === index
          ? {
              ...entry,
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              status: "pending" as const,
              summary: buildAssistantToolTraceSummary({
                toolName: event.toolName,
                requestPayload: event.input,
              }),
              nodeId: event.assistantNodeId,
              requestPayload: event.input,
              responsePayload: null,
              streamingInputText: null,
            }
          : entry,
      );
    }

    return [
      ...current,
      {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        status: "pending" as const,
        summary: buildAssistantToolTraceSummary({
          toolName: event.toolName,
          requestPayload: event.input,
        }),
        nodeId: event.assistantNodeId,
        runId: null,
        requestPayload: event.input,
        responsePayload: null,
        streamingInputText: null,
      },
    ];
  }

  const index = current.findIndex(
    (entry) =>
      entry.toolCallId != null && event.toolCallId != null && entry.toolCallId === event.toolCallId,
  );
  if (index < 0) {
    return [
      ...current,
      {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        status: event.status,
        summary: buildAssistantToolTraceSummary({
          toolName: event.toolName,
          requestPayload: null,
          responsePayload: event.output,
          status: event.status,
        }),
        nodeId: event.toolNodeId,
        runId: null,
        requestPayload: null,
        responsePayload: event.output,
        streamingInputText: null,
      },
    ];
  }

  return current.map((entry, entryIndex) =>
    entryIndex === index
      ? {
          ...entry,
          status: event.status,
          summary: buildAssistantToolTraceSummary({
            toolName: entry.toolName,
            requestPayload: entry.requestPayload,
            responsePayload: event.output,
            status: event.status,
          }),
          responsePayload: event.output,
          streamingInputText: null,
        }
      : entry,
  );
}

function ensureStreamBlock(
  overlay: AssistantStreamOverlay,
  assistantNodeId: string,
): AssistantStreamOverlay {
  if (overlay.blocks.some((block) => block.assistantNodeId === assistantNodeId)) {
    return overlay;
  }

  return {
    ...overlay,
    blocks: [
      ...overlay.blocks,
      {
        assistantNodeId,
        assistantText: "",
        reasoningTrace: [],
        contentOrder: [],
        toolTrace: [],
      },
    ],
  };
}

export function applyStreamEvent(
  overlay: AssistantStreamOverlay,
  event: ProjectAssistantStreamEvent,
): AssistantStreamOverlay {
  if (event.type === "run-started") {
    return {
      ...overlay,
      runId: event.run.id,
      triggerNodeId: event.triggerNodeId,
    };
  }

  if (event.type === "step-started") {
    return {
      ...overlay,
      stepCount: Math.max(overlay.stepCount, event.stepIndex + 1),
    };
  }

  if (event.type === "assistant-message-started") {
    const nextOverlay = ensureStreamBlock(overlay, event.nodeId);
    return {
      ...nextOverlay,
      activeAssistantNodeId: event.nodeId,
      stepCount: Math.max(nextOverlay.stepCount, event.stepIndex + 1),
    };
  }

  if (event.type === "assistant-text-delta") {
    const nextOverlay = ensureStreamBlock(overlay, event.nodeId);
    return {
      ...nextOverlay,
      activeAssistantNodeId: event.nodeId,
      blocks: nextOverlay.blocks.map((block) =>
        block.assistantNodeId === event.nodeId
          ? {
              ...block,
              contentOrder: block.contentOrder.some((entry) => entry.kind === "text")
                ? block.contentOrder
                : [...block.contentOrder, { kind: "text", id: "text" }],
              assistantText: `${block.assistantText}${event.delta}`,
            }
          : block,
      ),
    };
  }

  if (event.type === "assistant-reasoning-delta") {
    const nextOverlay = ensureStreamBlock(overlay, event.nodeId);
    return {
      ...nextOverlay,
      activeAssistantNodeId: event.nodeId,
      blocks: nextOverlay.blocks.map((block) => {
        if (block.assistantNodeId !== event.nodeId) {
          return block;
        }

        const reasoningIndex = block.reasoningTrace.findIndex(
          (entry) => entry.reasoningId === event.reasoningId,
        );
        if (reasoningIndex < 0) {
          return {
            ...block,
            contentOrder: [...block.contentOrder, { kind: "reasoning", id: event.reasoningId }],
            reasoningTrace: [
              ...block.reasoningTrace,
              {
                reasoningId: event.reasoningId,
                text: event.accumulatedText,
              },
            ],
          };
        }

        return {
          ...block,
          reasoningTrace: block.reasoningTrace.map((entry, index) =>
            index === reasoningIndex ? { ...entry, text: event.accumulatedText } : entry,
          ),
        };
      }),
    };
  }

  if (
    event.type === "tool-call-streaming-start" ||
    event.type === "tool-call-delta" ||
    event.type === "tool-call" ||
    event.type === "tool-result"
  ) {
    const blockIndex =
      event.type === "tool-call-streaming-start" ||
      event.type === "tool-call-delta" ||
      event.type === "tool-call"
        ? overlay.blocks.findIndex((block) => block.assistantNodeId === event.assistantNodeId)
        : overlay.blocks.findIndex((block) =>
            block.toolTrace.some(
              (entry) => entry.toolCallId != null && entry.toolCallId === event.toolCallId,
            ),
          );
    const fallbackIndex = overlay.blocks.length - 1;
    const targetIndex = blockIndex >= 0 ? blockIndex : fallbackIndex;
    if (targetIndex < 0) {
      return overlay;
    }

    return {
      ...overlay,
      blocks: overlay.blocks.map((block, index) =>
        index === targetIndex
          ? { ...block, toolTrace: updateStreamToolTrace(block.toolTrace, event) }
          : block,
      ),
    };
  }

  if (event.type === "user-input-requested") {
    const nextOverlay = ensureStreamBlock(overlay, event.assistantNodeId);
    return {
      ...nextOverlay,
      activeAssistantNodeId: event.assistantNodeId,
      blocks: nextOverlay.blocks.map((block) =>
        block.assistantNodeId === event.assistantNodeId
          ? {
              ...block,
              toolTrace: [
                ...block.toolTrace,
                {
                  toolCallId: event.toolCallId,
                  toolName: event.toolName,
                  status: "pending",
                  summary: "等待回答",
                  nodeId: event.assistantNodeId,
                  runId: overlay.runId,
                  requestPayload: event.input,
                  responsePayload: null,
                },
              ],
            }
          : block,
      ),
    };
  }

  if (event.type === "step-finished") {
    const tokens = getUsageTotalTokens(event.usage);
    return {
      ...overlay,
      stepCount: Math.max(overlay.stepCount, event.stepIndex + 1),
      totalTokens: tokens == null ? overlay.totalTokens : (overlay.totalTokens ?? 0) + tokens,
    };
  }

  return overlay;
}

export function applyAssistantStreamEvent(
  current: AssistantStreamOverlay | null,
  event: ProjectAssistantStreamEvent,
) {
  return current == null ? current : applyStreamEvent(current, event);
}

export function failAssistantStreamOverlay(
  current: AssistantStreamOverlay | null,
  errorMessage: string | null | undefined,
) {
  if (current == null) {
    return current;
  }

  return {
    ...current,
    status: "failed" as const,
    completedAt: Date.now(),
    errorMessage: errorMessage || getRunErrorMessage(),
  };
}

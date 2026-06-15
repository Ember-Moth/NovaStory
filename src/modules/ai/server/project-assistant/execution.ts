import {
  appendAssistantReasoningDelta,
  appendAssistantReasoningPart,
  appendAssistantTextDelta,
  appendAssistantToolCallPart,
  assignThreadNodeSourceStepIds,
  createStreamingAssistantNode,
  createStreamingToolResultNode,
  markThreadNodePartsDone,
  selectActiveTip,
} from "@/modules/ai/domain/logs/threads";
import {
  appendRunEvent,
  createArtifact,
  createRunStep,
  markRunCancelled,
  markRunFailed,
  markRunWaitingForInput,
  markRunSucceeded,
  updateRunContextSnapshot,
} from "@/modules/ai/domain/logs/runs";
import type {
  AgentRunView,
  AgentThreadNodeView,
  ProjectAssistantStreamEvent,
  ProjectAssistantStreamToolStatus,
  ProjectAssistantWriteToolName,
  TimelineSelectionUpdatedEvent,
  WorkspaceRefreshArea,
  WorkspaceRefreshRequestedEvent,
} from "@/modules/ai/domain/types";
import { PROJECT_ASSISTANT_WRITE_TOOL_NAMES } from "@/modules/ai/domain/types";
import { getDefaultWorkspace } from "@/modules/workspace/domain";

import { ASK_USER_TOOL_NAME, normalizeAskUserInput } from "../assistant-tools/ask-user";
import { normalizeError } from "./runtime";
import type {
  GeneratedAssistantStep,
  PreparedProjectAssistantRun,
  ProjectAssistantRunHandle,
  StepRuntimeState,
  StreamAssistantTextInput,
  StreamAssistantTextResult,
} from "./types-internal";

function summarizeToolCall(toolCall: Record<string, unknown>) {
  const toolName = Reflect.get(toolCall, "toolName");
  return typeof toolName === "string" ? `调用工具：${toolName}` : "调用工具";
}

function summarizeToolResult(toolResult: Record<string, unknown>) {
  const toolName = Reflect.get(toolResult, "toolName");
  const toolCallId = Reflect.get(toolResult, "toolCallId");
  const output = Reflect.get(toolResult, "output");
  const nestedOutput =
    output && typeof output === "object"
      ? Reflect.get(output as Record<string, unknown>, "value")
      : null;
  const isError =
    (output &&
      typeof output === "object" &&
      Reflect.get(output as Record<string, unknown>, "ok") === false) ||
    (nestedOutput &&
      typeof nestedOutput === "object" &&
      Reflect.get(nestedOutput as Record<string, unknown>, "ok") === false);
  const prefix = typeof toolName === "string" ? toolName : "工具";
  const suffix = isError ? "失败" : "完成";
  const detail = typeof toolCallId === "string" ? ` (${toolCallId})` : "";
  return `${prefix}${detail}${suffix}`;
}

function getToolStatus(toolResult: Record<string, unknown>): ProjectAssistantStreamToolStatus {
  const output = Reflect.get(toolResult, "output");
  if (
    output &&
    typeof output === "object" &&
    Reflect.get(output as Record<string, unknown>, "ok") === false
  ) {
    return "error";
  }
  const value =
    output && typeof output === "object"
      ? Reflect.get(output as Record<string, unknown>, "value")
      : null;
  if (
    value &&
    typeof value === "object" &&
    Reflect.get(value as Record<string, unknown>, "ok") === false
  ) {
    return "error";
  }
  return "success";
}

function unwrapToolResultOutput(output: unknown) {
  if (!output || typeof output !== "object") {
    return null;
  }

  const value = Reflect.get(output as Record<string, unknown>, "value");
  if (value && typeof value === "object") {
    return value;
  }

  return output as Record<string, unknown>;
}

function isWriteToolName(value: unknown): value is ProjectAssistantWriteToolName {
  return (
    typeof value === "string" &&
    (PROJECT_ASSISTANT_WRITE_TOOL_NAMES as readonly string[]).includes(value)
  );
}

const CONTENT_WRITE_TOOL_NAME_SET = new Set<string>([
  "create_manuscript_node",
  "update_manuscript_node",
  "move_manuscript_node",
  "delete_manuscript_node",
]);
const CONTENT_AUTO_OPEN_TOOL_NAME_SET = new Set<string>([
  "create_manuscript_node",
  "update_manuscript_node",
]);

const AUX_WRITE_TOOL_NAME_SET = new Set<string>([
  "create_dir",
  "write_file",
  "move_path",
  "delete_path",
  "create_symlink",
  "retarget_symlink",
]);

const TIMELINE_UPDATE_TOOL_NAME = "update_story_timeline_point";
const TIMELINE_WRITE_TOOL_NAME_SET = new Set<string>([
  "create_story_timeline_points",
  TIMELINE_UPDATE_TOOL_NAME,
  "move_story_timeline_point",
  "delete_story_timeline_point",
]);

function extractWorkspaceRefreshRequestedEventFromToolResult({
  projectId,
  toolResult,
}: {
  projectId: string;
  toolResult: Record<string, unknown>;
}): WorkspaceRefreshRequestedEvent | null {
  const toolName = Reflect.get(toolResult, "toolName");
  if (!isWriteToolName(toolName)) {
    return null;
  }

  if (getToolStatus(toolResult) !== "success") {
    return null;
  }

  const workspace = getDefaultWorkspace(projectId);
  if (!workspace) {
    return null;
  }

  const output = unwrapToolResultOutput(Reflect.get(toolResult, "output"));
  if (!output || Reflect.get(output, "ok") !== true) {
    return null;
  }

  const data = Reflect.get(output, "data");
  if (!data || typeof data !== "object") {
    return null;
  }
  const record = data as Record<string, unknown>;
  const nodeId = Reflect.get(record, "nodeId");
  const outputAuxPath = Reflect.get(record, "path");
  const timelinePointId = Reflect.get(record, "timelinePointId");
  let areas: readonly WorkspaceRefreshArea[] | null = null;
  let contentNodeId: string | null | undefined;
  let auxPath: string | null | undefined;
  let refreshTimelinePointId: string | null | undefined;

  if (CONTENT_WRITE_TOOL_NAME_SET.has(toolName as string)) {
    areas = ["content"];
    contentNodeId =
      CONTENT_AUTO_OPEN_TOOL_NAME_SET.has(toolName as string) &&
      typeof nodeId === "string" &&
      nodeId.trim().length > 0
        ? nodeId
        : null;
    refreshTimelinePointId =
      CONTENT_AUTO_OPEN_TOOL_NAME_SET.has(toolName as string) &&
      typeof timelinePointId === "string" &&
      timelinePointId.trim().length > 0
        ? timelinePointId
        : null;
  } else if (AUX_WRITE_TOOL_NAME_SET.has(toolName as string)) {
    areas = ["aux"];
    auxPath =
      typeof outputAuxPath === "string" && outputAuxPath.trim().length > 0 ? outputAuxPath : null;
    refreshTimelinePointId =
      typeof timelinePointId === "string" && timelinePointId.trim().length > 0
        ? timelinePointId
        : null;
  } else if (TIMELINE_WRITE_TOOL_NAME_SET.has(toolName as string)) {
    areas = toolName === TIMELINE_UPDATE_TOOL_NAME ? ["timeline"] : ["timeline", "aux"];
  } else {
    return null;
  }

  return {
    type: "workspace-refresh-requested",
    workspaceId: workspace.id,
    areas,
    ...(contentNodeId === undefined ? {} : { contentNodeId }),
    ...(auxPath === undefined ? {} : { auxPath }),
    ...(refreshTimelinePointId === undefined ? {} : { timelinePointId: refreshTimelinePointId }),
  };
}

function extractTimelineSelectionUpdatedEventFromToolResult({
  projectId,
  toolResult,
}: {
  projectId: string;
  toolResult: Record<string, unknown>;
}): TimelineSelectionUpdatedEvent | null {
  if (Reflect.get(toolResult, "toolName") !== "set_current_timeline") {
    return null;
  }
  if (getToolStatus(toolResult) !== "success") {
    return null;
  }

  const workspace = getDefaultWorkspace(projectId);
  if (!workspace) {
    return null;
  }

  const output = unwrapToolResultOutput(Reflect.get(toolResult, "output"));
  if (!output || Reflect.get(output, "ok") !== true) {
    return null;
  }
  const data = Reflect.get(output, "data");
  if (!data || typeof data !== "object") {
    return null;
  }
  const record = data as Record<string, unknown>;
  const timelinePointId = Reflect.get(record, "timelinePointId");
  if (typeof timelinePointId !== "string" || timelinePointId.trim().length === 0) {
    return null;
  }
  const timelineLabel = Reflect.get(record, "timelineLabel");

  return {
    type: "timeline-selection-updated",
    workspaceId: workspace.id,
    timelinePointId,
    timelineLabel:
      typeof timelineLabel === "string" && timelineLabel.trim().length > 0 ? timelineLabel : null,
  };
}

export class BufferedEventRelay<TResult> implements ProjectAssistantRunHandle<TResult> {
  readonly initialResult: TResult;
  readonly finalResult: Promise<TResult>;

  private readonly history: ProjectAssistantStreamEvent[] = [];
  private readonly listeners = new Set<(_event: ProjectAssistantStreamEvent) => void>();

  constructor(initialResult: TResult, finalResult: Promise<TResult>) {
    this.initialResult = initialResult;
    this.finalResult = finalResult;
  }

  emit(event: ProjectAssistantStreamEvent) {
    this.history.push(event);
    this.listeners.forEach((listener) => listener(event));
  }

  subscribe(listener: (_event: ProjectAssistantStreamEvent) => void) {
    this.history.forEach((event) => listener(event));
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

function ensureCurrentAssistantNode({
  prepared,
  stepRuntime,
  currentParentId,
  relay,
  stepNumber,
  assistantTextByNodeId,
}: {
  prepared: PreparedProjectAssistantRun<unknown>;
  stepRuntime: StepRuntimeState;
  currentParentId: string | null;
  relay: BufferedEventRelay<unknown>;
  stepNumber: number;
  assistantTextByNodeId: Map<string, string>;
}) {
  const assistantNode = createStreamingAssistantNode({
    threadId: prepared.thread.id,
    parentNodeId: currentParentId,
    runId: prepared.run.id,
  });
  stepRuntime.nodeIds.push(assistantNode.id);
  assistantTextByNodeId.set(assistantNode.id, "");
  appendRunEvent({
    runId: prepared.run.id,
    eventKind: "node-materialized",
    nodeId: assistantNode.id,
    summaryText: assistantNode.summaryText ?? "assistant node",
  });
  relay.emit({
    type: "assistant-message-started",
    nodeId: assistantNode.id,
    parentNodeId: assistantNode.parentNodeId,
    stepIndex: stepNumber,
  });
  return assistantNode;
}

function persistStepArtifactsAndEvents({
  run,
  system,
  steps,
  stepRuntime,
  stepIndexOffset = 0,
}: {
  run: AgentRunView;
  system: string;
  steps: GeneratedAssistantStep[];
  stepRuntime: Map<number, StepRuntimeState>;
  stepIndexOffset?: number;
}) {
  for (const step of steps) {
    const stepIndex = step.stepNumber + stepIndexOffset;
    const preparedMessagesArtifact = createArtifact({
      runId: run.id,
      artifactKind: "prepared-model-messages",
      visibility: "internal",
      content: step.preparedMessages,
      summaryText: `step ${stepIndex} 输入消息`,
    });
    const responseMessagesArtifact = createArtifact({
      runId: run.id,
      artifactKind: "response-messages",
      visibility: "internal",
      content: step.response.messages,
      summaryText: `step ${stepIndex} 响应消息`,
    });
    const requestBodyArtifact = createArtifact({
      runId: run.id,
      artifactKind: "request-body",
      visibility: "internal",
      content: step.request.body ?? null,
      summaryText: `step ${stepIndex} provider request`,
    });
    const responseBodyArtifact = createArtifact({
      runId: run.id,
      artifactKind: "response-body",
      visibility: "internal",
      content: step.response.body ?? null,
      summaryText: `step ${stepIndex} provider response`,
    });
    const providerMetadataArtifact = createArtifact({
      runId: run.id,
      artifactKind: "provider-metadata",
      visibility: "internal",
      content: step.providerMetadata ?? null,
      summaryText: `step ${stepIndex} provider metadata`,
    });

    const stepRecord = createRunStep({
      runId: run.id,
      stepIndex,
      provider: step.model.provider,
      modelId: step.model.modelId,
      finishReason: step.finishReason ?? null,
      rawFinishReason: step.rawFinishReason ?? null,
      system,
      preparedMessagesArtifactId: preparedMessagesArtifact.id,
      responseMessagesArtifactId: responseMessagesArtifact.id,
      requestBodyArtifactId: requestBodyArtifact.id,
      responseBodyArtifactId: responseBodyArtifact.id,
      providerMetadataArtifactId: providerMetadataArtifact.id,
      usage: step.usage ?? null,
    });

    const runtime = stepRuntime.get(stepIndex);
    assignThreadNodeSourceStepIds(runtime?.nodeIds ?? [], stepRecord.id);

    appendRunEvent({
      runId: run.id,
      stepId: stepRecord.id,
      eventKind: "step-started",
      summaryText: `step ${stepIndex} started`,
    });
    appendRunEvent({
      runId: run.id,
      stepId: stepRecord.id,
      eventKind: "provider-requested",
      summaryText: `step ${stepIndex} provider request`,
      payloadArtifactId: requestBodyArtifact.id,
    });
    appendRunEvent({
      runId: run.id,
      stepId: stepRecord.id,
      eventKind: "provider-responded",
      summaryText: `step ${stepIndex} provider response`,
      payloadArtifactId: responseBodyArtifact.id,
    });

    for (const toolCall of runtime?.toolCalls ?? step.toolCalls) {
      const payloadArtifact = createArtifact({
        runId: run.id,
        stepId: stepRecord.id,
        artifactKind: "tool-input",
        visibility: "internal",
        content: toolCall,
        summaryText: summarizeToolCall(toolCall),
      });
      appendRunEvent({
        runId: run.id,
        stepId: stepRecord.id,
        eventKind: "tool-call-started",
        relatedToolCallId:
          typeof Reflect.get(toolCall, "toolCallId") === "string"
            ? (Reflect.get(toolCall, "toolCallId") as string)
            : null,
        summaryText: summarizeToolCall(toolCall),
        payloadArtifactId: payloadArtifact.id,
      });
    }

    for (const toolResult of runtime?.toolResults ?? step.toolResults) {
      const payloadArtifact = createArtifact({
        runId: run.id,
        stepId: stepRecord.id,
        artifactKind: "tool-output",
        visibility: "internal",
        content: toolResult,
        summaryText: summarizeToolResult(toolResult),
      });
      appendRunEvent({
        runId: run.id,
        stepId: stepRecord.id,
        eventKind:
          getToolStatus(toolResult) === "error" ? "tool-call-failed" : "tool-call-finished",
        relatedToolCallId:
          typeof Reflect.get(toolResult, "toolCallId") === "string"
            ? (Reflect.get(toolResult, "toolCallId") as string)
            : null,
        summaryText: summarizeToolResult(toolResult),
        payloadArtifactId: payloadArtifact.id,
      });
    }
  }
}

export async function executeProjectAssistantRun<TResult>({
  prepared,
  streamAssistantText,
  relay,
  abortSignal,
}: {
  prepared: PreparedProjectAssistantRun<TResult>;
  streamAssistantText: (_input: StreamAssistantTextInput) => StreamAssistantTextResult;
  relay: BufferedEventRelay<TResult>;
  abortSignal: AbortSignal;
}) {
  let currentParentId = prepared.triggerNodeId;
  let currentAssistantNode: AgentThreadNodeView | null = null;
  let lastAssistantNode: AgentThreadNodeView | null = null;
  const stepRuntime = new Map<number, StepRuntimeState>();
  const assistantTextByNodeId = new Map<string, string>();
  const reasoningPartsByStreamId = new Map<string, { nodeId: string; partIndex: number }>();
  const streamingToolInputs = new Map<
    string,
    { assistantNodeId: string; toolName: string; text: string }
  >();
  const stepIndexOffset = prepared.stepIndexOffset ?? 0;
  let pendingUserInputRequest: {
    assistantNodeId: string;
    toolCallId: string;
    input: unknown;
  } | null = null;

  const runtime = streamAssistantText({
    projectId: prepared.projectId,
    connection: prepared.selection.connection,
    modelId: prepared.selection.resolvedModel.modelId,
    system: prepared.transportSystem,
    activeTools: prepared.activeTools,
    runtimeContext: prepared.runtimeContext,
    messages: prepared.messages,
    providerOptions: prepared.providerOptions,
    abortSignal,
  });

  try {
    for await (const chunk of runtime.chunks) {
      const stepNumber = chunk.stepNumber + stepIndexOffset;
      if (!stepRuntime.has(stepNumber)) {
        stepRuntime.set(stepNumber, {
          nodeIds: [],
          toolCalls: [],
          toolResults: [],
        });
      }
      const currentStepRuntime = stepRuntime.get(stepNumber)!;

      if (chunk.type === "start-step") {
        currentAssistantNode = null;
        relay.emit({
          type: "step-started",
          stepIndex: stepNumber,
        });
        continue;
      }

      if (chunk.type === "reasoning-start") {
        if (!currentAssistantNode) {
          currentAssistantNode = ensureCurrentAssistantNode({
            prepared,
            stepRuntime: currentStepRuntime,
            currentParentId,
            relay: relay as BufferedEventRelay<unknown>,
            stepNumber,
            assistantTextByNodeId,
          });
          currentParentId = currentAssistantNode.id;
          lastAssistantNode = currentAssistantNode;
        }

        const appended = appendAssistantReasoningPart({
          nodeId: currentAssistantNode.id,
          providerMetadata: chunk.providerMetadata,
        });
        currentAssistantNode = appended.node;
        lastAssistantNode = appended.node;
        reasoningPartsByStreamId.set(chunk.id, {
          nodeId: appended.node.id,
          partIndex: appended.partIndex,
        });
        continue;
      }

      if (chunk.type === "reasoning-delta") {
        if (!currentAssistantNode) {
          currentAssistantNode = ensureCurrentAssistantNode({
            prepared,
            stepRuntime: currentStepRuntime,
            currentParentId,
            relay: relay as BufferedEventRelay<unknown>,
            stepNumber,
            assistantTextByNodeId,
          });
          currentParentId = currentAssistantNode.id;
          lastAssistantNode = currentAssistantNode;
        }

        let activeReasoning = reasoningPartsByStreamId.get(chunk.id);
        if (!activeReasoning) {
          const appended = appendAssistantReasoningPart({
            nodeId: currentAssistantNode.id,
            providerMetadata: chunk.providerMetadata,
          });
          currentAssistantNode = appended.node;
          lastAssistantNode = appended.node;
          activeReasoning = {
            nodeId: appended.node.id,
            partIndex: appended.partIndex,
          };
          reasoningPartsByStreamId.set(chunk.id, activeReasoning);
        }

        const nextAssistantNode = appendAssistantReasoningDelta({
          nodeId: activeReasoning.nodeId,
          partIndex: activeReasoning.partIndex,
          delta: chunk.delta,
          providerMetadata: chunk.providerMetadata,
        });
        currentAssistantNode = nextAssistantNode;
        lastAssistantNode = nextAssistantNode;
        const reasoningText = nextAssistantNode.parts.find(
          (part) => part.partIndex === activeReasoning.partIndex,
        )?.payload;
        const accumulatedText =
          reasoningText && typeof reasoningText === "object"
            ? String(Reflect.get(reasoningText as Record<string, unknown>, "text") ?? "")
            : chunk.delta;
        relay.emit({
          type: "assistant-reasoning-delta",
          nodeId: nextAssistantNode.id,
          reasoningId: chunk.id,
          delta: chunk.delta,
          accumulatedText,
        });
        continue;
      }

      if (chunk.type === "reasoning-end") {
        continue;
      }

      if (chunk.type === "text-delta") {
        if (!currentAssistantNode) {
          currentAssistantNode = ensureCurrentAssistantNode({
            prepared,
            stepRuntime: currentStepRuntime,
            currentParentId,
            relay: relay as BufferedEventRelay<unknown>,
            stepNumber,
            assistantTextByNodeId,
          });
          currentParentId = currentAssistantNode.id;
          lastAssistantNode = currentAssistantNode;
        }

        const nextAssistantNode = appendAssistantTextDelta({
          nodeId: currentAssistantNode.id,
          delta: chunk.delta,
        });
        currentAssistantNode = nextAssistantNode;
        lastAssistantNode = nextAssistantNode;
        const accumulatedText = `${assistantTextByNodeId.get(nextAssistantNode.id) ?? ""}${chunk.delta}`;
        assistantTextByNodeId.set(nextAssistantNode.id, accumulatedText);
        relay.emit({
          type: "assistant-text-delta",
          nodeId: nextAssistantNode.id,
          delta: chunk.delta,
          accumulatedText,
        });
        continue;
      }

      if (chunk.type === "tool-input-start") {
        if (!currentAssistantNode) {
          currentAssistantNode = ensureCurrentAssistantNode({
            prepared,
            stepRuntime: currentStepRuntime,
            currentParentId,
            relay: relay as BufferedEventRelay<unknown>,
            stepNumber,
            assistantTextByNodeId,
          });
          currentParentId = currentAssistantNode.id;
          lastAssistantNode = currentAssistantNode;
        }

        streamingToolInputs.set(chunk.toolCallId, {
          assistantNodeId: currentAssistantNode.id,
          toolName: chunk.toolName,
          text: "",
        });
        relay.emit({
          type: "tool-call-streaming-start",
          assistantNodeId: currentAssistantNode.id,
          toolCallId: chunk.toolCallId,
          toolName: chunk.toolName,
        });
        continue;
      }

      if (chunk.type === "tool-input-delta") {
        const currentStreaming = streamingToolInputs.get(chunk.toolCallId);
        if (!currentStreaming) {
          continue;
        }

        currentStreaming.text = `${currentStreaming.text}${chunk.inputTextDelta}`;
        relay.emit({
          type: "tool-call-delta",
          assistantNodeId: currentStreaming.assistantNodeId,
          toolCallId: chunk.toolCallId,
          toolName: currentStreaming.toolName,
          inputTextDelta: chunk.inputTextDelta,
          inputText: currentStreaming.text,
        });
        continue;
      }

      if (chunk.type === "tool-call") {
        const toolCallId =
          typeof Reflect.get(chunk.toolCall, "toolCallId") === "string"
            ? (Reflect.get(chunk.toolCall, "toolCallId") as string)
            : null;
        const toolName =
          typeof Reflect.get(chunk.toolCall, "toolName") === "string"
            ? (Reflect.get(chunk.toolCall, "toolName") as string)
            : "tool";

        if (pendingUserInputRequest) {
          throw new Error("提问工具正在等待用户回答，不能继续调用其他工具。");
        }

        if (!currentAssistantNode) {
          currentAssistantNode = ensureCurrentAssistantNode({
            prepared,
            stepRuntime: currentStepRuntime,
            currentParentId,
            relay: relay as BufferedEventRelay<unknown>,
            stepNumber,
            assistantTextByNodeId,
          });
          currentParentId = currentAssistantNode.id;
          lastAssistantNode = currentAssistantNode;
        }

        if (toolName === ASK_USER_TOOL_NAME) {
          if (!toolCallId) {
            throw new Error("提问工具缺少 toolCallId。");
          }
          if (
            currentStepRuntime.toolCalls.length > 0 ||
            currentStepRuntime.toolResults.length > 0
          ) {
            throw new Error("提问工具必须单独调用；请把问题合并到一次 ask_user 调用。");
          }
          const request = normalizeAskUserInput(Reflect.get(chunk.toolCall, "input"));
          appendAssistantToolCallPart({
            nodeId: currentAssistantNode.id,
            toolCall: chunk.toolCall,
          });
          currentStepRuntime.toolCalls.push(chunk.toolCall);
          pendingUserInputRequest = {
            assistantNodeId: currentAssistantNode.id,
            toolCallId,
            input: request,
          };
          const payloadArtifact = createArtifact({
            runId: prepared.run.id,
            artifactKind: "tool-input",
            visibility: "internal",
            content: chunk.toolCall,
            summaryText: "等待用户回答",
          });
          appendRunEvent({
            runId: prepared.run.id,
            eventKind: "user-input-requested",
            nodeId: currentAssistantNode.id,
            relatedToolCallId: toolCallId,
            summaryText: "等待用户回答",
            payloadArtifactId: payloadArtifact.id,
          });
          relay.emit({
            type: "tool-call",
            assistantNodeId: currentAssistantNode.id,
            toolCallId,
            toolName,
            input: request,
          });
          relay.emit({
            type: "user-input-requested",
            assistantNodeId: currentAssistantNode.id,
            toolCallId,
            toolName: ASK_USER_TOOL_NAME,
            input: request,
          });
          continue;
        }

        appendAssistantToolCallPart({
          nodeId: currentAssistantNode.id,
          toolCall: chunk.toolCall,
        });
        currentStepRuntime.toolCalls.push(chunk.toolCall);
        if (toolCallId) {
          streamingToolInputs.delete(toolCallId);
        }
        relay.emit({
          type: "tool-call",
          assistantNodeId: currentAssistantNode.id,
          toolCallId,
          toolName,
          input: Reflect.get(chunk.toolCall, "input") ?? null,
        });
        continue;
      }

      if (chunk.type === "tool-approval-request") {
        throw new Error("当前项目助手不支持工具审批请求。");
      }

      if (chunk.type === "tool-result") {
        if (pendingUserInputRequest) {
          throw new Error("提问工具正在等待用户回答，不能继续接收其他工具结果。");
        }
        const toolNode = createStreamingToolResultNode({
          threadId: prepared.thread.id,
          parentNodeId: currentParentId,
          runId: prepared.run.id,
          toolResult: chunk.toolResult,
        });
        currentParentId = toolNode.id;
        currentStepRuntime.nodeIds.push(toolNode.id);
        currentStepRuntime.toolResults.push(chunk.toolResult);
        appendRunEvent({
          runId: prepared.run.id,
          eventKind: "node-materialized",
          nodeId: toolNode.id,
          summaryText: toolNode.summaryText ?? "tool node",
        });
        relay.emit({
          type: "tool-result",
          toolNodeId: toolNode.id,
          toolCallId:
            typeof Reflect.get(chunk.toolResult, "toolCallId") === "string"
              ? (Reflect.get(chunk.toolResult, "toolCallId") as string)
              : null,
          toolName:
            typeof Reflect.get(chunk.toolResult, "toolName") === "string"
              ? (Reflect.get(chunk.toolResult, "toolName") as string)
              : "tool",
          output: Reflect.get(chunk.toolResult, "output") ?? null,
          status: getToolStatus(chunk.toolResult),
        });
        const workspaceRefreshRequestedEvent = extractWorkspaceRefreshRequestedEventFromToolResult({
          projectId: prepared.projectId,
          toolResult: chunk.toolResult,
        });
        if (workspaceRefreshRequestedEvent) {
          relay.emit(workspaceRefreshRequestedEvent);
        }
        const timelineSelectionUpdatedEvent = extractTimelineSelectionUpdatedEventFromToolResult({
          projectId: prepared.projectId,
          toolResult: chunk.toolResult,
        });
        if (timelineSelectionUpdatedEvent) {
          relay.emit(timelineSelectionUpdatedEvent);
          updateRunContextSnapshot(prepared.run.id, prepared.runtimeContext.snapshot);
        }
        continue;
      }

      if (chunk.type === "finish-step") {
        if (currentAssistantNode) {
          currentAssistantNode = markThreadNodePartsDone(currentAssistantNode.id);
          lastAssistantNode = currentAssistantNode;
        }
        relay.emit({
          type: "step-finished",
          stepIndex: stepNumber,
          finishReason: chunk.finishReason,
          usage: chunk.usage,
        });
      }
    }

    const steps = await runtime.steps;
    persistStepArtifactsAndEvents({
      run: prepared.run,
      system: prepared.system,
      steps,
      stepRuntime,
      stepIndexOffset,
    });

    if (currentParentId) {
      selectActiveTip(prepared.thread.id, currentParentId);
      appendRunEvent({
        runId: prepared.run.id,
        eventKind: "active-tip-moved",
        nodeId: currentParentId,
        summaryText: "切换到新的 active tip",
      });
    }

    if (pendingUserInputRequest) {
      const waitingRun = markRunWaitingForInput(prepared.run.id);
      return prepared.buildFinalResult({
        run: waitingRun,
        lastAssistantNode,
      });
    }

    const completedRun = markRunSucceeded(prepared.run.id);
    appendRunEvent({
      runId: prepared.run.id,
      eventKind: "run-succeeded",
      summaryText: completedRun.completedAt ? "run succeeded" : "run completed",
    });

    return prepared.buildFinalResult({
      run: completedRun,
      lastAssistantNode,
    });
  } catch (error) {
    if (abortSignal.aborted) {
      if (currentAssistantNode) {
        currentAssistantNode = markThreadNodePartsDone(currentAssistantNode.id);
        lastAssistantNode = currentAssistantNode;
      }
      const cancelledRun = markRunCancelled(prepared.run.id);
      return prepared.buildFinalResult({
        run: cancelledRun,
        lastAssistantNode,
      });
    }

    const errorArtifact = createArtifact({
      runId: prepared.run.id,
      artifactKind: "error",
      visibility: "internal",
      content: normalizeError(error),
      summaryText: error instanceof Error ? error.message : "run failed",
    });
    const failedRun = markRunFailed(prepared.run.id, errorArtifact.id);
    appendRunEvent({
      runId: failedRun.id,
      eventKind: "run-failed",
      nodeId: prepared.triggerNodeId,
      summaryText: error instanceof Error ? error.message : "run failed",
      payloadArtifactId: errorArtifact.id,
    });
    throw error;
  }
}

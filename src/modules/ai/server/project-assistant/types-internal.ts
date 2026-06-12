import { type ModelMessage, streamText } from "ai";

import type {
  AgentRunView,
  AgentThreadView,
  AgentThreadNodeView,
  AiConnectionRow,
  AiResolvedModelView,
  AiSelectionSnapshotInput,
  ProjectAssistantContextSnapshot,
  ProjectAssistantStreamEvent,
  ProjectAssistantToolName,
} from "@/modules/ai/domain/types";
import type { AiAssistantModelSelection } from "@/modules/config/domain/ai-assistant-model-selection";

import type { ToolRuntimeContext } from "../assistant-tools/context";

export interface AssistantModelSelection {
  storedSelection: AiAssistantModelSelection;
  connection: AiConnectionRow;
  resolvedModel: AiResolvedModelView;
  snapshot: AiSelectionSnapshotInput;
}

export type StreamProviderOptions = Parameters<typeof streamText>[0]["providerOptions"];

export interface StreamAssistantTextInput {
  projectId: string;
  connection: AiConnectionRow;
  modelId: string;
  system: string | null;
  activeTools: readonly ProjectAssistantToolName[];
  runtimeContext: ToolRuntimeContext;
  messages: ModelMessage[];
  providerOptions?: StreamProviderOptions;
  abortSignal?: AbortSignal;
}

export interface GeneratedAssistantStep {
  stepNumber: number;
  preparedMessages: ModelMessage[];
  model: {
    provider: string;
    modelId: string;
  };
  finishReason: string | undefined;
  rawFinishReason: string | undefined;
  usage: unknown;
  request: {
    body?: unknown;
  };
  response: {
    body?: unknown;
    messages: ModelMessage[];
  };
  providerMetadata: unknown;
  toolCalls: Array<Record<string, unknown>>;
  toolResults: Array<Record<string, unknown>>;
}

export type GeneratedAssistantChunk =
  | {
      type: "start-step";
      stepNumber: number;
    }
  | {
      type: "reasoning-start";
      stepNumber: number;
      id: string;
      providerMetadata: unknown;
    }
  | {
      type: "reasoning-delta";
      stepNumber: number;
      id: string;
      delta: string;
      providerMetadata: unknown;
    }
  | {
      type: "reasoning-end";
      stepNumber: number;
      id: string;
      providerMetadata: unknown;
    }
  | {
      type: "text-delta";
      stepNumber: number;
      delta: string;
    }
  | {
      type: "tool-call";
      stepNumber: number;
      toolCall: Record<string, unknown>;
    }
  | {
      type: "tool-result";
      stepNumber: number;
      toolResult: Record<string, unknown>;
    }
  | {
      type: "finish-step";
      stepNumber: number;
      finishReason: string | undefined;
      usage: unknown;
    };

export interface StreamAssistantTextResult {
  chunks: AsyncIterable<GeneratedAssistantChunk>;
  text: Promise<string>;
  finishReason: Promise<string | undefined>;
  usage: Promise<unknown>;
  steps: Promise<GeneratedAssistantStep[]>;
}

export interface ProjectAssistantDependencies {
  streamAssistantText: (_input: StreamAssistantTextInput) => StreamAssistantTextResult;
  readStoredSelection: () => AiAssistantModelSelection | null;
}

export interface StepRuntimeState {
  nodeIds: string[];
  toolCalls: Array<Record<string, unknown>>;
  toolResults: Array<Record<string, unknown>>;
}

export interface PreparedProjectAssistantRun<TResult> {
  projectId: string;
  thread: AgentThreadView;
  run: AgentRunView;
  triggerNodeId: string;
  messages: ModelMessage[];
  providerOptions?: StreamProviderOptions;
  system: string;
  transportSystem: string | null;
  selection: AssistantModelSelection;
  context: ProjectAssistantContextSnapshot | null;
  runtimeContext: ToolRuntimeContext;
  activeTools: ProjectAssistantToolName[];
  initialResult: TResult;
  runStartedEvent: ProjectAssistantStreamEvent;
  buildFinalResult: (_input: {
    run: AgentRunView;
    lastAssistantNode: AgentThreadNodeView | null;
  }) => TResult;
}

export interface ProjectAssistantRunHandle<TResult> {
  initialResult: TResult;
  finalResult: Promise<TResult>;
  subscribe: (_listener: (_event: ProjectAssistantStreamEvent) => void) => () => void;
}

export interface ActiveExecutionHandle {
  abortController: AbortController;
}

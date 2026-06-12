import type { InferSelectModel } from "drizzle-orm";

import type { ModelMessage } from "ai";

import type { schema } from "@/db";

export type AiCatalogProviderRow = InferSelectModel<typeof schema.aiCatalogProviders>;
export type AiCatalogModelRow = InferSelectModel<typeof schema.aiCatalogModels>;
export type AiConnectionRow = InferSelectModel<typeof schema.aiConnections>;
export type AiConnectionCatalogOverrideRow = InferSelectModel<
  typeof schema.aiConnectionCatalogOverrides
>;
export type AiConnectionCustomModelRow = InferSelectModel<typeof schema.aiConnectionCustomModels>;
export type AiRegistryStateRow = InferSelectModel<typeof schema.aiRegistryState>;
export type AgentThreadRow = InferSelectModel<typeof schema.agentThreads>;
export type AgentProjectStateRow = InferSelectModel<typeof schema.agentProjectState>;
export type AgentThreadNodeRow = InferSelectModel<typeof schema.agentThreadNodes>;
export type AgentThreadNodePartRow = InferSelectModel<typeof schema.agentThreadNodeParts>;
export type AgentRunRow = InferSelectModel<typeof schema.agentRuns>;
export type AgentRunStepRow = InferSelectModel<typeof schema.agentRunSteps>;
export type AgentRunEventRow = InferSelectModel<typeof schema.agentRunEvents>;
export type AgentArtifactRow = InferSelectModel<typeof schema.agentArtifacts>;

export type AgentThreadRole = "system" | "user" | "assistant" | "tool";
export type AgentThreadNodeSourceKind =
  | "user_input"
  | "model_response"
  | "tool_result"
  | "system_seed"
  | "edit_rewrite";
export type AgentThreadNodePartKind =
  | "text"
  | "reasoning"
  | "tool-call"
  | "tool-result"
  | "tool-error"
  | "file"
  | "source-url"
  | "source-document"
  | "data"
  | "step-start";
export type AgentVisibility = "public" | "hidden" | "internal";
export type AgentPartState = "streaming" | "done";
export type AgentRunMode =
  | "send"
  | "retry"
  | "regenerate"
  | "edit_regenerate"
  | "continue"
  | "subagent";
export type AgentRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type AgentContinuationReason = "step-limit";
export type AgentRunEventKind =
  | "run-started"
  | "step-started"
  | "provider-requested"
  | "provider-responded"
  | "tool-call-started"
  | "tool-call-finished"
  | "tool-call-failed"
  | "node-materialized"
  | "active-tip-moved"
  | "child-run-started"
  | "run-failed"
  | "run-succeeded";
export type AgentArtifactKind =
  | "prepared-model-messages"
  | "response-messages"
  | "request-body"
  | "response-body"
  | "provider-metadata"
  | "tool-input"
  | "tool-output"
  | "reasoning-raw"
  | "ui-projection"
  | "error";
export type AiSelectionSnapshotOrigin = "catalog" | "custom";
export type AgentToolTraceStatus = "success" | "error";
export type ProjectAssistantStreamToolStatus = AgentToolTraceStatus;

export const PROJECT_ASSISTANT_READ_ONLY_TOOL_NAMES = [
  "get_writing_context",
  "get_manuscript_subtree",
  "list_story_timeline_points",
  "list_reference_overlay_dir",
  "read_reference_overlay_path",
] as const;

export const PROJECT_ASSISTANT_WRITE_TOOL_NAMES = [
  "create_manuscript_node",
  "update_manuscript_node",
  "move_manuscript_node",
  "delete_manuscript_node",
  "create_story_timeline_point",
  "update_story_timeline_point",
  "move_story_timeline_point",
  "delete_story_timeline_point",
  "create_reference_overlay_dir",
  "write_reference_overlay_file",
  "move_reference_overlay_node",
  "delete_reference_overlay_node",
  "create_reference_overlay_link",
  "retarget_reference_overlay_link",
] as const;

export const PROJECT_ASSISTANT_TOOL_NAMES = [
  ...PROJECT_ASSISTANT_READ_ONLY_TOOL_NAMES,
  ...PROJECT_ASSISTANT_WRITE_TOOL_NAMES,
] as const;

export const PROJECT_ASSISTANT_MAX_STEPS = 20;

export type ProjectAssistantToolName = (typeof PROJECT_ASSISTANT_TOOL_NAMES)[number];
export type ProjectAssistantWriteToolName = (typeof PROJECT_ASSISTANT_WRITE_TOOL_NAMES)[number];
export type WorkspaceRefreshArea = "content" | "aux" | "timeline";

export interface ProjectAssistantContextSnapshot {
  workspaceId: string | null;
  activeContentNodeId: string | null;
  activeContentTitle: string | null;
  activeAuxNodeId: string | null;
  activeAuxPath: string | null;
  activeTimelinePointId: string | null;
  activeTimelineLabel: string | null;
}

export interface AgentToolSummaryEntry {
  toolCallId: string | null;
  toolName: string;
  status: AgentToolTraceStatus;
  summary: string;
  nodeId: string;
  runId: string | null;
}

export interface AiSelectionCapabilitySnapshot {
  supportsVision: boolean;
  supportsToolUse: boolean;
  supportsReasoning: boolean;
  supportsTemperature: boolean;
}

export interface AiSelectionPricingSnapshot {
  inputPricePer1m: number | null;
  outputPricePer1m: number | null;
}

export interface AiSelectionSnapshotInput {
  connectionId?: string | null;
  catalogModelId?: string | null;
  customModelId?: string | null;
  connectionName?: string | null;
  sdkPackage?: string | null;
  baseUrl?: string | null;
  modelOrigin?: AiSelectionSnapshotOrigin | null;
  modelId?: string | null;
  modelDisplayName?: string | null;
  modelFamily?: string | null;
  capabilities?: Partial<AiSelectionCapabilitySnapshot> | null;
  pricing?: Partial<AiSelectionPricingSnapshot> | null;
}

export interface AiSelectionSnapshotView {
  connectionId: string | null;
  catalogModelId: string | null;
  customModelId: string | null;
  connectionName: string | null;
  sdkPackage: string | null;
  baseUrl: string | null;
  modelOrigin: AiSelectionSnapshotOrigin | null;
  modelId: string | null;
  modelDisplayName: string | null;
  modelFamily: string | null;
  capabilities: AiSelectionCapabilitySnapshot | null;
  pricing: AiSelectionPricingSnapshot | null;
}

export interface AgentThreadView {
  id: string;
  projectId: string;
  agentProfile: string;
  title: string;
  activeTipNodeId: string | null;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface AgentProjectStateView {
  id: string;
  projectId: string;
  agentProfile: string;
  activeThreadId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AgentThreadNodePartView {
  id: string;
  nodeId: string;
  partIndex: number;
  partKind: AgentThreadNodePartKind;
  visibility: AgentVisibility;
  state: AgentPartState;
  providerOptions: unknown | null;
  providerMetadata: unknown | null;
  payload: unknown;
  createdAt: number;
}

export interface AgentThreadNodeView {
  id: string;
  threadId: string;
  parentNodeId: string | null;
  role: AgentThreadRole;
  createdByRunId: string | null;
  sourceStepId: string | null;
  sourceKind: AgentThreadNodeSourceKind;
  summaryText: string | null;
  message: ModelMessage;
  parts: AgentThreadNodePartView[];
  createdAt: number;
}

export interface AgentCandidateNodeView {
  id: string;
  tipNodeId: string;
  role: AgentThreadRole;
  summaryText: string | null;
  createdAt: number;
  createdByRunId: string | null;
}

export interface AgentCandidateGroupView {
  parentNodeId: string | null;
  activeNodeId: string;
  nodes: AgentCandidateNodeView[];
}

export interface AgentArtifactView {
  id: string;
  runId: string | null;
  stepId: string | null;
  artifactKind: AgentArtifactKind;
  visibility: AgentVisibility;
  mimeType: string | null;
  content: unknown;
  summaryText: string | null;
  createdAt: number;
}

export interface AgentRunView {
  id: string;
  threadId: string;
  parentRunId: string | null;
  parentEventId: string | null;
  triggerNodeId: string | null;
  baseTipNodeId: string | null;
  runMode: AgentRunMode;
  status: AgentRunStatus;
  agentProfile: string;
  selectionSnapshot: unknown;
  contextSnapshot: ProjectAssistantContextSnapshot | null;
  activeTools?: ProjectAssistantToolName[] | null;
  errorArtifactId: string | null;
  startedAt: number;
  completedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface AgentRunSummaryView {
  runId: string;
  triggerNodeId: string | null;
  displayNodeId: string;
  status: AgentRunStatus;
  stepCount: number;
  totalTokens: number | null;
  durationMs: number | null;
  errorMessage: string | null;
  needsContinuation?: boolean;
  continuationReason?: AgentContinuationReason | null;
  continuedByRunId?: string | null;
}

export interface WorkspaceRefreshRequestedEvent {
  type: "workspace-refresh-requested";
  workspaceId: string;
  areas: readonly WorkspaceRefreshArea[];
  contentNodeId?: string | null;
  auxNodeId?: string | null;
}

export type ProjectAssistantStreamEvent =
  | {
      type: "run-started";
      run: AgentRunView;
      threadId: string;
      triggerNodeId: string;
      userNode?: AgentThreadNodeView;
      replacementNode?: AgentThreadNodeView;
    }
  | {
      type: "step-started";
      stepIndex: number;
    }
  | {
      type: "assistant-message-started";
      nodeId: string;
      parentNodeId: string | null;
      stepIndex: number;
    }
  | {
      type: "assistant-text-delta";
      nodeId: string;
      delta: string;
      accumulatedText: string;
    }
  | {
      type: "assistant-reasoning-delta";
      nodeId: string;
      reasoningId: string;
      delta: string;
      accumulatedText: string;
    }
  | {
      type: "tool-call";
      assistantNodeId: string;
      toolCallId: string | null;
      toolName: string;
      input: unknown;
    }
  | {
      type: "tool-result";
      toolNodeId: string;
      toolCallId: string | null;
      toolName: string;
      output: unknown;
      status: ProjectAssistantStreamToolStatus;
    }
  | {
      type: "step-finished";
      stepIndex: number;
      finishReason: string | undefined;
      usage: unknown;
    }
  | WorkspaceRefreshRequestedEvent;

export interface AgentRunStepView {
  id: string;
  runId: string;
  stepIndex: number;
  provider: string;
  modelId: string;
  finishReason: string | null;
  rawFinishReason: string | null;
  system: unknown | null;
  preparedMessagesArtifactId: string | null;
  responseMessagesArtifactId: string | null;
  requestBodyArtifactId: string | null;
  responseBodyArtifactId: string | null;
  providerMetadataArtifactId: string | null;
  usage: unknown | null;
  startedAt: number;
  completedAt: number;
  createdAt: number;
}

export interface AgentRunEventView {
  id: string;
  runId: string;
  stepId: string | null;
  seq: number;
  eventKind: AgentRunEventKind;
  nodeId: string | null;
  relatedToolCallId: string | null;
  relatedRunId: string | null;
  summaryText: string | null;
  payloadArtifactId: string | null;
  createdAt: number;
}

export interface AgentRunTraceView {
  run: AgentRunView;
  steps: AgentRunStepView[];
  events: AgentRunEventView[];
  artifacts: AgentArtifactView[];
  childRuns: AgentRunView[];
}

export interface AgentThreadStateView {
  thread: AgentThreadView | null;
  activePath: AgentThreadNodeView[];
  candidateGroups: AgentCandidateGroupView[];
  latestRuns: AgentRunView[];
  runSummaries: AgentRunSummaryView[];
}

export interface AiCatalogProviderView {
  id: string;
  name: string;
  sdkPackage: string | null;
  apiUrl: string | null;
  docsUrl: string | null;
  envKeys: string[];
  isActive: boolean;
  isSupported: boolean;
  modelCount: number;
}

export interface AiCatalogModelView {
  id: string;
  providerId: string;
  modelId: string;
  displayName: string;
  family: string | null;
  inputModalities: string[];
  outputModalities: string[];
  contextWindow: number | null;
  maxOutputTokens: number | null;
  supportsVision: boolean;
  supportsToolUse: boolean;
  supportsReasoning: boolean;
  supportsTemperature: boolean;
  inputPricePer1m: number | null;
  outputPricePer1m: number | null;
  isActive: boolean;
}

export interface AiCatalogStatusView {
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  contentHash: string | null;
  providerCount: number;
  activeProviderCount: number;
  modelCount: number;
  activeModelCount: number;
  isStale: boolean;
}

export interface AiResolvedModelView {
  id: string;
  connectionId: string;
  origin: "catalog" | "custom";
  sdkPackage: string;
  modelId: string;
  displayName: string;
  family: string | null;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  supportsVision: boolean;
  supportsToolUse: boolean;
  supportsReasoning: boolean;
  supportsTemperature: boolean;
  inputPricePer1m: number | null;
  outputPricePer1m: number | null;
  isEnabled: boolean;
  catalogModelId: string | null;
  customModelId: string | null;
  isActive: boolean;
}

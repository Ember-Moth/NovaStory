import type { ModelMessage } from "ai";

import { invariant } from "@/shared/lib/domain";
import type {
  ProjectNodeRef,
  ProjectRunRef,
  ProjectThreadRef,
} from "@/modules/workspace/domain/types";

import type { AiIndexPayload } from "../ai-index-store";
import type {
  AgentArtifactKind,
  AgentArtifactRow,
  AgentPartState,
  AgentRunEventKind,
  AgentRunEventRow,
  AgentRunInputRefRow,
  AgentRunMode,
  AgentRunStatus,
  AgentRunStepRow,
  AgentRunView,
  AgentThreadNodePartKind,
  AgentThreadNodeSourceKind,
  AgentVisibility,
  AssistantInputRefSnapshot,
  ProjectAssistantContextSnapshot,
  ProjectAssistantToolName,
} from "../types";

export const PROJECT_ASSISTANT_AGENT_PROFILE = "project-assistant";

export interface CreateThreadInput {
  projectId: string;
  agentProfile?: string;
  title?: string | null;
}

export interface CreateNodeInput {
  threadId: string;
  parentNodeId: string | null;
  message: ModelMessage;
  sourceKind: AgentThreadNodeSourceKind;
  createdByRunId?: string | null;
  sourceStepId?: string | null;
  summaryText?: string | null;
  extraParts?: CreateNodeExtraPartInput[];
}

export interface CreateNodeExtraPartInput {
  partKind: AgentThreadNodePartKind;
  visibility?: AgentVisibility;
  state?: AgentPartState;
  providerOptions?: unknown;
  providerMetadata?: unknown;
  payload: unknown;
}

export interface CreateRunInput {
  threadId: string;
  parentRunId?: string | null;
  parentEventId?: string | null;
  triggerNodeId?: string | null;
  baseTipNodeId?: string | null;
  runMode: AgentRunMode;
  status?: AgentRunStatus;
  agentProfile: string;
  selectionSnapshot?: unknown;
  contextSnapshot?: ProjectAssistantContextSnapshot | null;
  inputRefsSnapshot?: readonly AssistantInputRefSnapshot[] | null;
  activeTools?: readonly ProjectAssistantToolName[] | null;
}

export interface CreateArtifactInput {
  runId?: string | null;
  stepId?: string | null;
  artifactKind: AgentArtifactKind;
  visibility: AgentVisibility;
  mimeType?: string | null;
  content: unknown;
  summaryText?: string | null;
}

export interface CreateRunStepInput {
  runId: string;
  stepIndex: number;
  provider: string;
  modelId: string;
  finishReason?: string | null;
  rawFinishReason?: string | null;
  system?: unknown;
  preparedMessagesArtifactId?: string | null;
  responseMessagesArtifactId?: string | null;
  requestBodyArtifactId?: string | null;
  responseBodyArtifactId?: string | null;
  providerMetadataArtifactId?: string | null;
  usage?: unknown;
}

export interface CreateRunEventInput {
  runId: string;
  stepId?: string | null;
  eventKind: AgentRunEventKind;
  nodeId?: string | null;
  relatedToolCallId?: string | null;
  relatedRunId?: string | null;
  summaryText?: string | null;
  payloadArtifactId?: string | null;
}

export interface MaterializeResponseMessagesInput {
  projectId: string;
  threadId: string;
  parentNodeId: string | null;
  runId: string;
  stepId: string;
  messages: ModelMessage[];
}

export interface ProjectStepRef extends ProjectRunRef {
  stepId: string;
}

export interface ProjectArtifactRef extends ProjectRunRef {
  artifactId: string;
}

export interface ProjectThreadNodeDeltaInput extends ProjectNodeRef {
  delta: string;
}

export interface ProjectThreadTitleInput extends ProjectThreadRef {
  title: string;
}

export interface ProjectAiStorage {
  index: AiIndexPayload;
  files: Record<string, string>;
}

export interface RunTraceRows {
  run: AgentRunView;
  inputRefs: AgentRunInputRefRow[];
  steps: AgentRunStepRow[];
  events: AgentRunEventRow[];
  artifacts: AgentArtifactRow[];
  childRuns: AgentRunView[];
}

export function trimOptionalString(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function normalizeThreadTitle(title: string | null | undefined, fallback: string) {
  return trimOptionalString(title) ?? fallback;
}

export function normalizeSummaryText(summaryText: string | null | undefined) {
  return trimOptionalString(summaryText);
}

export function serializeRequiredJson(value: unknown, label: string) {
  const serialized = JSON.stringify(value);
  invariant(serialized !== undefined, `${label}必须可序列化。`);
  return serialized;
}

export function serializeOptionalJson(value: unknown) {
  if (value === undefined) {
    return null;
  }
  const serialized = JSON.stringify(value);
  invariant(serialized !== undefined, "可选 JSON 字段必须可序列化。");
  return serialized;
}

export function parseStoredJson<T>(raw: string | null): T | null {
  if (raw == null) {
    return null;
  }
  return JSON.parse(raw) as T;
}

export function parseStoredArray<T>(raw: string | null | undefined): T[] {
  if (!raw) {
    return [];
  }
  const parsed = JSON.parse(raw) as unknown;
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

export function stringifyStoredArray<T>(items: readonly T[]) {
  return serializeRequiredJson(items, "缓存数组");
}

export function sortByCreatedAt<T extends { createdAt: number }>(rows: readonly T[]) {
  return [...rows].sort((left, right) => left.createdAt - right.createdAt);
}

export function sortByUpdatedDescCreatedDesc<T extends { updatedAt: number; createdAt: number }>(
  rows: readonly T[],
) {
  return [...rows].sort((left, right) => {
    if (left.updatedAt !== right.updatedAt) {
      return right.updatedAt - left.updatedAt;
    }
    return right.createdAt - left.createdAt;
  });
}

export function replaceRowById<T extends { id: string }>(rows: T[], nextRow: T) {
  const index = rows.findIndex((row) => row.id === nextRow.id);
  if (index >= 0) {
    rows[index] = nextRow;
  } else {
    rows.push(nextRow);
  }
}

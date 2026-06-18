import { createId, invariant, now } from "@/shared/lib/domain";

import type {
  AgentMessagePartRow,
  AgentPartState,
  AgentThreadNodePartKind,
  AgentVisibility,
  AgentThreadNodeRow,
} from "../types";
import {
  buildMessageSummary,
  buildStoredMessagePartRows,
  normalizeModelMessage,
} from "./message-parts";
import { mapNodeRow } from "./mappers";
import {
  normalizeSummaryText,
  parseStoredArray,
  replaceRowById,
  serializeOptionalJson,
  serializeRequiredJson,
  stringifyStoredArray,
  trimOptionalString,
  type CreateNodeInput,
  type ProjectAiStorage,
} from "./shared";
import { getNodeOrThrow, getRunOrThrow, getThreadOrThrow, touchThread } from "./storage";
import { getStepOrThrow } from "./trace-store";

export function insertNode(storage: ProjectAiStorage, input: CreateNodeInput) {
  const thread = getThreadOrThrow(storage.index, input.threadId);
  if (input.parentNodeId) {
    const parent = getNodeOrThrow(storage.index, input.parentNodeId);
    invariant(parent.threadId === thread.id, "父节点不属于当前 thread。");
  }
  if (input.createdByRunId) {
    const run = getRunOrThrow(storage.index, input.createdByRunId);
    invariant(run.threadId === thread.id, "节点来源 run 不属于当前 thread。");
  }
  if (input.sourceStepId) {
    const sourceRun = input.createdByRunId
      ? getRunOrThrow(storage.index, input.createdByRunId)
      : null;
    invariant(sourceRun, "节点来源 step 需要关联当前项目内 run。");
    const step = getStepOrThrow({
      projectId: thread.projectId,
      runId: sourceRun.id,
      stepId: input.sourceStepId,
    });
    const stepRun = getRunOrThrow(storage.index, step.runId);
    invariant(stepRun.threadId === thread.id, "节点来源 step 不属于当前 thread。");
  }

  const storedMessage = normalizeModelMessage(input.message);
  const id = createId("agent_node");
  const createdAt = now();
  const row: AgentThreadNodeRow = {
    id,
    threadId: thread.id,
    parentNodeId: input.parentNodeId,
    role: storedMessage.role,
    createdByRunId: trimOptionalString(input.createdByRunId),
    sourceStepId: trimOptionalString(input.sourceStepId),
    sourceKind: input.sourceKind,
    summaryText: normalizeSummaryText(input.summaryText) ?? buildMessageSummary(storedMessage),
    partsJson: stringifyStoredArray(
      buildStoredMessagePartRows(id, createdAt, storedMessage, input.extraParts),
    ),
    createdAt,
  };
  storage.index.nodes.push(row);
  touchThread(storage.index, thread.id);
  return mapNodeRow(row);
}

export function updateNodePart(
  storage: ProjectAiStorage,
  nodeId: string,
  partIndex: number,
  {
    payload,
    state,
    providerOptions,
    providerMetadata,
  }: {
    payload: unknown;
    state: AgentPartState;
    providerOptions?: unknown;
    providerMetadata?: unknown;
  },
) {
  const node = getNodeOrThrow(storage.index, nodeId);
  const rows = parseStoredArray<AgentMessagePartRow>(node.partsJson);
  const rowIndex = rows.findIndex((row) => row.partIndex === partIndex);
  invariant(rowIndex >= 0, "未找到节点 part。");
  rows[rowIndex] = {
    ...rows[rowIndex]!,
    state,
    providerOptionsJson: serializeOptionalJson(providerOptions),
    providerMetadataJson: serializeOptionalJson(providerMetadata),
    payloadJson: serializeRequiredJson(payload, "节点 part"),
  };
  replaceRowById(storage.index.nodes, {
    ...node,
    partsJson: stringifyStoredArray(rows),
  });
  touchThread(storage.index, node.threadId);
}

export function appendNodePart(
  storage: ProjectAiStorage,
  nodeId: string,
  part: {
    partKind: AgentThreadNodePartKind;
    visibility: AgentVisibility;
    state: AgentPartState;
    payload: unknown;
    providerOptions?: unknown;
    providerMetadata?: unknown;
  },
) {
  const node = getNodeOrThrow(storage.index, nodeId);
  const rows = parseStoredArray<AgentMessagePartRow>(node.partsJson);
  const nextPartIndex = Math.max(-1, ...rows.map((row) => row.partIndex)) + 1;
  rows.push({
    id: createId("agent_part"),
    nodeId,
    partIndex: nextPartIndex,
    partKind: part.partKind,
    visibility: part.visibility,
    state: part.state,
    providerOptionsJson: serializeOptionalJson(part.providerOptions),
    providerMetadataJson: serializeOptionalJson(part.providerMetadata),
    payloadJson: serializeRequiredJson(part.payload, "节点 part"),
    createdAt: now(),
  });
  replaceRowById(storage.index.nodes, {
    ...node,
    partsJson: stringifyStoredArray(rows),
  });
  touchThread(storage.index, node.threadId);
}

export function updateNodeSummary(
  storage: ProjectAiStorage,
  nodeId: string,
  summaryText: string | null | undefined,
) {
  const node = getNodeOrThrow(storage.index, nodeId);
  replaceRowById(storage.index.nodes, {
    ...node,
    summaryText: normalizeSummaryText(summaryText),
  });
  touchThread(storage.index, node.threadId);
}

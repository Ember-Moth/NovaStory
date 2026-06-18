import { invariant } from "@/shared/lib/domain";
import { parseJsonl, stringifyJsonl } from "@/modules/workspace/domain/git-storage/jsonl";

import type {
  AgentArtifactKind,
  AgentArtifactRow,
  AgentArtifactView,
  AgentRunEventRow,
  AgentRunInputRefRow,
  AgentRunRow,
  AgentRunStepRow,
  AgentRunTraceView,
  AgentRunView,
  AgentVisibility,
} from "../types";
import { mapArtifactRow, mapRunEventRow, mapRunRow, mapRunStepRow } from "./mappers";
import {
  parseStoredJson,
  replaceRowById,
  serializeOptionalJson,
  serializeRequiredJson,
  sortByCreatedAt,
  type ProjectAiStorage,
  type ProjectArtifactRef,
  type ProjectStepRef,
  type RunTraceRows,
} from "./shared";
import { getRunOrThrow, readProjectAiStorage } from "./storage";

interface RunTraceCacheFields {
  selectionSnapshotJson: string;
  contextSnapshotJson: string | null;
  inputRefsSnapshotJson: string | null;
  activeToolsJson: string | null;
  stepCount: number;
  totalTokens: number | null;
  lastFinishReason: string | null;
  errorSummary: string | null;
  traceUpdatedAt: number | null;
}

export function normalizeUsageTotalTokens(usage: unknown): number | null {
  if (!usage || typeof usage !== "object") {
    return null;
  }

  const totalTokens = Reflect.get(usage as Record<string, unknown>, "totalTokens");
  if (typeof totalTokens === "number" && Number.isFinite(totalTokens)) {
    return Math.max(0, Math.round(totalTokens));
  }

  const inputTokens = Reflect.get(usage as Record<string, unknown>, "inputTokens");
  const outputTokens = Reflect.get(usage as Record<string, unknown>, "outputTokens");
  if (
    typeof inputTokens === "number" &&
    Number.isFinite(inputTokens) &&
    typeof outputTokens === "number" &&
    Number.isFinite(outputTokens)
  ) {
    return Math.max(0, Math.round(inputTokens + outputTokens));
  }

  return null;
}

function summarizeRunTraceRows(rows: RunTraceRows): RunTraceCacheFields {
  const totalTokens = rows.steps.reduce<number | null>((sum, step) => {
    const value = normalizeUsageTotalTokens(parseStoredJson(step.usageJson));
    if (value == null) {
      return sum;
    }
    return (sum ?? 0) + value;
  }, null);
  const errorArtifact = rows.run.errorArtifactId
    ? (rows.artifacts.find((artifact) => artifact.id === rows.run.errorArtifactId) ?? null)
    : null;
  const lastStep = rows.steps.at(-1);

  return {
    selectionSnapshotJson: serializeRequiredJson(rows.run.selectionSnapshot ?? {}, "run 选择快照"),
    contextSnapshotJson: serializeOptionalJson(rows.run.contextSnapshot),
    inputRefsSnapshotJson: serializeOptionalJson(rows.run.inputRefsSnapshot ?? null),
    activeToolsJson: serializeOptionalJson(rows.run.activeTools ?? null),
    stepCount: rows.steps.length,
    totalTokens,
    lastFinishReason: lastStep?.finishReason ?? null,
    errorSummary: errorArtifact?.summaryText ?? null,
    traceUpdatedAt: rows.run.updatedAt,
  };
}

export function buildAgentRunCacheFieldsFromTrace(rows: RunTraceRows) {
  return summarizeRunTraceRows(rows);
}

export function normalizeGitStepRow(
  row: AgentRunStepRow | Record<string, unknown>,
): AgentRunStepRow {
  if ("systemJson" in row) return row as AgentRunStepRow;
  return {
    id: String(row.id),
    runId: String(row.runId),
    stepIndex: Number(row.stepIndex),
    provider: String(row.provider),
    modelId: String(row.modelId),
    finishReason: typeof row.finishReason === "string" ? row.finishReason : null,
    rawFinishReason: typeof row.rawFinishReason === "string" ? row.rawFinishReason : null,
    systemJson: serializeOptionalJson(Reflect.get(row, "system")),
    preparedMessagesArtifactId:
      typeof row.preparedMessagesArtifactId === "string" ? row.preparedMessagesArtifactId : null,
    responseMessagesArtifactId:
      typeof row.responseMessagesArtifactId === "string" ? row.responseMessagesArtifactId : null,
    requestBodyArtifactId:
      typeof row.requestBodyArtifactId === "string" ? row.requestBodyArtifactId : null,
    responseBodyArtifactId:
      typeof row.responseBodyArtifactId === "string" ? row.responseBodyArtifactId : null,
    providerMetadataArtifactId:
      typeof row.providerMetadataArtifactId === "string" ? row.providerMetadataArtifactId : null,
    usageJson: serializeOptionalJson(Reflect.get(row, "usage")),
    startedAt: Number(row.startedAt),
    completedAt: Number(row.completedAt),
    createdAt: Number(row.createdAt),
  };
}

export function normalizeGitArtifactRow(
  row: AgentArtifactRow | AgentArtifactView | Record<string, unknown>,
): AgentArtifactRow {
  if ("contentJson" in row) return row as AgentArtifactRow;
  return {
    id: String(row.id),
    runId: typeof row.runId === "string" ? row.runId : null,
    stepId: typeof row.stepId === "string" ? row.stepId : null,
    artifactKind: String(row.artifactKind) as AgentArtifactKind,
    visibility: String(row.visibility) as AgentVisibility,
    mimeType: typeof row.mimeType === "string" ? row.mimeType : null,
    contentJson: serializeRequiredJson(Reflect.get(row, "content") ?? null, "artifact 内容"),
    summaryText: typeof row.summaryText === "string" ? row.summaryText : null,
    createdAt: Number(row.createdAt),
  };
}

export function parseRunTraceRowsFromStorage(
  storage: ProjectAiStorage,
  run: AgentRunRow,
): RunTraceRows {
  const runJson = storage.files[`runs/${run.id}/run.json`];
  const runView = runJson ? (JSON.parse(runJson) as AgentRunView) : mapRunRow(run);
  const inputRefs = parseJsonl<AgentRunInputRefRow>(
    storage.files[`runs/${run.id}/input-refs.jsonl`],
  ).sort((left, right) => left.refIndex - right.refIndex);
  const steps = parseJsonl<AgentRunStepRow | Record<string, unknown>>(
    storage.files[`runs/${run.id}/steps.jsonl`],
  )
    .map(normalizeGitStepRow)
    .sort((left, right) => left.stepIndex - right.stepIndex);
  const events = parseJsonl<AgentRunEventRow>(storage.files[`runs/${run.id}/events.jsonl`]).sort(
    (left, right) => left.seq - right.seq,
  );
  const artifacts = parseJsonl<AgentArtifactRow | AgentArtifactView | Record<string, unknown>>(
    storage.files[`runs/${run.id}/artifacts.jsonl`],
  )
    .map(normalizeGitArtifactRow)
    .sort((left, right) => left.createdAt - right.createdAt);
  const childRuns = sortByCreatedAt(
    storage.index.runs.filter((entry) => entry.parentRunId === run.id),
  ).map(mapRunRow);

  return {
    run: runView,
    inputRefs,
    steps,
    events,
    artifacts,
    childRuns,
  };
}

export function mapTraceRows(rows: RunTraceRows): AgentRunTraceView {
  return {
    run: rows.run,
    steps: rows.steps.map(mapRunStepRow),
    events: rows.events.map(mapRunEventRow),
    artifacts: rows.artifacts.map(mapArtifactRow),
    childRuns: rows.childRuns,
  };
}

export function applyRunTraceRowsToStorage(storage: ProjectAiStorage, rows: RunTraceRows) {
  storage.files[`runs/${rows.run.id}/run.json`] = `${JSON.stringify(rows.run, null, 2)}\n`;
  storage.files[`runs/${rows.run.id}/input-refs.jsonl`] = stringifyJsonl(rows.inputRefs);
  storage.files[`runs/${rows.run.id}/steps.jsonl`] = stringifyJsonl(rows.steps);
  storage.files[`runs/${rows.run.id}/events.jsonl`] = stringifyJsonl(rows.events);
  storage.files[`runs/${rows.run.id}/artifacts.jsonl`] = stringifyJsonl(rows.artifacts);
  storage.files[`runs/${rows.run.id}/child-runs.jsonl`] = stringifyJsonl(rows.childRuns);

  const cache = buildAgentRunCacheFieldsFromTrace(rows);
  const current = getRunOrThrow(storage.index, rows.run.id);
  replaceRowById(storage.index.runs, {
    ...current,
    status: rows.run.status,
    errorArtifactId: rows.run.errorArtifactId,
    selectionSnapshotJson: cache.selectionSnapshotJson,
    contextSnapshotJson: cache.contextSnapshotJson,
    inputRefsSnapshotJson: cache.inputRefsSnapshotJson,
    activeToolsJson: cache.activeToolsJson,
    stepCount: cache.stepCount,
    totalTokens: cache.totalTokens,
    lastFinishReason: cache.lastFinishReason,
    errorSummary: cache.errorSummary,
    traceUpdatedAt: cache.traceUpdatedAt,
    completedAt: rows.run.completedAt,
    updatedAt: rows.run.updatedAt,
  });
}

export function getStepOrThrow({ projectId, runId, stepId }: ProjectStepRef) {
  const storage = readProjectAiStorage(projectId);
  const run = getRunOrThrow(storage.index, runId);
  const step = parseRunTraceRowsFromStorage(storage, run).steps.find(
    (entry) => entry.id === stepId,
  );
  if (step) {
    return step;
  }
  invariant(false, "未找到 run step。");
}

export function getArtifactOrThrow({ projectId, runId, artifactId }: ProjectArtifactRef) {
  const storage = readProjectAiStorage(projectId);
  const run = getRunOrThrow(storage.index, runId);
  const artifact = parseRunTraceRowsFromStorage(storage, run).artifacts.find(
    (entry) => entry.id === artifactId,
  );
  if (artifact) {
    return artifact;
  }
  invariant(false, "未找到 artifact。");
}

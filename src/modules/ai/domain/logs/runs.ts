import { invariant, now } from "@/shared/lib/domain";

import type {
  AgentArtifactRow,
  AgentRunMode,
  AgentRunEventRow,
  AgentRunInputRefRow,
  AgentRunRow,
  AgentRunStatus,
  AgentRunStepRow,
  AgentRunTraceView,
  AgentRunView,
  ProjectAssistantContextSnapshot,
} from "../types";
import {
  buildAgentRunCacheFieldsFromTrace,
  getArtifactOrThrow,
  getStepOrThrow,
  mapTraceRows,
  parseRunTraceRowsFromStorage,
  applyRunTraceRowsToStorage,
} from "./trace-store";
import {
  mapArtifactRow,
  mapRunEventRow,
  mapRunInputRefRow,
  mapRunRow,
  mapRunStepRow,
} from "./mappers";
import {
  serializeOptionalJson,
  serializeRequiredJson,
  sortByCreatedAt,
  trimOptionalString,
  type CreateArtifactInput,
  type CreateRunEventInput,
  type CreateRunInput,
  type CreateRunStepInput,
  type ProjectAiStorage,
} from "./shared";
import {
  assertRunInProject,
  assertThreadInProject,
  getNodeOrThrow,
  getRunOrThrow,
  readProjectAiStorage,
  touchProject,
  touchThread,
  updateProjectAiStorage,
} from "./storage";
import { createId } from "@/shared/lib/domain";

export { buildAgentRunCacheFieldsFromTrace };
export type { RunTraceRows } from "./shared";

export function createRun(projectId: string, input: CreateRunInput) {
  const result = updateProjectAiStorage(projectId, "Create AI run", (storage: ProjectAiStorage) => {
    const thread = assertThreadInProject(storage.index, projectId, input.threadId);
    const status = input.status ?? "running";
    if (input.parentRunId) {
      const parentRun = getRunOrThrow(storage.index, input.parentRunId);
      invariant(parentRun.threadId === thread.id, "父 run 不属于当前 thread。");
    }
    if (input.triggerNodeId) {
      const triggerNode = getNodeOrThrow(storage.index, input.triggerNodeId);
      invariant(triggerNode.threadId === thread.id, "触发节点不属于当前 thread。");
    }
    if (input.baseTipNodeId) {
      const baseTipNode = getNodeOrThrow(storage.index, input.baseTipNodeId);
      invariant(baseTipNode.threadId === thread.id, "base tip 不属于当前 thread。");
    }
    const id = createId("agent_run");
    const timestamp = now();
    const row: AgentRunRow = {
      id,
      threadId: thread.id,
      parentRunId: trimOptionalString(input.parentRunId),
      parentEventId: trimOptionalString(input.parentEventId),
      triggerNodeId: trimOptionalString(input.triggerNodeId),
      baseTipNodeId: trimOptionalString(input.baseTipNodeId),
      runMode: input.runMode,
      status,
      agentProfile: input.agentProfile,
      errorArtifactId: null,
      selectionSnapshotJson: serializeRequiredJson(input.selectionSnapshot ?? {}, "run 选择快照"),
      contextSnapshotJson: serializeOptionalJson(input.contextSnapshot ?? null),
      inputRefsSnapshotJson: serializeOptionalJson(input.inputRefsSnapshot ?? null),
      activeToolsJson: serializeOptionalJson(input.activeTools ? [...input.activeTools] : null),
      stepCount: 0,
      totalTokens: null,
      lastFinishReason: null,
      errorSummary: null,
      traceUpdatedAt: timestamp,
      startedAt: timestamp,
      completedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    storage.index.runs.push(row);
    touchThread(storage.index, thread.id, timestamp);
    const inputRefs: AgentRunInputRefRow[] = (input.inputRefsSnapshot ?? []).map(
      (ref, refIndex) => ({
        id: createId("agent_run_ref"),
        runId: id,
        refIndex,
        kind: ref.kind,
        mode: ref.mode,
        label: ref.label,
        sourceJson: serializeRequiredJson(ref.source, "run ref source"),
        snapshotJson: serializeRequiredJson(ref.snapshot, "run ref snapshot"),
        displayJson: serializeRequiredJson(
          {
            refId: ref.refId,
            kind: ref.kind,
            mode: ref.mode,
            label: ref.label,
          },
          "run ref display",
        ),
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );
    const runView: AgentRunView = {
      id: row.id,
      threadId: row.threadId,
      parentRunId: row.parentRunId,
      parentEventId: row.parentEventId,
      triggerNodeId: row.triggerNodeId,
      baseTipNodeId: row.baseTipNodeId,
      runMode: row.runMode as AgentRunMode,
      status: row.status as AgentRunStatus,
      agentProfile: row.agentProfile,
      selectionSnapshot: input.selectionSnapshot ?? {},
      contextSnapshot: input.contextSnapshot ?? null,
      inputRefsSnapshot: inputRefs.map(mapRunInputRefRow),
      activeTools: input.activeTools ? [...input.activeTools] : null,
      errorArtifactId: null,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
    applyRunTraceRowsToStorage(storage, {
      run: runView,
      inputRefs,
      steps: [],
      events: [],
      artifacts: [],
      childRuns: [],
    });
    return runView;
  });
  touchProject(projectId);
  return result;
}

export function createArtifact(projectId: string, input: CreateArtifactInput) {
  invariant(input.runId || input.stepId, "artifact 必须关联 run 或 step。");
  const runId = trimOptionalString(input.runId);
  return updateProjectAiStorage(
    projectId,
    `Update AI run ${runId ?? input.stepId}`,
    (storage: ProjectAiStorage) => {
      const resolvedRunId =
        runId ??
        (() => {
          const candidate = storage.index.runs.find((entry) =>
            parseRunTraceRowsFromStorage(storage, entry).steps.some(
              (step) => step.id === input.stepId,
            ),
          );
          invariant(candidate, "未找到 run step。");
          return candidate.id;
        })();
      const run = assertRunInProject(storage.index, projectId, resolvedRunId);
      if (input.stepId) {
        const step = getStepOrThrow({ projectId, runId: run.id, stepId: input.stepId });
        invariant(step.runId === run.id, "artifact step 不属于当前 run。");
      }
      const artifact: AgentArtifactRow = {
        id: createId("agent_artifact"),
        runId: run.id,
        stepId: trimOptionalString(input.stepId),
        artifactKind: input.artifactKind,
        visibility: input.visibility,
        mimeType: trimOptionalString(input.mimeType),
        contentJson: serializeRequiredJson(input.content, "artifact 内容"),
        summaryText: trimOptionalString(input.summaryText),
        createdAt: now(),
      };
      const rows = parseRunTraceRowsFromStorage(storage, run);
      rows.artifacts.push(artifact);
      rows.run = {
        ...rows.run,
        updatedAt: now(),
      };
      applyRunTraceRowsToStorage(storage, rows);
      return mapArtifactRow(artifact);
    },
  );
}

export function createRunStep(projectId: string, input: CreateRunStepInput) {
  return updateProjectAiStorage(
    projectId,
    `Update AI run ${input.runId}`,
    (storage: ProjectAiStorage) => {
      const run = assertRunInProject(storage.index, projectId, input.runId);
      const rows = parseRunTraceRowsFromStorage(storage, run);
      invariant(
        !rows.steps.some((step) => step.stepIndex === input.stepIndex),
        "run step 序号已存在。",
      );
      const timestamp = now();
      const step: AgentRunStepRow = {
        id: createId("agent_step"),
        runId: run.id,
        stepIndex: input.stepIndex,
        provider: input.provider,
        modelId: input.modelId,
        finishReason: trimOptionalString(input.finishReason),
        rawFinishReason: trimOptionalString(input.rawFinishReason),
        systemJson: serializeOptionalJson(input.system),
        preparedMessagesArtifactId: trimOptionalString(input.preparedMessagesArtifactId),
        responseMessagesArtifactId: trimOptionalString(input.responseMessagesArtifactId),
        requestBodyArtifactId: trimOptionalString(input.requestBodyArtifactId),
        responseBodyArtifactId: trimOptionalString(input.responseBodyArtifactId),
        providerMetadataArtifactId: trimOptionalString(input.providerMetadataArtifactId),
        usageJson: serializeOptionalJson(input.usage),
        startedAt: timestamp,
        completedAt: timestamp,
        createdAt: timestamp,
      };
      rows.steps.push(step);
      rows.run = {
        ...rows.run,
        updatedAt: timestamp,
      };
      applyRunTraceRowsToStorage(storage, rows);
      return mapRunStepRow(step);
    },
  );
}

export function appendRunEvent(projectId: string, input: CreateRunEventInput) {
  return updateProjectAiStorage(
    projectId,
    `Append AI run event ${input.runId}`,
    (storage: ProjectAiStorage) => {
      const run = assertRunInProject(storage.index, projectId, input.runId);
      if (input.stepId) {
        const step = getStepOrThrow({ projectId, runId: run.id, stepId: input.stepId });
        invariant(step.runId === run.id, "事件 step 不属于当前 run。");
      }
      if (input.nodeId) {
        const node = getNodeOrThrow(storage.index, input.nodeId);
        invariant(node.threadId === run.threadId, "事件节点不属于当前 run 所在 thread。");
      }
      if (input.relatedRunId) {
        getRunOrThrow(storage.index, input.relatedRunId);
      }
      const rows = parseRunTraceRowsFromStorage(storage, run);
      const nextSeq = Math.max(0, ...rows.events.map((event) => event.seq)) + 1;
      const event: AgentRunEventRow = {
        id: createId("agent_event"),
        runId: run.id,
        stepId: trimOptionalString(input.stepId),
        seq: nextSeq,
        eventKind: input.eventKind,
        nodeId: trimOptionalString(input.nodeId),
        relatedToolCallId: trimOptionalString(input.relatedToolCallId),
        relatedRunId: trimOptionalString(input.relatedRunId),
        summaryText: trimOptionalString(input.summaryText),
        payloadArtifactId: trimOptionalString(input.payloadArtifactId),
        createdAt: now(),
      };
      rows.events.push(event);
      rows.run = {
        ...rows.run,
        updatedAt: now(),
      };
      applyRunTraceRowsToStorage(storage, rows);
      return mapRunEventRow(event);
    },
  );
}

export function updateRunStep(input: {
  projectId: string;
  stepId: string;
  finishReason?: string | null;
  rawFinishReason?: string | null;
  preparedMessagesArtifactId?: string | null;
  responseMessagesArtifactId?: string | null;
  requestBodyArtifactId?: string | null;
  responseBodyArtifactId?: string | null;
  providerMetadataArtifactId?: string | null;
  usage?: unknown;
}) {
  return updateProjectAiStorage(
    input.projectId,
    `Update AI run step ${input.stepId}`,
    (storage: ProjectAiStorage) => {
      const run = storage.index.runs.find((entry) =>
        parseRunTraceRowsFromStorage(storage, entry).steps.some((step) => step.id === input.stepId),
      );
      invariant(run, "未找到 run step。");
      assertRunInProject(storage.index, input.projectId, run.id);
      const step = getStepOrThrow({
        projectId: input.projectId,
        runId: run.id,
        stepId: input.stepId,
      });
      const rows = parseRunTraceRowsFromStorage(storage, run);
      const index = rows.steps.findIndex((entry) => entry.id === step.id);
      invariant(index >= 0, "未找到 run step。");
      const nextStep: AgentRunStepRow = {
        ...rows.steps[index]!,
        finishReason: trimOptionalString(input.finishReason),
        rawFinishReason: trimOptionalString(input.rawFinishReason),
        preparedMessagesArtifactId: trimOptionalString(input.preparedMessagesArtifactId),
        responseMessagesArtifactId: trimOptionalString(input.responseMessagesArtifactId),
        requestBodyArtifactId: trimOptionalString(input.requestBodyArtifactId),
        responseBodyArtifactId: trimOptionalString(input.responseBodyArtifactId),
        providerMetadataArtifactId: trimOptionalString(input.providerMetadataArtifactId),
        usageJson: serializeOptionalJson(input.usage),
        completedAt: now(),
      };
      rows.steps[index] = nextStep;
      rows.run = {
        ...rows.run,
        updatedAt: now(),
      };
      applyRunTraceRowsToStorage(storage, rows);
      return mapRunStepRow(nextStep);
    },
  );
}

function updateRunStatus(
  projectId: string,
  runId: string,
  status: AgentRunStatus,
  {
    completedAt,
    errorArtifactId,
  }: {
    completedAt: number | null;
    errorArtifactId?: string | null;
  },
) {
  return updateProjectAiStorage(
    projectId,
    `Update AI run ${runId}`,
    (storage: ProjectAiStorage) => {
      const run = getRunOrThrow(storage.index, runId);
      const rows = parseRunTraceRowsFromStorage(storage, run);
      rows.run = {
        ...rows.run,
        status,
        errorArtifactId: errorArtifactId === undefined ? rows.run.errorArtifactId : errorArtifactId,
        completedAt,
        updatedAt: now(),
      };
      applyRunTraceRowsToStorage(storage, rows);
      return rows.run;
    },
  );
}

export function markRunSucceeded(projectId: string, runId: string) {
  return updateRunStatus(projectId, runId, "succeeded", { completedAt: now() });
}

export function markRunWaitingForInput(projectId: string, runId: string) {
  return updateRunStatus(projectId, runId, "waiting_for_input", { completedAt: null });
}

export function markRunRunning(projectId: string, runId: string) {
  return updateRunStatus(projectId, runId, "running", { completedAt: null });
}

export function markRunFailed(projectId: string, runId: string, errorArtifactId?: string | null) {
  if (errorArtifactId) {
    getArtifactOrThrow({ projectId, runId, artifactId: errorArtifactId });
  }
  return updateRunStatus(projectId, runId, "failed", {
    completedAt: now(),
    errorArtifactId: trimOptionalString(errorArtifactId),
  });
}

export function markRunCancelled(projectId: string, runId: string) {
  return updateRunStatus(projectId, runId, "cancelled", { completedAt: now() });
}

export function updateRunContextSnapshot(
  projectId: string,
  runId: string,
  contextSnapshot: ProjectAssistantContextSnapshot | null,
) {
  return updateProjectAiStorage(
    projectId,
    `Update AI run ${runId}`,
    (storage: ProjectAiStorage) => {
      const run = assertRunInProject(storage.index, projectId, runId);
      const rows = parseRunTraceRowsFromStorage(storage, run);
      rows.run = {
        ...rows.run,
        contextSnapshot,
        updatedAt: now(),
      };
      applyRunTraceRowsToStorage(storage, rows);
      return rows.run;
    },
  );
}

export function getRunTrace(projectId: string, runId: string): AgentRunTraceView {
  const storage = readProjectAiStorage(projectId);
  const run = assertRunInProject(storage.index, projectId, runId);
  return mapTraceRows(parseRunTraceRowsFromStorage(storage, run));
}

export function getRunStepResponseBody(projectId: string, stepId: string): unknown | null {
  const trace = storageAwareFindRunTraceByStep(projectId, stepId);
  if (!trace.step.responseBodyArtifactId) {
    return null;
  }
  const artifact = trace.artifacts.find((entry) => entry.id === trace.step.responseBodyArtifactId);
  invariant(artifact, "未找到 artifact。");
  return artifact.content;
}

function storageAwareFindRunTraceByStep(projectId: string, stepId: string) {
  const storage = readProjectAiStorage(projectId);
  const run = storage.index.runs.find((entry) =>
    parseRunTraceRowsFromStorage(storage, entry).steps.some((step) => step.id === stepId),
  );
  invariant(run, "未找到 run step。");
  const rows = parseRunTraceRowsFromStorage(storage, run);
  const step = rows.steps.find((entry) => entry.id === stepId);
  invariant(step, "未找到 run step。");
  return {
    step,
    artifacts: mapTraceRows(rows).artifacts,
  };
}

export function listChildRuns(projectId: string, runId: string) {
  const storage = readProjectAiStorage(projectId);
  assertRunInProject(storage.index, projectId, runId);
  return sortByCreatedAt(storage.index.runs.filter((row) => row.parentRunId === runId)).map(
    mapRunRow,
  );
}

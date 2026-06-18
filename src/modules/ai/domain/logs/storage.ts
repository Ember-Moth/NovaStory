import {
  findProjectIdForNodeSync,
  findProjectIdForRunSync,
  findProjectIdForThreadSync,
  readAiIndexSync,
} from "@/modules/ai/domain/ai-index-store";
import { now } from "@/shared/lib/domain";
import {
  readProjectMetaSync,
  updateProjectMetaSync,
} from "@/modules/workspace/domain/git-storage/project-meta-store";
import {
  aiRunsRef,
  commitCustomRefSync,
  readFilesAtRefSync,
} from "@/modules/workspace/domain/git-storage/git-store";
import { stringifyJsonl } from "@/modules/workspace/domain/git-storage/jsonl";

import type { AiIndexPayload } from "../ai-index-store";
import type { AgentProjectStateRow } from "../types";
import { mapProjectStateRow } from "./mappers";
import {
  replaceRowById,
  sortByCreatedAt,
  sortByUpdatedDescCreatedDesc,
  type ProjectAiStorage,
} from "./shared";
import { invariant } from "@/shared/lib/domain";

function normalizeIndexPayload(index: AiIndexPayload): AiIndexPayload {
  return {
    threads: sortByCreatedAt(index.threads),
    projectState: sortByCreatedAt(index.projectState),
    nodes: sortByCreatedAt(index.nodes),
    runs: sortByCreatedAt(index.runs),
  };
}

export function getProjectOrThrow(projectId: string) {
  return readProjectMetaSync(projectId).project;
}

export function touchProject(projectId: string) {
  updateProjectMetaSync(
    projectId,
    (payload) => ({
      ...payload,
      project: {
        ...payload.project,
        updatedAt: now(),
      },
    }),
    "Touch project metadata",
  );
}

function readAiRunFilesOrEmpty(projectId: string) {
  try {
    return readFilesAtRefSync({ projectId, ref: aiRunsRef() });
  } catch {
    return {};
  }
}

export function readProjectAiStorage(projectId: string): ProjectAiStorage {
  readProjectMetaSync(projectId);
  return {
    index: normalizeIndexPayload(readAiIndexSync(projectId)),
    files: readAiRunFilesOrEmpty(projectId),
  };
}

function writeProjectAiStorage(projectId: string, storage: ProjectAiStorage, message: string) {
  const index = normalizeIndexPayload(storage.index);
  const files = {
    ...storage.files,
    "threads.jsonl": stringifyJsonl(index.threads),
    "project-state.jsonl": stringifyJsonl(index.projectState),
    "nodes.jsonl": stringifyJsonl(index.nodes),
    "runs.jsonl": stringifyJsonl(index.runs),
  };
  commitCustomRefSync({
    projectId,
    ref: aiRunsRef(),
    message,
    replace: true,
    files,
  });
  return {
    index,
    files,
  } satisfies ProjectAiStorage;
}

export function updateProjectAiStorage<T>(
  projectId: string,
  message: string,
  updater: (_storage: ProjectAiStorage) => T,
) {
  const storage = readProjectAiStorage(projectId);
  const result = updater(storage);
  writeProjectAiStorage(projectId, storage, message);
  return result;
}

export function getProjectIdForThreadOrThrow(threadId: string) {
  const projectId = findProjectIdForThreadSync(threadId);
  invariant(projectId, "未找到 agent thread。");
  return projectId;
}

export function getProjectIdForNodeOrThrow(nodeId: string) {
  const projectId = findProjectIdForNodeSync(nodeId);
  invariant(projectId, "未找到 agent 节点。");
  return projectId;
}

export function getProjectIdForRunOrThrow(runId: string) {
  const projectId = findProjectIdForRunSync(runId);
  invariant(projectId, "未找到 agent run。");
  return projectId;
}

export function getThreadOrThrow(index: AiIndexPayload, threadId: string) {
  const thread = index.threads.find((entry) => entry.id === threadId);
  invariant(thread, "未找到 agent thread。");
  return thread;
}

export function getNodeOrThrow(index: AiIndexPayload, nodeId: string) {
  const node = index.nodes.find((entry) => entry.id === nodeId);
  invariant(node, "未找到 agent 节点。");
  return node;
}

export function getRunOrThrow(index: AiIndexPayload, runId: string) {
  const run = index.runs.find((entry) => entry.id === runId);
  invariant(run, "未找到 agent run。");
  return run;
}

export function getProjectStateRow(index: AiIndexPayload, projectId: string, agentProfile: string) {
  return index.projectState.find(
    (entry) => entry.projectId === projectId && entry.agentProfile === agentProfile,
  );
}

export function getNodeRowsByThread(
  index: AiIndexPayload,
  threadId: string,
  parentNodeId: string | null,
) {
  return sortByCreatedAt(
    index.nodes.filter(
      (entry) => entry.threadId === threadId && entry.parentNodeId === parentNodeId,
    ),
  );
}

export function touchThread(index: AiIndexPayload, threadId: string, timestamp = now()) {
  const thread = getThreadOrThrow(index, threadId);
  replaceRowById(index.threads, {
    ...thread,
    updatedAt: timestamp,
  });
}

export function upsertProjectState(
  index: AiIndexPayload,
  projectId: string,
  agentProfile: string,
  activeThreadId: string | null,
) {
  getProjectOrThrow(projectId);
  const stateId = `${projectId}:${agentProfile}`;
  const timestamp = now();
  const existing = getProjectStateRow(index, projectId, agentProfile);
  const next: AgentProjectStateRow = existing
    ? {
        ...existing,
        activeThreadId,
        updatedAt: timestamp,
      }
    : {
        id: stateId,
        projectId,
        agentProfile,
        activeThreadId,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
  replaceRowById(index.projectState, next);
  return mapProjectStateRow(next);
}

export function getLatestUnarchivedThreadRow(
  index: AiIndexPayload,
  projectId: string,
  agentProfile: string,
) {
  return sortByUpdatedDescCreatedDesc(
    index.threads.filter(
      (entry) =>
        entry.projectId === projectId &&
        entry.agentProfile === agentProfile &&
        entry.archivedAt == null,
    ),
  )[0];
}

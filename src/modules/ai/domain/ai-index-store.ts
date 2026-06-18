import {
  aiRunsRef,
  commitCustomRefSync,
  readFilesAtRefSync,
} from "@/modules/workspace/domain/git-storage/git-store";
import { parseJsonl, stringifyJsonl } from "@/modules/workspace/domain/git-storage/jsonl";
import { readProjectMetaSync } from "@/modules/workspace/domain/git-storage/project-meta-store";

import type {
  AgentProjectStateRow,
  AgentRunRow,
  AgentThreadNodeRow,
  AgentThreadRow,
} from "./types";

export interface AiIndexPayload {
  threads: AgentThreadRow[];
  projectState: AgentProjectStateRow[];
  nodes: AgentThreadNodeRow[];
  runs: AgentRunRow[];
}

function sortByCreatedAt<T extends { createdAt: number }>(rows: T[]) {
  return [...rows].sort((left, right) => left.createdAt - right.createdAt);
}

function normalizeIndexPayload(payload: AiIndexPayload): AiIndexPayload {
  return {
    threads: sortByCreatedAt(payload.threads),
    projectState: sortByCreatedAt(payload.projectState),
    nodes: sortByCreatedAt(payload.nodes),
    runs: sortByCreatedAt(payload.runs),
  };
}

export function createEmptyAiIndexPayload(): AiIndexPayload {
  return {
    threads: [],
    projectState: [],
    nodes: [],
    runs: [],
  };
}

export function readAiIndexSync(projectId: string): AiIndexPayload {
  readProjectMetaSync(projectId);
  try {
    const files = readFilesAtRefSync({ projectId, ref: aiRunsRef() });
    return normalizeIndexPayload({
      threads: parseJsonl<AgentThreadRow>(files["threads.jsonl"]),
      projectState: parseJsonl<AgentProjectStateRow>(files["project-state.jsonl"]),
      nodes: parseJsonl<AgentThreadNodeRow>(files["nodes.jsonl"]),
      runs: parseJsonl<AgentRunRow>(files["runs.jsonl"]),
    });
  } catch {
    return createEmptyAiIndexPayload();
  }
}

export function writeAiIndexSync(
  projectId: string,
  payload: AiIndexPayload,
  message = "Update AI run index",
) {
  readProjectMetaSync(projectId);
  const normalized = normalizeIndexPayload(payload);
  commitCustomRefSync({
    projectId,
    ref: aiRunsRef(),
    message,
    files: {
      "threads.jsonl": stringifyJsonl(normalized.threads),
      "project-state.jsonl": stringifyJsonl(normalized.projectState),
      "nodes.jsonl": stringifyJsonl(normalized.nodes),
      "runs.jsonl": stringifyJsonl(normalized.runs),
    },
  });
  return normalized;
}

export function updateAiIndexSync(
  projectId: string,
  updater: (_payload: AiIndexPayload) => AiIndexPayload,
  message = "Update AI run index",
) {
  return writeAiIndexSync(projectId, updater(readAiIndexSync(projectId)), message);
}

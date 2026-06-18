import fs from "node:fs";
import path from "node:path";

import { invariant } from "@/shared/lib/domain";

import { commitCustomRefSync, metaRef, readFilesAtRefSync } from "./git-store";
import { parseJsonl, stringifyJsonl } from "./jsonl";
import { ensureStorageRoot } from "./paths";
import type {
  BranchIndexRow,
  ProjectIndexRow,
  ProjectMetaPayload,
  WorkspaceIndexRow,
} from "./types";

function repoProjectIdFromDirname(dirname: string) {
  return dirname.endsWith(".git") ? dirname.slice(0, -4) : null;
}

function normalizePayload(payload: ProjectMetaPayload): ProjectMetaPayload {
  return {
    project: {
      ...payload.project,
      defaultBranchId: payload.project.defaultBranchId ?? null,
      description: payload.project.description ?? null,
    },
    branches: payload.branches.map((branch) => ({
      ...branch,
      forkedFromCommitId: branch.forkedFromCommitId ?? null,
    })),
    workspaces: payload.workspaces.map((workspace) => ({
      ...workspace,
    })),
  };
}

function parsePayload(files: Record<string, string>): ProjectMetaPayload {
  const projectJson = files["project.json"];
  invariant(projectJson, "缺少 project.json。");
  const project = JSON.parse(projectJson) as ProjectIndexRow;
  const branches = parseJsonl<BranchIndexRow>(files["branches.jsonl"]);
  const workspaces = parseJsonl<WorkspaceIndexRow>(files["workspaces.jsonl"]);

  return normalizePayload({
    project: {
      ...project,
      description: project.description ?? null,
      defaultBranchId: project.defaultBranchId ?? null,
    },
    branches,
    workspaces,
  });
}

export function tryReadProjectMetaSync(projectId: string): ProjectMetaPayload | null {
  try {
    return parsePayload(readFilesAtRefSync({ projectId, ref: metaRef() }));
  } catch {
    return null;
  }
}

export function readProjectMetaSync(projectId: string): ProjectMetaPayload {
  const payload = tryReadProjectMetaSync(projectId);
  invariant(payload, "未找到项目。");
  return payload;
}

export function listProjectIdsFromReposSync() {
  const reposDir = path.join(ensureStorageRoot(), "repos");
  const entries = fs.existsSync(reposDir) ? fs.readdirSync(reposDir, { withFileTypes: true }) : [];
  return entries
    .flatMap((entry) => {
      if (!entry.isDirectory()) return [];
      const projectId = repoProjectIdFromDirname(entry.name);
      return projectId ? [projectId] : [];
    })
    .sort((left, right) => left.localeCompare(right));
}

export function listProjectMetaSync() {
  return listProjectIdsFromReposSync()
    .flatMap((projectId) => {
      const payload = tryReadProjectMetaSync(projectId);
      return payload ? [payload] : [];
    })
    .sort((left, right) => right.project.updatedAt - left.project.updatedAt);
}

export function listProjectRowsSync() {
  return listProjectMetaSync().map((payload) => payload.project);
}

export function findProjectMetaByBranchIdSync(branchId: string) {
  return listProjectMetaSync().find((payload) =>
    payload.branches.some((branch) => branch.id === branchId),
  );
}

export function findProjectMetaByWorkspaceIdSync(workspaceId: string) {
  return listProjectMetaSync().find((payload) =>
    payload.workspaces.some((workspace) => workspace.id === workspaceId),
  );
}

export function writeProjectMetaSync(
  payload: ProjectMetaPayload,
  message = "Update project metadata",
) {
  const normalized = normalizePayload(payload);
  commitCustomRefSync({
    projectId: normalized.project.id,
    ref: metaRef(),
    message,
    replace: true,
    files: {
      "project.json": `${JSON.stringify(normalized.project, null, 2)}\n`,
      "branches.jsonl": stringifyJsonl(normalized.branches),
      "workspaces.jsonl": stringifyJsonl(normalized.workspaces),
    },
  });
  return normalized;
}

export function createProjectMetaSync(project: ProjectIndexRow) {
  return writeProjectMetaSync(
    {
      project,
      branches: [],
      workspaces: [],
    },
    "Create project metadata",
  );
}

export function updateProjectMetaSync(
  projectId: string,
  updater: (_payload: ProjectMetaPayload) => ProjectMetaPayload,
  message = "Update project metadata",
) {
  const next = updater(readProjectMetaSync(projectId));
  invariant(next.project.id === projectId, "项目 ID 不可变。");
  return writeProjectMetaSync(next, message);
}

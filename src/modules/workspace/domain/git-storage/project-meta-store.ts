import fs from "node:fs";
import path from "node:path";

import { invariant } from "@/shared/lib/domain";

import { commitCustomRef, metaRef, readFilesAtRef } from "./git-store";
import { parseJsonl, stringifyJsonl } from "./jsonl";
import { ensureStorageRoot } from "./paths";
import type { BranchIndexRow, ProjectIndexRow, ProjectMetaPayload } from "./types";

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
  };
}

function parsePayload(files: Record<string, string>): ProjectMetaPayload {
  const projectJson = files["project.json"];
  invariant(projectJson, "缺少 project.json。");
  const project = JSON.parse(projectJson) as ProjectIndexRow;
  const branches = parseJsonl<BranchIndexRow>(files["branches.jsonl"]);
  return normalizePayload({
    project: {
      ...project,
      description: project.description ?? null,
      defaultBranchId: project.defaultBranchId ?? null,
    },
    branches,
  });
}

export async function tryReadProjectMeta(projectId: string): Promise<ProjectMetaPayload | null> {
  try {
    return parsePayload(await readFilesAtRef({ projectId, ref: metaRef() }));
  } catch {
    return null;
  }
}

export async function readProjectMeta(projectId: string): Promise<ProjectMetaPayload> {
  const payload = await tryReadProjectMeta(projectId);
  invariant(payload, "未找到项目。");
  return payload;
}

export function listProjectIdsFromRepos() {
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

export async function listProjectMeta() {
  const projectIds = listProjectIdsFromRepos();
  const results = await Promise.all(
    projectIds.map(async (projectId) => {
      const payload = await tryReadProjectMeta(projectId);
      return payload;
    }),
  );
  return results
    .filter((payload): payload is ProjectMetaPayload => payload != null)
    .sort((left, right) => right.project.updatedAt - left.project.updatedAt);
}

export async function listProjectRows() {
  const meta = await listProjectMeta();
  return meta.map((payload) => payload.project);
}

export async function writeProjectMeta(
  payload: ProjectMetaPayload,
  message = "Update project metadata",
) {
  const normalized = normalizePayload(payload);
  await commitCustomRef({
    projectId: normalized.project.id,
    ref: metaRef(),
    message,
    replace: true,
    files: {
      "project.json": `${JSON.stringify(normalized.project, null, 2)}\n`,
      "branches.jsonl": stringifyJsonl(normalized.branches),
    },
  });
  return normalized;
}

export async function createProjectMeta(project: ProjectIndexRow) {
  return await writeProjectMeta(
    {
      project,
      branches: [],
    },
    "Create project metadata",
  );
}

export async function updateProjectMeta(
  projectId: string,
  updater: (_payload: ProjectMetaPayload) => ProjectMetaPayload,
  message = "Update project metadata",
) {
  const payload = await readProjectMeta(projectId);
  const next = updater(payload);
  invariant(next.project.id === projectId, "项目 ID 不可变。");
  return await writeProjectMeta(next, message);
}

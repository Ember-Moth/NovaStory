import fs from "node:fs";
import path from "node:path";

import { invariant } from "@/shared/lib/domain";

import { metaRef, readTreeAtRef, touchProjectRepo, writeTreeAtRef } from "./git-store";
import { ensureStorageRoot, getProjectRepoGitDir } from "./paths";
import type { ProjectIndexRow, ProjectMetaPayload } from "./types";

function repoProjectIdFromDirname(dirname: string) {
  return dirname.endsWith(".git") ? dirname.slice(0, -4) : null;
}

function normalizePayload(payload: ProjectMetaPayload): ProjectMetaPayload {
  return {
    project: {
      ...payload.project,
      description: payload.project.description ?? null,
    },
  };
}

function parsePayload(files: Record<string, string>): ProjectMetaPayload {
  const projectJson = files["project.json"];
  invariant(projectJson, "缺少 project.json。");
  const project = JSON.parse(projectJson) as ProjectIndexRow;
  return normalizePayload({
    project: {
      ...project,
      description: project.description ?? null,
    },
  });
}

export async function tryReadProjectMeta(projectId: string): Promise<ProjectMetaPayload | null> {
  try {
    const payload = parsePayload(readTreeAtRef({ projectId, ref: metaRef() }));
    const gitdir = getProjectRepoGitDir(projectId);
    const stat = await fs.promises.stat(gitdir);
    payload.project.updatedAt = stat.mtime.getTime();
    return payload;
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

export function writeProjectMeta(payload: ProjectMetaPayload) {
  const normalized = normalizePayload(payload);
  const { updatedAt: _, ...storableProject } = normalized.project;
  writeTreeAtRef({
    projectId: normalized.project.id,
    ref: metaRef(),
    files: {
      "project.json": `${JSON.stringify(storableProject, null, 2)}\n`,
    },
  });
  touchProjectRepo(normalized.project.id);
  return normalized;
}

export function createProjectMeta(project: ProjectIndexRow) {
  return writeProjectMeta({ project });
}

export async function updateProjectMeta(
  projectId: string,
  updater: (_payload: ProjectMetaPayload) => ProjectMetaPayload,
) {
  const payload = await readProjectMeta(projectId);
  const next = updater(payload);
  invariant(next.project.id === projectId, "项目 ID 不可变。");
  return writeProjectMeta(next);
}

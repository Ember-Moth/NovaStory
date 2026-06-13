import { mkdirSync } from "node:fs";
import { join } from "node:path";

export function getStorageRoot() {
  return process.env.NOVEL_EVOLVER_DATA_DIR ?? join(import.meta.dir, "../../../../../data");
}

export function ensureStorageRoot() {
  const root = getStorageRoot();
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, "repos"), { recursive: true });
  mkdirSync(join(root, "worktrees"), { recursive: true });
  return root;
}

export function getProjectRepoGitDir(projectId: string) {
  return join(ensureStorageRoot(), "repos", `${projectId}.git`);
}

export function getProjectWorktreeDir(projectId: string, workspaceId: string) {
  return join(ensureStorageRoot(), "worktrees", projectId, workspaceId);
}

export function getProjectWorktreeRoot(projectId: string) {
  return join(ensureStorageRoot(), "worktrees", projectId);
}

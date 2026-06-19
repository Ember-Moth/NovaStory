import { join } from "node:path";

import { ensureProjectStorageRoot } from "@/shared/lib/storage-paths";

export function ensureStorageRoot() {
  return ensureProjectStorageRoot();
}

export function getProjectRepoGitDir(projectId: string) {
  return join(ensureStorageRoot(), "repos", `${projectId}.git`);
}

export function getProjectWorktreeDir(projectId: string, branchId: string) {
  return join(ensureStorageRoot(), "worktrees", projectId, branchId);
}

export function getProjectWorktreeRoot(projectId: string) {
  return join(ensureStorageRoot(), "worktrees", projectId);
}

import fs from "node:fs";

import git from "isomorphic-git";

import { getBranch, getBranchHeadCommitId } from "./branches";
import { branchRef, ensureProjectRepo } from "./git-storage/git-store";
import { getProjectWorktreeDir } from "./git-storage/paths";
import { getWorkspaceForBranchId } from "./lifecycle";
import type { WorkingTreeChangeItem, WorkingTreeStatus } from "./types";
import { readWorktreeState } from "./git-storage/worktree-state";

function kindFromMatrix(head: number, workdir: number): WorkingTreeChangeItem["kind"] | null {
  if (head === 0 && workdir !== 0) return "added";
  if (head !== 0 && workdir === 0) return "deleted";
  if (head !== workdir) return "modified";
  return null;
}

function areaForPath(filepath: string): keyof WorkingTreeStatus["areas"] {
  if (filepath.startsWith("novel-evolver/timeline")) return "timeline";
  if (filepath.startsWith("aux/") || filepath.startsWith("novel-evolver/aux")) return "aux";
  return "content";
}

export async function getWorkingTreeStatus(
  projectId: string,
  branchId: string,
): Promise<WorkingTreeStatus> {
  const branch = getBranch(projectId, branchId);
  const headCommitId = await getBranchHeadCommitId(projectId, branch.id);
  const workspace = getWorkspaceForBranchId(projectId, branch.id);
  if (!workspace) {
    return {
      hasChanges: false,
      headCommitId,
      areas: {
        content: { changed: false, changes: [] },
        timeline: { changed: false, changes: [] },
        aux: { changed: false, changes: [] },
      },
    };
  }
  const worktreePath = getProjectWorktreeDir(workspace.projectId, workspace.id);
  const gitdir = await ensureProjectRepo(branch.projectId);
  const matrix = await git.statusMatrix({
    fs,
    dir: worktreePath,
    gitdir,
    ref: branchRef(branch.id),
  });
  const state = readWorktreeState(worktreePath);
  if (!headCommitId && state.content.length === 0 && state.timeline.length === 0) {
    return {
      hasChanges: false,
      headCommitId: null,
      areas: {
        content: { changed: false, changes: [] },
        timeline: { changed: false, changes: [] },
        aux: { changed: false, changes: [] },
      },
    };
  }
  const areas: WorkingTreeStatus["areas"] = {
    content: { changed: false, changes: [] },
    timeline: { changed: false, changes: [] },
    aux: { changed: false, changes: [] },
  };
  for (const [filepath, head, workdir] of matrix) {
    const kind = kindFromMatrix(head, workdir);
    if (!kind) continue;
    const area = areas[areaForPath(filepath)];
    area.changes.push({ label: filepath, kind });
  }
  for (const area of Object.values(areas)) {
    area.changes.sort((a, b) => a.label.localeCompare(b.label));
    area.changed = area.changes.length > 0;
  }
  return {
    hasChanges: Object.values(areas).some((area) => area.changed),
    headCommitId,
    areas,
  };
}

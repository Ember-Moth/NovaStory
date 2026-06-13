import fs from "node:fs";

import git from "isomorphic-git";

import { getBranch } from "./branches";
import { ensureProjectRepo } from "./git-storage/git-store";
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

export async function getWorkingTreeStatus(branchId: string): Promise<WorkingTreeStatus> {
  const branch = getBranch(branchId);
  const workspace = getWorkspaceForBranchId(branch.id);
  if (!workspace) {
    return {
      hasChanges: false,
      headCommitId: branch.headCommitId,
      areas: {
        content: { changed: false, changes: [] },
        timeline: { changed: false, changes: [] },
        aux: { changed: false, changes: [] },
      },
    };
  }
  const gitdir = await ensureProjectRepo(branch.projectId);
  const matrix = await git.statusMatrix({ fs, dir: workspace.worktreePath, gitdir });
  const state = readWorktreeState(workspace.worktreePath);
  if (
    !branch.headCommitId &&
    state.content.length === 1 &&
    state.timeline.length === 0 &&
    state.auxLayers.length === 1
  ) {
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
    headCommitId: branch.headCommitId,
    areas,
  };
}

import fs from "node:fs";

import { createId, invariant, now } from "@/shared/lib/domain";

import { branchRef, deleteRefSync, resolveRef, writeRefSync } from "./git-storage/git-store";
import { getProjectWorktreeDir } from "./git-storage/paths";
import type { BranchIndexRow, ProjectIndexRow } from "./git-storage/types";
import { readProjectMetaSync, updateProjectMetaSync } from "./git-storage/project-meta-store";
import { getWorkspaceForBranchId } from "./lifecycle";

export type BranchRow = BranchIndexRow;

export interface BranchHeadRow {
  branchId: string;
  headCommitId: string | null;
}

function getProject(projectId: string): ProjectIndexRow {
  return readProjectMetaSync(projectId).project;
}

export function createBranch(input: {
  projectId: string;
  name: string;
  fromCommitId?: string | null;
}) {
  const project = getProject(input.projectId);
  const name = input.name.trim();
  invariant(name, "无法创建分支：分支名称不能为空。");
  const payload = readProjectMetaSync(project.id);
  const existing = payload.branches.find((branch) => branch.name === name);
  invariant(!existing, `无法创建分支：已存在名为「${name}」的分支。`);

  const branchId = createId("branch");
  const timestamp = now();
  const initialHeadCommitId = input.fromCommitId ?? null;
  if (initialHeadCommitId) {
    writeRefSync({
      projectId: project.id,
      ref: branchRef(branchId),
      value: initialHeadCommitId,
    });
  }

  updateProjectMetaSync(
    project.id,
    (current) => ({
      ...current,
      project: {
        ...current.project,
        updatedAt: timestamp,
      },
      branches: [
        ...current.branches,
        {
          id: branchId,
          projectId: project.id,
          name,
          forkedFromCommitId: input.fromCommitId ?? null,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    }),
    "Create branch metadata",
  );
  return getBranch(project.id, branchId);
}

export function listBranches(projectId: string) {
  return readProjectMetaSync(projectId).branches;
}

export function getBranch(projectId: string, branchId: string) {
  const branch = readProjectMetaSync(projectId).branches.find((item) => item.id === branchId);
  invariant(branch, "未找到分支。");
  return branch;
}

export async function getBranchHeadCommitId(projectId: string, branchId: string) {
  const branch = getBranch(projectId, branchId);
  return await resolveRef(branch.projectId, branchRef(branch.id));
}

export async function listBranchHeads(projectId: string): Promise<BranchHeadRow[]> {
  const branches = listBranches(projectId);
  return await Promise.all(
    branches.map(async (branch) => ({
      branchId: branch.id,
      headCommitId: await resolveRef(projectId, branchRef(branch.id)),
    })),
  );
}

export async function deleteBranch(projectId: string, branchId: string) {
  const branch = getBranch(projectId, branchId);
  const project = getProject(projectId);
  invariant(
    project.defaultBranchId !== branch.id,
    "无法删除：这是项目的默认分支。请先切换默认分支。",
  );
  const workspace = getWorkspaceForBranchId(projectId, branch.id);
  if (workspace) {
    await fs.promises.rm(getProjectWorktreeDir(workspace.projectId, workspace.id), {
      recursive: true,
      force: true,
    });
  }
  deleteRefSync({ projectId, ref: branchRef(branch.id) });
  updateProjectMetaSync(
    project.id,
    (payload) => {
      const timestamp = now();
      return {
        ...payload,
        project: {
          ...payload.project,
          updatedAt: timestamp,
        },
        branches: payload.branches.filter((item) => item.id !== branch.id),
        workspaces: payload.workspaces.filter((item) => item.branchId !== branch.id),
      };
    },
    "Delete branch metadata",
  );
}

import fs from "node:fs";

import { createId, invariant, now } from "@/shared/lib/domain";

import { branchRef, deleteRef, resolveRef, writeRef } from "./git-storage/git-store";
import { getProjectWorktreeDir } from "./git-storage/paths";
import type { BranchIndexRow, ProjectIndexRow } from "./git-storage/types";
import { readProjectMeta, updateProjectMeta } from "./git-storage/project-meta-store";
import { getWorkspaceForBranchId } from "./lifecycle";

export type BranchRow = BranchIndexRow;

export interface BranchHeadRow {
  branchId: string;
  headCommitId: string | null;
}

async function getProject(projectId: string): Promise<ProjectIndexRow> {
  return (await readProjectMeta(projectId)).project;
}

export async function createBranch(input: {
  projectId: string;
  name: string;
  fromCommitId?: string | null;
}) {
  const project = await getProject(input.projectId);
  const name = input.name.trim();
  invariant(name, "无法创建分支：分支名称不能为空。");
  const payload = await readProjectMeta(project.id);
  const existing = payload.branches.find((branch) => branch.name === name);
  invariant(!existing, `无法创建分支：已存在名为「${name}」的分支。`);

  const branchId = createId("branch");
  const timestamp = now();
  const initialHeadCommitId = input.fromCommitId ?? null;
  if (initialHeadCommitId) {
    await writeRef({
      projectId: project.id,
      ref: branchRef(branchId),
      value: initialHeadCommitId,
    });
  }

  await updateProjectMeta(
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
  return await getBranch(project.id, branchId);
}

export async function listBranches(projectId: string) {
  return (await readProjectMeta(projectId)).branches;
}

export async function getBranch(projectId: string, branchId: string) {
  const branch = (await readProjectMeta(projectId)).branches.find((item) => item.id === branchId);
  invariant(branch, "未找到分支。");
  return branch;
}

export async function getBranchHeadCommitId(projectId: string, branchId: string) {
  const branch = await getBranch(projectId, branchId);
  return await resolveRef(branch.projectId, branchRef(branch.id));
}

export async function listBranchHeads(projectId: string): Promise<BranchHeadRow[]> {
  const branches = await listBranches(projectId);
  return await Promise.all(
    branches.map(async (branch) => ({
      branchId: branch.id,
      headCommitId: await resolveRef(projectId, branchRef(branch.id)),
    })),
  );
}

export async function deleteBranch(projectId: string, branchId: string) {
  const branch = await getBranch(projectId, branchId);
  const project = await getProject(projectId);
  invariant(
    project.defaultBranchId !== branch.id,
    "无法删除：这是项目的默认分支。请先切换默认分支。",
  );
  const workspace = await getWorkspaceForBranchId(projectId, branch.id);
  if (workspace) {
    await fs.promises.rm(getProjectWorktreeDir(workspace.projectId, workspace.id), {
      recursive: true,
      force: true,
    });
  }
  await deleteRef({ projectId, ref: branchRef(branch.id) });
  await updateProjectMeta(
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

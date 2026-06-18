import { mkdirSync } from "node:fs";

import { createId, invariant, now } from "@/shared/lib/domain";

import { createBranch } from "./branches";
import { branchRef, checkoutCommitToWorktree, resolveRef } from "./git-storage/git-store";
import { getProjectWorktreeDir } from "./git-storage/paths";
import type { BranchIndexRow, ProjectIndexRow, WorkspaceIndexRow } from "./git-storage/types";
import { readProjectMeta, updateProjectMeta } from "./git-storage/project-meta-store";
import { seedEmptyWorktree } from "./git-storage/worktree-state";

export type WorkspaceRow = WorkspaceIndexRow;

async function getProjectRow(projectId: string): Promise<ProjectIndexRow> {
  return (await readProjectMeta(projectId)).project;
}

async function getBranchRow(projectId: string, branchId: string): Promise<BranchIndexRow> {
  const branch = (await readProjectMeta(projectId)).branches.find((item) => item.id === branchId);
  invariant(branch, "未找到分支。");
  return branch;
}

async function getWorkspaceRow(projectId: string, workspaceId: string) {
  return (
    (await readProjectMeta(projectId)).workspaces.find((item) => item.id === workspaceId) ?? null
  );
}

export async function listWorkspaces(projectId: string): Promise<WorkspaceRow[]> {
  return (await readProjectMeta(projectId)).workspaces;
}

export async function getWorkspace(projectId: string, workspaceId: string): Promise<WorkspaceRow> {
  const workspace = await getWorkspaceRow(projectId, workspaceId);
  invariant(workspace, "未找到工作区。");
  return workspace;
}

export async function getWorkspaceForBranchId(
  projectId: string,
  branchId: string,
): Promise<WorkspaceRow | null> {
  const payload = await readProjectMeta(projectId);
  return payload.workspaces.find((workspace) => workspace.branchId === branchId) ?? null;
}

export async function getDefaultWorkspace(projectId: string) {
  const project = await getProjectRow(projectId);
  return project.defaultBranchId
    ? ((await getWorkspaceForBranchId(projectId, project.defaultBranchId)) ?? undefined)
    : undefined;
}

export async function writeProjectMeta(projectId: string) {
  const payload = await readProjectMeta(projectId);
  await updateProjectMeta(projectId, () => payload);
}

export async function touchWorkspaceMeta(
  projectId: string,
  workspaceId: string,
  timestamp = now(),
) {
  await getWorkspace(projectId, workspaceId);
  await updateProjectMeta(
    projectId,
    (payload) => ({
      ...payload,
      project: {
        ...payload.project,
        updatedAt: timestamp,
      },
      workspaces: payload.workspaces.map((item) =>
        item.id === workspaceId ? { ...item, updatedAt: timestamp } : item,
      ),
    }),
    "Touch workspace metadata",
  );
}

export async function touchProjectMeta(projectId: string, timestamp = now()) {
  await updateProjectMeta(
    projectId,
    (payload) => ({
      ...payload,
      project: {
        ...payload.project,
        updatedAt: timestamp,
      },
    }),
    "Touch project metadata",
  );
}

export async function createWorkspaceForBranch(projectId: string, branchId: string, name?: string) {
  const branch = await getBranchRow(projectId, branchId);
  invariant(
    !(await getWorkspaceForBranchId(projectId, branch.id)),
    "无法创建工作区：该分支已存在工作区。",
  );

  const timestamp = now();
  const workspaceId = createId("workspace");
  const worktreePath = getProjectWorktreeDir(branch.projectId, workspaceId);

  mkdirSync(worktreePath, { recursive: true });
  seedEmptyWorktree(worktreePath);
  const headCommitId = await resolveRef(branch.projectId, branchRef(branch.id));
  if (headCommitId) {
    await checkoutCommitToWorktree({
      projectId: branch.projectId,
      workspaceId,
      commitId: headCommitId,
    });
  }

  await updateProjectMeta(
    branch.projectId,
    (payload) => ({
      ...payload,
      project: {
        ...payload.project,
        updatedAt: timestamp,
      },
      workspaces: [
        ...payload.workspaces,
        {
          id: workspaceId,
          projectId: branch.projectId,
          branchId: branch.id,
          name: name ?? branch.name,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    }),
    "Create workspace metadata",
  );
  return await getWorkspace(projectId, workspaceId);
}

export async function createDefaultWorkspace(projectId: string, name = "main") {
  const branch = await createBranch({ projectId, name });
  const workspaceId = createId("workspace");
  const worktreePath = getProjectWorktreeDir(projectId, workspaceId);
  mkdirSync(worktreePath, { recursive: true });
  seedEmptyWorktree(worktreePath);
  const timestamp = now();
  await updateProjectMeta(
    projectId,
    (payload) => ({
      ...payload,
      project: {
        ...payload.project,
        defaultBranchId: branch.id,
        updatedAt: timestamp,
      },
      workspaces: [
        ...payload.workspaces,
        {
          id: workspaceId,
          projectId,
          branchId: branch.id,
          name,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    }),
    "Create default workspace metadata",
  );
  const workspace = await getWorkspace(projectId, workspaceId);
  return workspace;
}

export async function createBranchWorkspace(input: {
  projectId: string;
  name: string;
  fromCommitId?: string | null;
  workspaceName?: string;
}) {
  const branch = await createBranch({
    projectId: input.projectId,
    name: input.name,
    fromCommitId: input.fromCommitId,
  });
  return await createWorkspaceForBranch(
    input.projectId,
    branch.id,
    input.workspaceName ?? input.name,
  );
}

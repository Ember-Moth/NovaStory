import { rmSync } from "node:fs";

import { createDefaultWorkspace } from "@/modules/workspace/domain";
import { getBranch } from "@/modules/workspace/domain/branches";
import { getCurrentBranch, setHeadRef } from "@/modules/workspace/domain/git-storage/git-store";
import { getProjectRepoGitDir } from "@/modules/workspace/domain/git-storage/paths";
import {
  createProjectMeta,
  listProjectRows,
  readProjectMeta,
  updateProjectMeta,
} from "@/modules/workspace/domain/git-storage/project-meta-store";
import type { ProjectIndexRow } from "@/modules/workspace/domain/git-storage/types";
import { rpcTags } from "@/rpc/tags";

type ProjectMutationInput = Pick<ProjectIndexRow, "id" | "name" | "description">;

/** 在返回给 API 消费者时注入 defaultBranchName（来自 HEAD） */
type ProjectRow = ProjectIndexRow & { defaultBranchName: string | null };

async function projectRowWithDefaultBranch(row: ProjectIndexRow): Promise<ProjectRow> {
  const branchName = getCurrentBranch(row.id);
  return { ...row, defaultBranchName: branchName };
}

export async function list(_input: undefined): Promise<{ data: ProjectRow[]; watch?: unknown[] }> {
  const data = await (async () => {
    const rows = await listProjectRows();
    return Promise.all(rows.map(projectRowWithDefaultBranch));
  })();
  const watch = [rpcTags.projectsList()];
  return { data, watch };
}

export async function get(input: {
  projectId: string;
}): Promise<{ data: ProjectRow; watch?: unknown[] }> {
  const data = await (async () => {
    const row = (await readProjectMeta(input.projectId)).project;
    return projectRowWithDefaultBranch(row);
  })();
  const watch = [rpcTags.project(input.projectId)];
  return { data, watch };
}

export async function create(
  input: ProjectMutationInput,
): Promise<{ data: { workspaceId: string }; invalidate?: unknown[] }> {
  const data = await (async () => {
    createProjectMeta({
      id: input.id,
      name: input.name,
      description: input.description ?? null,
      updatedAt: 0,
    });
    const workspace = await createDefaultWorkspace(input.id);
    return { workspaceId: workspace.id };
  })();
  const invalidate = [rpcTags.projectsList(), rpcTags.project(input.id)];
  return { data, invalidate };
}

export async function update(
  input: ProjectMutationInput,
): Promise<{ data: void; invalidate?: unknown[] }> {
  const data = await (async () => {
    await updateProjectMeta(input.id, (payload) => ({
      ...payload,
      project: {
        ...payload.project,
        name: input.name,
        description: input.description ?? null,
      },
    }));
  })();
  const invalidate = [rpcTags.projectsList(), rpcTags.project(input.id)];
  return { data, invalidate };
}

export async function setDefaultBranch(input: {
  projectId: string;
  branchId: string;
}): Promise<{ data: void; invalidate?: unknown[] }> {
  const data = await (async () => {
    const branch = getBranch(input.projectId, input.branchId);
    setHeadRef(input.projectId, branch.name);
  })();
  const invalidate = [rpcTags.projectsList(), rpcTags.project(input.projectId)];
  return { data, invalidate };
}

export async function deleteMutation(input: {
  id: string;
}): Promise<{ data: void; invalidate?: unknown[] }> {
  const data = await (async () => {
    rmSync(getProjectRepoGitDir(input.id), { recursive: true, force: true });
  })();
  const invalidate = [rpcTags.projectsList(), rpcTags.project(input.id)];
  return { data, invalidate };
}

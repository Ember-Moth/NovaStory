import { mutation, query } from "@codehz/rpc/core";
import { rmSync } from "node:fs";

import { createDefaultWorkspace } from "@/modules/workspace/domain";
import { getBranch } from "@/modules/workspace/domain/branches";
import {
  createProjectMeta,
  listProjectRows,
  readProjectMeta,
  updateProjectMeta,
} from "@/modules/workspace/domain/git-storage/project-meta-store";
import { getProjectRepoGitDir } from "@/modules/workspace/domain/git-storage/paths";
import type { ProjectIndexRow } from "@/modules/workspace/domain/git-storage/types";
import { getCurrentBranch, setHeadRef } from "@/modules/workspace/domain/git-storage/git-store";
import { rpcTags, type RpcTagList } from "@/rpc/tags";

type ProjectMutationInput = Pick<ProjectIndexRow, "id" | "name" | "description">;

/** 在返回给 API 消费者时注入 defaultBranchName（来自 HEAD） */
type ProjectRow = ProjectIndexRow & { defaultBranchName: string | null };

async function projectRowWithDefaultBranch(row: ProjectIndexRow): Promise<ProjectRow> {
  const branchName = getCurrentBranch(row.id);
  return { ...row, defaultBranchName: branchName };
}

export const list = query<void, ProjectRow[], RpcTagList>({
  watch: () => [rpcTags.projectsList()],
  handler: async () => {
    const rows = await listProjectRows();
    return Promise.all(rows.map(projectRowWithDefaultBranch));
  },
});

export const get = query<{ projectId: string }, ProjectRow, RpcTagList>({
  watch: ({ projectId }) => [rpcTags.project(projectId)],
  handler: async ({ projectId }) => {
    const row = (await readProjectMeta(projectId)).project;
    return projectRowWithDefaultBranch(row);
  },
});

export const create = mutation<ProjectMutationInput, { workspaceId: string }, RpcTagList>({
  invalidate: (input) => [rpcTags.projectsList(), rpcTags.project(input.id)],
  handler: async (input) => {
    createProjectMeta({
      id: input.id,
      name: input.name,
      description: input.description ?? null,
      updatedAt: 0,
    });
    const workspace = await createDefaultWorkspace(input.id);
    return { workspaceId: workspace.id };
  },
});

export const update = mutation<ProjectMutationInput, void, RpcTagList>({
  invalidate: (input) => [rpcTags.projectsList(), rpcTags.project(input.id)],
  handler: async (input) => {
    await updateProjectMeta(input.id, (payload) => ({
      ...payload,
      project: {
        ...payload.project,
        name: input.name,
        description: input.description ?? null,
      },
    }));
  },
});

export const setDefaultBranch = mutation<{ projectId: string; branchId: string }, void, RpcTagList>(
  {
    invalidate: ({ projectId }) => [rpcTags.projectsList(), rpcTags.project(projectId)],
    handler: async ({ projectId, branchId }) => {
      const branch = getBranch(projectId, branchId);
      setHeadRef(projectId, branch.name);
    },
  },
);

export const deleteMutation = mutation<{ id: string }, void, RpcTagList>({
  invalidate: ({ id }) => [rpcTags.projectsList(), rpcTags.project(id)],
  handler: async ({ id }) => {
    rmSync(getProjectRepoGitDir(id), { recursive: true, force: true });
  },
});

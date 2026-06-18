import { mutation, query } from "@codehz/rpc/core";
import { rmSync } from "node:fs";

import { createDefaultWorkspace } from "@/modules/workspace/domain";
import {
  createProjectMeta,
  listProjectRows,
  readProjectMeta,
  updateProjectMeta,
} from "@/modules/workspace/domain/git-storage/project-meta-store";
import { withProjectLock } from "@/modules/workspace/domain/git-storage/lock";
import {
  getProjectRepoGitDir,
  getProjectWorktreeRoot,
} from "@/modules/workspace/domain/git-storage/paths";
import type { ProjectIndexRow } from "@/modules/workspace/domain/git-storage/types";
import { invariant } from "@/shared/lib/domain";
import { rpcTags, type RpcTagList } from "@/rpc/tags";

type ProjectMutationInput = Pick<ProjectIndexRow, "id" | "name" | "description">;
type ProjectRow = ProjectIndexRow;

export const list = query<void, ProjectRow[], RpcTagList>({
  watch: () => [rpcTags.projectsList()],
  handler: async () => await listProjectRows(),
});

export const get = query<{ projectId: string }, ProjectRow, RpcTagList>({
  watch: ({ projectId }) => [rpcTags.project(projectId)],
  handler: async ({ projectId }) => {
    return (await readProjectMeta(projectId)).project;
  },
});

export const create = mutation<ProjectMutationInput, { workspaceId: string }, RpcTagList>({
  invalidate: (input) => [rpcTags.projectsList(), rpcTags.project(input.id)],
  handler: async (input) => {
    const timestamp = Date.now();
    await createProjectMeta({
      id: input.id,
      name: input.name,
      description: input.description ?? null,
      defaultBranchId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const workspace = await createDefaultWorkspace(input.id);
    return { workspaceId: workspace.id };
  },
});

export const update = mutation<ProjectMutationInput, void, RpcTagList>({
  invalidate: (input) => [rpcTags.projectsList(), rpcTags.project(input.id)],
  handler: async (input) => {
    await updateProjectMeta(
      input.id,
      (payload) => ({
        ...payload,
        project: {
          ...payload.project,
          name: input.name,
          description: input.description ?? null,
          updatedAt: Date.now(),
        },
      }),
      "Update project metadata",
    );
  },
});

export const setDefaultBranch = mutation<{ projectId: string; branchId: string }, void, RpcTagList>(
  {
    invalidate: ({ projectId }) => [rpcTags.projectsList(), rpcTags.project(projectId)],
    handler: async ({ projectId, branchId }) => {
      const payload = await readProjectMeta(projectId);
      const branch = payload.branches.find((item) => item.id === branchId);
      invariant(branch, "无法设置默认分支：该分支不属于当前项目。");

      await updateProjectMeta(
        projectId,
        (current) => ({
          ...current,
          project: {
            ...current.project,
            defaultBranchId: branch.id,
            updatedAt: Date.now(),
          },
        }),
        "Set default branch",
      );
    },
  },
);

export const deleteMutation = mutation<{ id: string }, void, RpcTagList>({
  invalidate: ({ id }) => [rpcTags.projectsList(), rpcTags.project(id)],
  handler: async ({ id }) => {
    const cleanup = () => {
      rmSync(getProjectRepoGitDir(id), { recursive: true, force: true });
      rmSync(getProjectWorktreeRoot(id), { recursive: true, force: true });
    };
    await withProjectLock(id, async () => {
      cleanup();
    });
  },
});

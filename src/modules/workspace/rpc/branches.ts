import { mutation, query } from "@codehz/rpc/core";

import {
  createBranch,
  deleteBranch,
  getBranch,
  listBranches,
  listBranchHeads,
} from "@/modules/workspace/domain";
import { type RpcTagList, rpcTags } from "@/rpc/tags";

export const list = query<{ projectId: string }, ReturnType<typeof listBranches>, RpcTagList>({
  watch: ({ projectId }) => [rpcTags.branchesByProject(projectId)],
  handler: ({ projectId }) => listBranches(projectId),
});

export const get = query<
  { projectId: string; branchId: string },
  ReturnType<typeof getBranch>,
  RpcTagList
>({
  watch: ({ branchId }) => [rpcTags.branch(branchId)],
  handler: ({ projectId, branchId }) => getBranch(projectId, branchId),
});

export const heads = query<{ projectId: string }, ReturnType<typeof listBranchHeads>, RpcTagList>({
  watch: ({ projectId }) => [rpcTags.branchHeadsByProject(projectId)],
  handler: ({ projectId }) => listBranchHeads(projectId),
});

export const create = mutation<
  { projectId: string; name: string; fromCommitId?: string | null },
  Awaited<ReturnType<typeof createBranch>>,
  RpcTagList
>({
  invalidate: (input) => [
    rpcTags.branchesByProject(input.projectId),
    rpcTags.branchHeadsByProject(input.projectId),
    rpcTags.workspacesByProject(input.projectId),
    rpcTags.project(input.projectId),
    rpcTags.projectsList(),
  ],
  handler: async (input) => await createBranch(input),
});

export const deleteMutation = mutation<{ projectId: string; branchId: string }, void, RpcTagList>({
  invalidate: (input) => [
    rpcTags.branchesByProject(input.projectId),
    rpcTags.branchHeadsByProject(input.projectId),
    rpcTags.branch(input.branchId),
    rpcTags.workspacesByProject(input.projectId),
    rpcTags.project(input.projectId),
    rpcTags.projectsList(),
  ],
  handler: async ({ projectId, branchId }) => await deleteBranch(projectId, branchId),
});

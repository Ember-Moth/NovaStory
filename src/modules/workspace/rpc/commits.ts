import { mutation, query } from "@codehz/rpc/core";

import { db } from "@/db";
import {
  checkoutCommit,
  createCommit,
  getBranch,
  getCommit,
  getWorkspace,
  getWorkingTreeStatus,
  listCommits,
} from "@/modules/workspace/domain";
import { getWorkspaceForBranch } from "@/modules/workspace/domain/internal/access";
import { rpcTags, type RpcTagList } from "@/rpc/tags";

export const history = query<{ branchId: string }, ReturnType<typeof listCommits>, RpcTagList>({
  watch: ({ branchId }) => [rpcTags.commitHistory(branchId)],
  handler: ({ branchId }) => listCommits(branchId),
});

export const workingTreeStatus = query<
  { branchId: string },
  ReturnType<typeof getWorkingTreeStatus>,
  RpcTagList
>({
  watch: ({ branchId }) => {
    const workspace = getWorkspaceForBranch(db, branchId);
    return workspace
      ? [
          rpcTags.branch(branchId),
          rpcTags.commitHistory(branchId),
          rpcTags.contentTree(workspace.id),
          rpcTags.timelineList(workspace.id),
          rpcTags.auxWorkspace(workspace.id),
        ]
      : [rpcTags.branch(branchId)];
  },
  handler: ({ branchId }) => getWorkingTreeStatus(branchId),
});

export const get = query<
  { commitId: string; projectId: string },
  ReturnType<typeof getCommit>,
  RpcTagList
>({
  watch: ({ commitId }) => [rpcTags.commit(commitId)],
  handler: ({ commitId, projectId }) => getCommit(commitId, projectId),
});

export const create = mutation<
  {
    branchId: string;
    message: string;
    author?: string | null;
    extraParents?: Array<{ parentId: string; mergeRole?: "normal" | "mainline" | "merged" }>;
  },
  ReturnType<typeof createCommit>,
  RpcTagList
>((input, ctx) => {
  const commit = createCommit(input);
  const branch = getBranch(input.branchId);
  ctx.invalidate(
    rpcTags.commitHistory(input.branchId),
    rpcTags.branch(input.branchId),
    rpcTags.branchesByProject(branch.projectId),
    rpcTags.project(branch.projectId),
    rpcTags.projectsList(),
  );
  return commit;
});

export const checkout = mutation<
  { workspaceId: string; commitId: string },
  ReturnType<typeof checkoutCommit>,
  RpcTagList
>((input, ctx) => {
  const commit = checkoutCommit(input);
  const workspace = getWorkspace(input.workspaceId);
  ctx.invalidate(
    rpcTags.workspace(workspace.id),
    rpcTags.contentTree(workspace.id),
    rpcTags.timelineList(workspace.id),
    rpcTags.auxWorkspace(workspace.id),
  );
  return commit;
});

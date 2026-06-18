import { mutation, query } from "@codehz/rpc/core";

import {
  checkoutCommit,
  createCommit,
  getBranch,
  getCommit,
  getWorkspace,
  getWorkspaceForBranchId,
  getWorkingTreeStatus,
  listCommits,
} from "@/modules/workspace/domain";
import { rpcTags, type RpcTagList } from "@/rpc/tags";

export const history = query<
  { projectId: string; branchId: string },
  Awaited<ReturnType<typeof listCommits>>,
  RpcTagList
>({
  watch: ({ branchId }) => [rpcTags.commitHistory(branchId)],
  handler: ({ projectId, branchId }) => listCommits(projectId, branchId),
});

export const workingTreeStatus = query<
  { projectId: string; branchId: string },
  Awaited<ReturnType<typeof getWorkingTreeStatus>>,
  RpcTagList
>({
  watch: ({ projectId, branchId }) => {
    const workspace = getWorkspaceForBranchId(projectId, branchId);
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
  handler: ({ projectId, branchId }) => getWorkingTreeStatus(projectId, branchId),
});

export const get = query<
  { commitId: string; projectId: string },
  Awaited<ReturnType<typeof getCommit>>,
  RpcTagList
>({
  watch: ({ commitId }) => [rpcTags.commit(commitId)],
  handler: ({ commitId, projectId }) => getCommit(commitId, projectId),
});

export const create = mutation<
  {
    projectId: string;
    branchId: string;
    message: string;
    author?: string | null;
    extraParents?: Array<{ parentId: string; mergeRole?: "normal" | "mainline" | "merged" }>;
  },
  Awaited<ReturnType<typeof createCommit>>,
  RpcTagList
>(async (input, ctx) => {
  const commit = await createCommit(input);
  const branch = getBranch(input.projectId, input.branchId);
  ctx.invalidate(
    rpcTags.commitHistory(input.branchId),
    rpcTags.branch(input.branchId),
    rpcTags.branchHeadsByProject(branch.projectId),
    rpcTags.branchesByProject(branch.projectId),
    rpcTags.project(branch.projectId),
    rpcTags.projectsList(),
  );
  return commit;
});

export const checkout = mutation<
  { projectId: string; workspaceId: string; commitId: string },
  Awaited<ReturnType<typeof checkoutCommit>>,
  RpcTagList
>(async (input, ctx) => {
  const commit = await checkoutCommit(input);
  const workspace = getWorkspace(input.projectId, input.workspaceId);
  ctx.invalidate(
    rpcTags.workspace(workspace.id),
    rpcTags.contentTree(workspace.id),
    rpcTags.timelineList(workspace.id),
    rpcTags.auxWorkspace(workspace.id),
  );
  return commit;
});

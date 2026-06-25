import type { SHA1 } from "nano-git";
import { mutation, query } from "@codehz/rpc/core";

import {
  checkoutCommit,
  createCommit,
  getBranch,
  getCommit,
  getCommitDiff,
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
  handler: async ({ projectId, branchId }) => await listCommits(projectId, branchId),
});

export const workingTreeStatus = query<
  { projectId: string; branchId: string },
  Awaited<ReturnType<typeof getWorkingTreeStatus>>,
  RpcTagList
>({
  handler: async ({ projectId, branchId }, ctx) => {
    ctx.watch(rpcTags.branch(branchId), rpcTags.commitHistory(branchId));
    const workspace = await getWorkspaceForBranchId(projectId, branchId);
    if (workspace) {
      ctx.watch(
        rpcTags.contentTree(workspace.id),
        rpcTags.timelineList(workspace.id),
        rpcTags.auxWorkspace(workspace.id),
      );
    } else {
      ctx.watch(rpcTags.workspacesByProject(projectId));
    }
    return await getWorkingTreeStatus(projectId, branchId);
  },
});

export const get = query<
  { commitId: string; projectId: string },
  Awaited<ReturnType<typeof getCommit>>,
  RpcTagList
>({
  watch: ({ commitId }) => [rpcTags.commit(commitId)],
  handler: async ({ commitId, projectId }) => await getCommit(commitId, projectId),
});

export const diff = query<
  { commitId: string; projectId: string },
  Awaited<ReturnType<typeof getCommitDiff>>,
  RpcTagList
>({
  watch: ({ commitId }) => [rpcTags.commit(commitId)],
  handler: async ({ commitId, projectId }) => await getCommitDiff(projectId, commitId),
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
  const branch = await getBranch(input.projectId, input.branchId);
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
  const commit = await checkoutCommit({ ...input, commitId: input.commitId as SHA1 });
  const workspace = await getWorkspace(input.projectId, input.workspaceId);
  ctx.invalidate(
    rpcTags.workspace(workspace.id),
    rpcTags.contentTree(workspace.id),
    rpcTags.timelineList(workspace.id),
    rpcTags.auxWorkspace(workspace.id),
  );
  return commit;
});

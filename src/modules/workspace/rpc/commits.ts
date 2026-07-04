import type { SHA1 } from "nano-git";

import {
  checkoutCommit,
  createCommit,
  getBranch,
  getCommit,
  getCommitDiff,
  getWorkingTreeStatus,
  getWorkspace,
  getWorkspaceForBranchId,
  listCommits,
} from "@/modules/workspace/domain";
import { type RpcTagList, rpcTags } from "@/rpc/tags";

export async function history(input: {
  projectId: string;
  branchId: string;
}): Promise<{ data: ReturnType<typeof listCommits>; watch?: unknown[] }> {
  const data = listCommits(input.projectId, input.branchId);
  const watch = [rpcTags.commitHistory(input.branchId)];
  return { data, watch };
}

export async function workingTreeStatus(input: {
  projectId: string;
  branchId: string;
}): Promise<{ data: Awaited<ReturnType<typeof getWorkingTreeStatus>>; watch?: unknown[] }> {
  const watchTags: (string | readonly unknown[])[] = [
    rpcTags.branch(input.branchId),
    rpcTags.commitHistory(input.branchId),
  ];
  const workspace = getWorkspaceForBranchId(input.projectId, input.branchId);
  if (workspace) {
    watchTags.push(
      rpcTags.contentTree(workspace.id),
      rpcTags.timelineList(workspace.id),
      rpcTags.auxWorkspace(workspace.id),
    );
  } else {
    watchTags.push(rpcTags.workspacesByProject(input.projectId));
  }
  const data = await getWorkingTreeStatus(input.projectId, input.branchId);
  return { data, watch: watchTags };
}

export async function get(input: {
  commitId: string;
  projectId: string;
}): Promise<{ data: Awaited<ReturnType<typeof getCommit>>; watch?: unknown[] }> {
  const data = await getCommit(input.commitId, input.projectId);
  const watch = [rpcTags.commit(input.commitId)];
  return { data, watch };
}

export async function diff(input: {
  commitId: string;
  projectId: string;
}): Promise<{ data: Awaited<ReturnType<typeof getCommitDiff>>; watch?: unknown[] }> {
  const data = await getCommitDiff(input.projectId, input.commitId);
  const watch = [rpcTags.commit(input.commitId)];
  return { data, watch };
}

export async function create(input: {
  projectId: string;
  branchId: string;
  message: string;
  author?: string | null;
  extraParents?: Array<{ parentId: string; mergeRole?: "normal" | "mainline" | "merged" }>;
}): Promise<{ data: Awaited<ReturnType<typeof createCommit>>; invalidate?: unknown[] }> {
  const data = await createCommit(input);
  const branch = getBranch(input.projectId, input.branchId);
  const invalidate = [
    rpcTags.commitHistory(input.branchId),
    rpcTags.branch(input.branchId),
    rpcTags.branchHeadsByProject(branch.projectId),
    rpcTags.branchesByProject(branch.projectId),
    rpcTags.project(branch.projectId),
    rpcTags.projectsList(),
  ];
  return { data, invalidate };
}

export async function checkout(input: {
  projectId: string;
  workspaceId: string;
  commitId: string;
}): Promise<{ data: Awaited<ReturnType<typeof checkoutCommit>>; invalidate?: unknown[] }> {
  const data = await checkoutCommit({ ...input, commitId: input.commitId as SHA1 });
  const workspace = getWorkspace(input.projectId, input.workspaceId);
  const invalidate = [
    rpcTags.workspace(workspace.id),
    rpcTags.contentTree(workspace.id),
    rpcTags.timelineList(workspace.id),
    rpcTags.auxWorkspace(workspace.id),
  ];
  return { data, invalidate };
}

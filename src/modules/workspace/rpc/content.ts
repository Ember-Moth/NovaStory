import {
  composeWritingContext as buildWritingContext,
  createContentNode,
  deleteContentNode,
  exportContentSubtree,
  getWorkspaceForBranchId,
  moveContentNode,
  revertContentChange,
  updateContentNode,
} from "@/modules/workspace/domain";
import { rpcTags } from "@/rpc/tags";

export async function create(
  input: Parameters<typeof createContentNode>[0],
): Promise<{ data: Awaited<ReturnType<typeof createContentNode>>; invalidate?: unknown[] }> {
  const data = await createContentNode(input);
  const invalidate = [rpcTags.contentTree(input.workspaceId)];
  return { data, invalidate };
}

export async function move(
  input: Parameters<typeof moveContentNode>[0],
): Promise<{ data: Awaited<ReturnType<typeof moveContentNode>>; invalidate?: unknown[] }> {
  const data = await moveContentNode(input);
  const invalidate = [rpcTags.contentTree(input.workspaceId)];
  return { data, invalidate };
}

export async function update(
  input: Parameters<typeof updateContentNode>[0],
): Promise<{ data: Awaited<ReturnType<typeof updateContentNode>>; invalidate?: unknown[] }> {
  const data = await updateContentNode(input);
  const invalidate = [rpcTags.contentTree(input.workspaceId)];
  return { data, invalidate };
}

export async function deleteMutation(
  input: Parameters<typeof deleteContentNode>[0],
): Promise<{ data: void; invalidate?: unknown[] }> {
  await deleteContentNode(input);
  const invalidate = [rpcTags.contentTree(input.workspaceId)];
  return { data: undefined, invalidate };
}

export async function exportSubtree(input: {
  projectId: string;
  workspaceId: string;
  rootNodeId?: string;
}): Promise<{ data: Awaited<ReturnType<typeof exportContentSubtree>>; watch?: unknown[] }> {
  const data = await exportContentSubtree(input.projectId, input.workspaceId, input.rootNodeId);
  const watch = [rpcTags.contentTree(input.workspaceId)];
  return { data, watch };
}

export async function composeWritingContext(input: {
  projectId: string;
  workspaceId: string;
  contentNodeId: string;
}): Promise<{ data: Awaited<ReturnType<typeof buildWritingContext>>; watch?: unknown[] }> {
  const data = await buildWritingContext(input.projectId, input.workspaceId, input.contentNodeId);
  const watch = [
    rpcTags.contentTree(input.workspaceId),
    rpcTags.auxWorkspace(input.workspaceId),
    rpcTags.timelineList(input.workspaceId),
  ];
  return { data, watch };
}

export async function revert(
  input: Parameters<typeof revertContentChange>[0],
): Promise<{ data: void; invalidate?: unknown[] }> {
  await revertContentChange(input);
  const workspace = getWorkspaceForBranchId(input.projectId, input.branchId);
  const invalidate = workspace
    ? [rpcTags.contentTree(workspace.id), rpcTags.commitHistory(input.branchId)]
    : undefined;
  return { data: undefined, ...(invalidate ? { invalidate } : {}) };
}

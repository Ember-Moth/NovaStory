import { mutation, query } from "@codehz/rpc/core";

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
import { rpcTags, type RpcTagList } from "@/rpc/tags";

export const create = mutation<
  Parameters<typeof createContentNode>[0],
  Awaited<ReturnType<typeof createContentNode>>,
  RpcTagList
>({
  invalidate: (input) => [rpcTags.contentTree(input.workspaceId)],
  handler: async (input) => await createContentNode(input),
});

export const move = mutation<
  Parameters<typeof moveContentNode>[0],
  Awaited<ReturnType<typeof moveContentNode>>,
  RpcTagList
>({
  invalidate: (input) => [rpcTags.contentTree(input.workspaceId)],
  handler: async (input) => await moveContentNode(input),
});

export const update = mutation<
  Parameters<typeof updateContentNode>[0],
  Awaited<ReturnType<typeof updateContentNode>>,
  RpcTagList
>({
  invalidate: (input) => [rpcTags.contentTree(input.workspaceId)],
  handler: async (input) => await updateContentNode(input),
});

export const deleteMutation = mutation<Parameters<typeof deleteContentNode>[0], void, RpcTagList>({
  invalidate: (input) => [rpcTags.contentTree(input.workspaceId)],
  handler: async (input) => {
    await deleteContentNode(input);
  },
});

export const exportSubtree = query<
  { projectId: string; workspaceId: string; rootNodeId?: string },
  Awaited<ReturnType<typeof exportContentSubtree>>,
  RpcTagList
>({
  watch: ({ workspaceId }) => [rpcTags.contentTree(workspaceId)],
  handler: async ({ projectId, workspaceId, rootNodeId }) =>
    await exportContentSubtree(projectId, workspaceId, rootNodeId),
});

export const composeWritingContext = query<
  { projectId: string; workspaceId: string; contentNodeId: string },
  Awaited<ReturnType<typeof buildWritingContext>>,
  RpcTagList
>({
  watch: ({ workspaceId }) => [
    rpcTags.contentTree(workspaceId),
    rpcTags.auxWorkspace(workspaceId),
    rpcTags.timelineList(workspaceId),
  ],
  handler: async ({ projectId, workspaceId, contentNodeId }) =>
    await buildWritingContext(projectId, workspaceId, contentNodeId),
});

export const revert = mutation<Parameters<typeof revertContentChange>[0], void, RpcTagList>(
  async (input, ctx) => {
    await revertContentChange(input);
    const workspace = getWorkspaceForBranchId(input.projectId, input.branchId);
    if (workspace) {
      ctx.invalidate(rpcTags.contentTree(workspace.id), rpcTags.commitHistory(input.branchId));
    }
  },
);

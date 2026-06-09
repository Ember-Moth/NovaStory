import { mutation, query } from "@codehz/rpc/core";

import {
  composeWritingContext as buildWritingContext,
  createContentNode,
  deleteContentNode,
  exportContentSubtree,
  moveContentNode,
  updateContentNode,
} from "@/domain";
import { rpcTags, type RpcTagList } from "@/server/rpc/tags";

export const create = mutation<
  Parameters<typeof createContentNode>[0],
  ReturnType<typeof createContentNode>,
  RpcTagList
>({
  invalidate: (input) => [rpcTags.contentTree(input.workspaceId)],
  handler: (input) => createContentNode(input),
});

export const move = mutation<
  Parameters<typeof moveContentNode>[0],
  ReturnType<typeof moveContentNode>,
  RpcTagList
>({
  invalidate: (input) => [rpcTags.contentTree(input.workspaceId)],
  handler: (input) => moveContentNode(input),
});

export const update = mutation<
  Parameters<typeof updateContentNode>[0],
  ReturnType<typeof updateContentNode>,
  RpcTagList
>({
  invalidate: (input) => [rpcTags.contentTree(input.workspaceId)],
  handler: (input) => updateContentNode(input),
});

export const deleteMutation = mutation<Parameters<typeof deleteContentNode>[0], void, RpcTagList>({
  invalidate: (input) => [rpcTags.contentTree(input.workspaceId)],
  handler: (input) => {
    deleteContentNode(input);
  },
});

export const exportSubtree = query<
  { workspaceId: string; rootNodeId?: string },
  ReturnType<typeof exportContentSubtree>,
  RpcTagList
>({
  watch: ({ workspaceId }) => [rpcTags.contentTree(workspaceId)],
  handler: ({ workspaceId, rootNodeId }) => exportContentSubtree(workspaceId, rootNodeId),
});

export const composeWritingContext = query<
  { workspaceId: string; contentNodeId: string },
  ReturnType<typeof buildWritingContext>,
  RpcTagList
>({
  watch: ({ workspaceId }) => [
    rpcTags.contentTree(workspaceId),
    rpcTags.auxWorkspace(workspaceId),
    rpcTags.timelineList(workspaceId),
  ],
  handler: ({ workspaceId, contentNodeId }) => buildWritingContext(workspaceId, contentNodeId),
});

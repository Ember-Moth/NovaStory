import { mutation, query } from "@codehz/rpc";

import {
  composeWritingContext as buildWritingContext,
  createContentNode,
  deleteContentNode,
  exportContentSubtree,
  moveContentNode,
  updateContentNode,
} from "@/domain";

export const create = mutation<
  Parameters<typeof createContentNode>[0],
  ReturnType<typeof createContentNode>
>((input, ctx) => {
  const node = createContentNode(input);
  ctx.invalidate(`content:${input.workspaceId}`);
  return node;
});

export const move = mutation<
  Parameters<typeof moveContentNode>[0],
  ReturnType<typeof moveContentNode>
>((input, ctx) => {
  const node = moveContentNode(input);
  ctx.invalidate(`content:${input.workspaceId}`);
  return node;
});

export const update = mutation<
  Parameters<typeof updateContentNode>[0],
  ReturnType<typeof updateContentNode>
>((input, ctx) => {
  const node = updateContentNode(input);
  ctx.invalidate(`content:${input.workspaceId}`);
  return node;
});

export const deleteMutation = mutation<Parameters<typeof deleteContentNode>[0], void>(
  (input, ctx) => {
    deleteContentNode(input);
    ctx.invalidate(`content:${input.workspaceId}`);
  },
);

export const exportSubtree = query<
  { workspaceId: string; rootNodeId?: string },
  ReturnType<typeof exportContentSubtree>
>(({ workspaceId, rootNodeId }, ctx) => {
  const tree = exportContentSubtree(workspaceId, rootNodeId);
  ctx.watch(`content:${workspaceId}`);
  return tree;
});

export const composeWritingContext = query<
  { workspaceId: string; contentNodeId: string },
  ReturnType<typeof composeWritingContext>
>(({ workspaceId, contentNodeId }, ctx) => {
  const context = buildWritingContext(workspaceId, contentNodeId);
  ctx.watch(`content:${workspaceId}`);
  ctx.watch(`aux:${workspaceId}`);
  ctx.watch(`timeline:${workspaceId}`);
  return context;
});

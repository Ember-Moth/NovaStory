import { mutation, query } from "@codehz/rpc/core";

import {
  createTimelinePoint,
  deleteTimelinePoint,
  listTimelinePoints,
  moveTimelinePoint,
  type ORIGIN_TIMELINE_POINT_ID,
  revertTimelineChange,
  updateTimelinePoint,
} from "@/modules/workspace/domain";
import { type RpcTagList, rpcTags } from "@/rpc/tags";

export const list = query<
  { projectId: string; workspaceId: string },
  Awaited<ReturnType<typeof listTimelinePoints>>,
  RpcTagList
>({
  watch: ({ workspaceId }) => [rpcTags.timelineList(workspaceId)],
  handler: async ({ projectId, workspaceId }) => await listTimelinePoints(projectId, workspaceId),
});

export const create = mutation<
  {
    projectId: string;
    workspaceId: string;
    afterPointId?: string | typeof ORIGIN_TIMELINE_POINT_ID;
    label: string;
    description?: string | null;
  },
  Awaited<ReturnType<typeof createTimelinePoint>>,
  RpcTagList
>(async (input, ctx) => {
  const point = await createTimelinePoint(input);
  ctx.invalidate(rpcTags.timelineList(input.workspaceId), rpcTags.auxWorkspace(input.workspaceId));
  return point;
});

export const move = mutation<
  {
    projectId: string;
    workspaceId: string;
    pointId: string;
    afterPointId?: string | typeof ORIGIN_TIMELINE_POINT_ID;
  },
  Awaited<ReturnType<typeof moveTimelinePoint>>,
  RpcTagList
>(async (input, ctx) => {
  const point = await moveTimelinePoint(input);
  ctx.invalidate(rpcTags.timelineList(input.workspaceId), rpcTags.auxWorkspace(input.workspaceId));
  return point;
});

export const deleteMutation = mutation<
  { projectId: string; workspaceId: string; pointId: string; purgeAuxLayers?: boolean },
  void,
  RpcTagList
>(async ({ projectId, workspaceId, pointId, purgeAuxLayers }, ctx) => {
  await deleteTimelinePoint(projectId, workspaceId, pointId, { purgeAuxLayers });
  ctx.invalidate(rpcTags.timelineList(workspaceId), rpcTags.auxWorkspace(workspaceId));
});

export const update = mutation<
  {
    projectId: string;
    workspaceId: string;
    pointId: string;
    label?: string;
    description?: string | null;
  },
  Awaited<ReturnType<typeof updateTimelinePoint>>,
  RpcTagList
>({
  invalidate: (input) => [rpcTags.timelineList(input.workspaceId)],
  handler: async (input) => await updateTimelinePoint(input),
});

export const revert = mutation<Parameters<typeof revertTimelineChange>[0], void, RpcTagList>(
  async (input, ctx) => {
    await revertTimelineChange(input);
    const workspaceId = input.branchId;
    ctx.invalidate(
      rpcTags.timelineList(workspaceId),
      rpcTags.contentTree(workspaceId),
      rpcTags.auxWorkspace(workspaceId),
      rpcTags.commitHistory(input.branchId),
    );
  },
);

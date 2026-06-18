import { mutation, query } from "@codehz/rpc/core";

import {
  createTimelinePoint,
  deleteTimelinePoint,
  listTimelinePoints,
  moveTimelinePoint,
  ORIGIN_TIMELINE_POINT_ID,
  updateTimelinePoint,
} from "@/modules/workspace/domain";
import { rpcTags, type RpcTagList } from "@/rpc/tags";

export const list = query<
  { projectId: string; workspaceId: string },
  ReturnType<typeof listTimelinePoints>,
  RpcTagList
>({
  watch: ({ workspaceId }) => [rpcTags.timelineList(workspaceId)],
  handler: ({ projectId, workspaceId }) => listTimelinePoints(projectId, workspaceId),
});

export const create = mutation<
  {
    projectId: string;
    workspaceId: string;
    afterPointId?: string | typeof ORIGIN_TIMELINE_POINT_ID;
    label: string;
    description?: string | null;
  },
  ReturnType<typeof createTimelinePoint>,
  RpcTagList
>((input, ctx) => {
  const point = createTimelinePoint(input);
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
  ReturnType<typeof moveTimelinePoint>,
  RpcTagList
>((input, ctx) => {
  const point = moveTimelinePoint(input);
  ctx.invalidate(rpcTags.timelineList(input.workspaceId), rpcTags.auxWorkspace(input.workspaceId));
  return point;
});

export const deleteMutation = mutation<
  { projectId: string; workspaceId: string; pointId: string; purgeAuxLayers?: boolean },
  void,
  RpcTagList
>(({ projectId, workspaceId, pointId, purgeAuxLayers }, ctx) => {
  deleteTimelinePoint(projectId, workspaceId, pointId, { purgeAuxLayers });
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
  ReturnType<typeof updateTimelinePoint>,
  RpcTagList
>({
  invalidate: (input) => [rpcTags.timelineList(input.workspaceId)],
  handler: (input) => updateTimelinePoint(input),
});

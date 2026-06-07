import { mutation, query } from "@codehz/rpc";

import {
  ORIGIN_TIMELINE_POINT_ID,
  createTimelinePoint,
  deleteTimelinePoint,
  listTimelinePoints,
  moveTimelinePoint,
  updateTimelinePoint,
} from "@/domain";

export const list = query<{ workspaceId: string }, ReturnType<typeof listTimelinePoints>>(
  ({ workspaceId }, ctx) => {
    const result = listTimelinePoints(workspaceId);
    ctx.watch(`timeline:${workspaceId}`);
    return result;
  },
);

export const create = mutation<
  {
    workspaceId: string;
    afterPointId?: string | typeof ORIGIN_TIMELINE_POINT_ID;
    key: string;
    label: string;
    description?: string | null;
  },
  ReturnType<typeof createTimelinePoint>
>((input, ctx) => {
  const point = createTimelinePoint(input);
  ctx.invalidate(`timeline:${input.workspaceId}`);
  return point;
});

export const move = mutation<
  {
    workspaceId: string;
    pointId: string;
    afterPointId?: string | typeof ORIGIN_TIMELINE_POINT_ID;
  },
  ReturnType<typeof moveTimelinePoint>
>((input, ctx) => {
  const point = moveTimelinePoint(input);
  ctx.invalidate(`timeline:${input.workspaceId}`);
  return point;
});

export const deleteMutation = mutation<{ workspaceId: string; pointId: string }, void>(
  ({ workspaceId, pointId }, ctx) => {
    deleteTimelinePoint(workspaceId, pointId);
    ctx.invalidate(`timeline:${workspaceId}`);
  },
);

export const update = mutation<
  {
    workspaceId: string;
    pointId: string;
    label?: string;
    description?: string | null;
  },
  ReturnType<typeof updateTimelinePoint>
>((input, ctx) => {
  const point = updateTimelinePoint(input);
  ctx.invalidate(`timeline:${input.workspaceId}`);
  return point;
});

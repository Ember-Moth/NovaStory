import { mutation, query } from "@codehz/rpc";

import { db } from "@/db";
import {
  ORIGIN_TIMELINE_POINT_ID,
  createTimelinePoint,
  deleteTimelinePoint,
  listTimelinePoints,
  moveTimelinePoint,
  updateTimelinePoint,
} from "@/domain";
import {
  listAffectedTimelinePointIdsForDelete,
  listAffectedTimelinePointIdsForInsert,
  listAffectedTimelinePointIdsForMove,
} from "@/domain/internal/timeline-chain";
import { auxSnapshotWatchKey, normalizeTimelinePointId } from "@/domain/internal/timeline-point";

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
  const afterPointId = normalizeTimelinePointId(input.afterPointId);
  const affectedPointIds = listAffectedTimelinePointIdsForInsert(
    db,
    input.workspaceId,
    afterPointId,
    point.id,
  );
  ctx.invalidate(
    `timeline:${input.workspaceId}`,
    ...affectedPointIds.map((pointId) => auxSnapshotWatchKey(input.workspaceId, pointId)),
  );
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
  const afterPointId = normalizeTimelinePointId(input.afterPointId);
  const affectedPointIds = listAffectedTimelinePointIdsForMove(
    db,
    input.workspaceId,
    input.pointId,
    afterPointId,
  );
  const point = moveTimelinePoint(input);
  ctx.invalidate(
    `timeline:${input.workspaceId}`,
    ...affectedPointIds.map((pointId) => auxSnapshotWatchKey(input.workspaceId, pointId)),
  );
  return point;
});

export const deleteMutation = mutation<
  { workspaceId: string; pointId: string; purgeAuxLayers?: boolean },
  void
>(({ workspaceId, pointId, purgeAuxLayers }, ctx) => {
  const affectedPointIds = listAffectedTimelinePointIdsForDelete(db, workspaceId, pointId);
  deleteTimelinePoint(workspaceId, pointId, { purgeAuxLayers });
  ctx.invalidate(`timeline:${workspaceId}`);
  ctx.invalidate(
    ...affectedPointIds.map((affectedPointId) => auxSnapshotWatchKey(workspaceId, affectedPointId)),
  );
  if (purgeAuxLayers) {
    ctx.invalidate(`aux:${workspaceId}`);
  }
});

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

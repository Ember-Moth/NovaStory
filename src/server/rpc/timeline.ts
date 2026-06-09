import { mutation, query } from "@codehz/rpc/core";

import { db } from "@/db";
import {
  createTimelinePoint,
  deleteTimelinePoint,
  listTimelinePoints,
  moveTimelinePoint,
  ORIGIN_TIMELINE_POINT_ID,
  updateTimelinePoint,
} from "@/domain";
import {
  listAffectedTimelinePointIdsForDelete,
  listAffectedTimelinePointIdsForInsert,
  listAffectedTimelinePointIdsForMove,
} from "@/domain/internal/timeline-chain";
import { normalizeTimelinePointId } from "@/domain/internal/timeline-point";
import { rpcTags, type RpcTagList } from "@/server/rpc/tags";

export const list = query<
  { workspaceId: string },
  ReturnType<typeof listTimelinePoints>,
  RpcTagList
>({
  watch: ({ workspaceId }) => [rpcTags.timelineList(workspaceId)],
  handler: ({ workspaceId }) => listTimelinePoints(workspaceId),
});

function auxSnapshotTags(workspaceId: string, pointIds: string[]) {
  return pointIds.map((pointId) => rpcTags.auxSnapshot(workspaceId, pointId));
}

export const create = mutation<
  {
    workspaceId: string;
    afterPointId?: string | typeof ORIGIN_TIMELINE_POINT_ID;
    key: string;
    label: string;
    description?: string | null;
  },
  ReturnType<typeof createTimelinePoint>,
  RpcTagList
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
    rpcTags.timelineList(input.workspaceId),
    ...auxSnapshotTags(input.workspaceId, affectedPointIds),
  );
  return point;
});

export const move = mutation<
  {
    workspaceId: string;
    pointId: string;
    afterPointId?: string | typeof ORIGIN_TIMELINE_POINT_ID;
  },
  ReturnType<typeof moveTimelinePoint>,
  RpcTagList
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
    rpcTags.timelineList(input.workspaceId),
    ...auxSnapshotTags(input.workspaceId, affectedPointIds),
  );
  return point;
});

export const deleteMutation = mutation<
  { workspaceId: string; pointId: string; purgeAuxLayers?: boolean },
  void,
  RpcTagList
>(({ workspaceId, pointId, purgeAuxLayers }, ctx) => {
  const affectedPointIds = listAffectedTimelinePointIdsForDelete(db, workspaceId, pointId);
  deleteTimelinePoint(workspaceId, pointId, { purgeAuxLayers });
  ctx.invalidate(rpcTags.timelineList(workspaceId));
  ctx.invalidate(...auxSnapshotTags(workspaceId, affectedPointIds));
  if (purgeAuxLayers) {
    ctx.invalidate(rpcTags.auxWorkspace(workspaceId));
  }
});

export const update = mutation<
  {
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

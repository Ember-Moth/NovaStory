import { mutation, query } from "@codehz/rpc";

import {
  ORIGIN_TIMELINE_POINT_ID,
  deleteAuxNodeAt,
  exportAuxSnapshotTree,
  linkAt,
  listAuxChangesAt,
  listAuxDirAt,
  mkdirAt,
  moveAuxNodeAt,
  readAuxByIdAt,
  readAuxByPathAt,
  restoreAuxNodeAt,
  writeFileAt,
} from "@/domain";
import { auxSnapshotWatchKey, normalizeTimelinePointId } from "@/domain/internal/timeline-point";

export const mkdir = mutation<Parameters<typeof mkdirAt>[0], ReturnType<typeof mkdirAt>>(
  (input, ctx) => {
    const node = mkdirAt(input);
    ctx.invalidate(`aux:${input.workspaceId}`);
    return node;
  },
);

export const writeFile = mutation<
  Parameters<typeof writeFileAt>[0],
  ReturnType<typeof writeFileAt>
>((input, ctx) => {
  const node = writeFileAt(input);
  ctx.invalidate(`aux:${input.workspaceId}`);
  return node;
});

export const link = mutation<Parameters<typeof linkAt>[0], ReturnType<typeof linkAt>>(
  (input, ctx) => {
    const node = linkAt(input);
    ctx.invalidate(`aux:${input.workspaceId}`);
    return node;
  },
);

export const move = mutation<Parameters<typeof moveAuxNodeAt>[0], ReturnType<typeof moveAuxNodeAt>>(
  (input, ctx) => {
    const node = moveAuxNodeAt(input);
    ctx.invalidate(`aux:${input.workspaceId}`);
    return node;
  },
);

export const deleteMutation = mutation<Parameters<typeof deleteAuxNodeAt>[0], void>(
  (input, ctx) => {
    deleteAuxNodeAt(input);
    ctx.invalidate(`aux:${input.workspaceId}`);
  },
);

export const restore = mutation<Parameters<typeof restoreAuxNodeAt>[0], void>((input, ctx) => {
  restoreAuxNodeAt(input);
  ctx.invalidate(`aux:${input.workspaceId}`);
});

export const readById = query<
  { workspaceId: string; pointId?: string | typeof ORIGIN_TIMELINE_POINT_ID; nodeId: string },
  ReturnType<typeof readAuxByIdAt>
>(({ workspaceId, pointId, nodeId }, ctx) => {
  const result = readAuxByIdAt(workspaceId, pointId, nodeId);
  ctx.watch(`aux:${workspaceId}`);
  ctx.watch(auxSnapshotWatchKey(workspaceId, normalizeTimelinePointId(pointId)));
  return result;
});

export const readByPath = query<
  { workspaceId: string; pointId?: string | typeof ORIGIN_TIMELINE_POINT_ID; path: string },
  ReturnType<typeof readAuxByPathAt>
>(({ workspaceId, pointId, path }, ctx) => {
  const result = readAuxByPathAt(workspaceId, pointId, path);
  ctx.watch(`aux:${workspaceId}`);
  ctx.watch(auxSnapshotWatchKey(workspaceId, normalizeTimelinePointId(pointId)));
  return result;
});

export const listDir = query<
  {
    workspaceId: string;
    pointId?: string | typeof ORIGIN_TIMELINE_POINT_ID;
    dirId?: string;
    path?: string;
  },
  ReturnType<typeof listAuxDirAt>
>(({ workspaceId, pointId, dirId, path }, ctx) => {
  const result = listAuxDirAt(workspaceId, pointId, { dirId, path });
  ctx.watch(`aux:${workspaceId}`);
  ctx.watch(auxSnapshotWatchKey(workspaceId, normalizeTimelinePointId(pointId)));
  return result;
});

export const snapshotTree = query<
  { workspaceId: string; pointId?: string | typeof ORIGIN_TIMELINE_POINT_ID },
  ReturnType<typeof exportAuxSnapshotTree>
>(({ workspaceId, pointId }, ctx) => {
  const result = exportAuxSnapshotTree(workspaceId, pointId);
  ctx.watch(`aux:${workspaceId}`);
  ctx.watch(auxSnapshotWatchKey(workspaceId, normalizeTimelinePointId(pointId)));
  return result;
});

export const listChangesAt = query<
  { workspaceId: string; pointId: string },
  ReturnType<typeof listAuxChangesAt>
>(({ workspaceId, pointId }, ctx) => {
  const result = listAuxChangesAt(workspaceId, pointId);
  ctx.watch(`aux:${workspaceId}`);
  ctx.watch(`timeline:${workspaceId}`);
  return result;
});

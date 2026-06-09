import { mutation, query } from "@codehz/rpc/core";

import {
  deleteAuxNodeAt,
  exportAuxSnapshotTree,
  linkAt,
  listAuxChangesAt,
  listAuxDirAt,
  mkdirAt,
  moveAuxNodeAt,
  ORIGIN_TIMELINE_POINT_ID,
  readAuxByIdAt,
  readAuxByPathAt,
  restoreAuxNodeAt,
  writeFileAt,
} from "@/domain";
import { normalizeTimelinePointId } from "@/domain/internal/timeline-point";
import { rpcTags, type RpcTagList } from "@/server/rpc/tags";

function auxSnapshotTags(input: {
  workspaceId: string;
  pointId?: string | typeof ORIGIN_TIMELINE_POINT_ID;
}) {
  return [
    rpcTags.auxWorkspace(input.workspaceId),
    rpcTags.auxSnapshot(input.workspaceId, normalizeTimelinePointId(input.pointId)),
  ];
}

export const mkdir = mutation<
  Parameters<typeof mkdirAt>[0],
  ReturnType<typeof mkdirAt>,
  RpcTagList
>({
  invalidate: (input) => [rpcTags.auxWorkspace(input.workspaceId)],
  handler: (input) => mkdirAt(input),
});

export const writeFile = mutation<
  Parameters<typeof writeFileAt>[0],
  ReturnType<typeof writeFileAt>,
  RpcTagList
>({
  invalidate: (input) => [rpcTags.auxWorkspace(input.workspaceId)],
  handler: (input) => writeFileAt(input),
});

export const link = mutation<Parameters<typeof linkAt>[0], ReturnType<typeof linkAt>, RpcTagList>({
  invalidate: (input) => [rpcTags.auxWorkspace(input.workspaceId)],
  handler: (input) => linkAt(input),
});

export const move = mutation<
  Parameters<typeof moveAuxNodeAt>[0],
  ReturnType<typeof moveAuxNodeAt>,
  RpcTagList
>({
  invalidate: (input) => [rpcTags.auxWorkspace(input.workspaceId)],
  handler: (input) => moveAuxNodeAt(input),
});

export const deleteMutation = mutation<Parameters<typeof deleteAuxNodeAt>[0], void, RpcTagList>({
  invalidate: (input) => [rpcTags.auxWorkspace(input.workspaceId)],
  handler: (input) => {
    deleteAuxNodeAt(input);
  },
});

export const restore = mutation<Parameters<typeof restoreAuxNodeAt>[0], void, RpcTagList>({
  invalidate: (input) => [rpcTags.auxWorkspace(input.workspaceId)],
  handler: (input) => {
    restoreAuxNodeAt(input);
  },
});

export const readById = query<
  { workspaceId: string; pointId?: string | typeof ORIGIN_TIMELINE_POINT_ID; nodeId: string },
  ReturnType<typeof readAuxByIdAt>,
  RpcTagList
>({
  watch: auxSnapshotTags,
  handler: ({ workspaceId, pointId, nodeId }) => readAuxByIdAt(workspaceId, pointId, nodeId),
});

export const readByPath = query<
  { workspaceId: string; pointId?: string | typeof ORIGIN_TIMELINE_POINT_ID; path: string },
  ReturnType<typeof readAuxByPathAt>,
  RpcTagList
>({
  watch: auxSnapshotTags,
  handler: ({ workspaceId, pointId, path }) => readAuxByPathAt(workspaceId, pointId, path),
});

export const listDir = query<
  {
    workspaceId: string;
    pointId?: string | typeof ORIGIN_TIMELINE_POINT_ID;
    dirId?: string;
    path?: string;
  },
  ReturnType<typeof listAuxDirAt>,
  RpcTagList
>({
  watch: auxSnapshotTags,
  handler: ({ workspaceId, pointId, dirId, path }) =>
    listAuxDirAt(workspaceId, pointId, { dirId, path }),
});

export const snapshotTree = query<
  { workspaceId: string; pointId?: string | typeof ORIGIN_TIMELINE_POINT_ID },
  ReturnType<typeof exportAuxSnapshotTree>,
  RpcTagList
>({
  watch: auxSnapshotTags,
  handler: ({ workspaceId, pointId }) => exportAuxSnapshotTree(workspaceId, pointId),
});

export const listChangesAt = query<
  { workspaceId: string; pointId: string },
  ReturnType<typeof listAuxChangesAt>,
  RpcTagList
>({
  watch: ({ workspaceId }) => [
    rpcTags.auxWorkspace(workspaceId),
    rpcTags.timelineList(workspaceId),
  ],
  handler: ({ workspaceId, pointId }) => listAuxChangesAt(workspaceId, pointId),
});

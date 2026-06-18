import { mutation, query } from "@codehz/rpc/core";

import {
  deleteAuxNodeAt,
  exportAuxSnapshotTree,
  linkAt,
  listAuxChangesAt,
  listAuxDirAt,
  mkdirAt,
  normalizeTimelinePointId,
  moveAuxNodeAt,
  ORIGIN_TIMELINE_POINT_ID,
  readAuxByPathAt,
  restoreDeletedAuxNodeAt,
  retargetAuxSymlinkAt,
  writeFileAt,
} from "@/modules/workspace/domain";
import { rpcTags, type RpcTagList } from "@/rpc/tags";

function auxSnapshotTags(input: {
  projectId: string;
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

export const retargetSymlink = mutation<
  Parameters<typeof retargetAuxSymlinkAt>[0],
  ReturnType<typeof retargetAuxSymlinkAt>,
  RpcTagList
>({
  invalidate: (input) => [rpcTags.auxWorkspace(input.workspaceId)],
  handler: (input) => retargetAuxSymlinkAt(input),
});

export const deleteMutation = mutation<Parameters<typeof deleteAuxNodeAt>[0], void, RpcTagList>({
  invalidate: (input) => [rpcTags.auxWorkspace(input.workspaceId)],
  handler: (input) => {
    deleteAuxNodeAt(input);
  },
});

export const restoreDeleted = mutation<
  Parameters<typeof restoreDeletedAuxNodeAt>[0],
  ReturnType<typeof restoreDeletedAuxNodeAt>,
  RpcTagList
>({
  invalidate: (input) => [rpcTags.auxWorkspace(input.workspaceId)],
  handler: (input) => restoreDeletedAuxNodeAt(input),
});

export const readByPath = query<
  {
    projectId: string;
    workspaceId: string;
    pointId?: string | typeof ORIGIN_TIMELINE_POINT_ID;
    path: string;
  },
  ReturnType<typeof readAuxByPathAt>,
  RpcTagList
>({
  watch: auxSnapshotTags,
  handler: ({ projectId, workspaceId, pointId, path }) =>
    readAuxByPathAt(projectId, workspaceId, pointId, path),
});

export const listDir = query<
  {
    projectId: string;
    workspaceId: string;
    pointId?: string | typeof ORIGIN_TIMELINE_POINT_ID;
    path?: string;
  },
  ReturnType<typeof listAuxDirAt>,
  RpcTagList
>({
  watch: auxSnapshotTags,
  handler: ({ projectId, workspaceId, pointId, path }) =>
    listAuxDirAt(projectId, workspaceId, pointId, { path }),
});

export const snapshotTree = query<
  { projectId: string; workspaceId: string; pointId?: string | typeof ORIGIN_TIMELINE_POINT_ID },
  ReturnType<typeof exportAuxSnapshotTree>,
  RpcTagList
>({
  watch: auxSnapshotTags,
  handler: ({ projectId, workspaceId, pointId }) =>
    exportAuxSnapshotTree(projectId, workspaceId, pointId),
});

export const listChangesAt = query<
  { projectId: string; workspaceId: string; pointId: string },
  ReturnType<typeof listAuxChangesAt>,
  RpcTagList
>({
  watch: ({ workspaceId }) => [
    rpcTags.auxWorkspace(workspaceId),
    rpcTags.timelineList(workspaceId),
  ],
  handler: ({ projectId, workspaceId, pointId }) =>
    listAuxChangesAt(projectId, workspaceId, pointId),
});

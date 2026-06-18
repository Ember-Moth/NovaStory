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
  Awaited<ReturnType<typeof mkdirAt>>,
  RpcTagList
>({
  invalidate: (input) => [rpcTags.auxWorkspace(input.workspaceId)],
  handler: async (input) => await mkdirAt(input),
});

export const writeFile = mutation<
  Parameters<typeof writeFileAt>[0],
  Awaited<ReturnType<typeof writeFileAt>>,
  RpcTagList
>({
  invalidate: (input) => [rpcTags.auxWorkspace(input.workspaceId)],
  handler: async (input) => await writeFileAt(input),
});

export const link = mutation<
  Parameters<typeof linkAt>[0],
  Awaited<ReturnType<typeof linkAt>>,
  RpcTagList
>({
  invalidate: (input) => [rpcTags.auxWorkspace(input.workspaceId)],
  handler: async (input) => await linkAt(input),
});

export const move = mutation<
  Parameters<typeof moveAuxNodeAt>[0],
  Awaited<ReturnType<typeof moveAuxNodeAt>>,
  RpcTagList
>({
  invalidate: (input) => [rpcTags.auxWorkspace(input.workspaceId)],
  handler: async (input) => await moveAuxNodeAt(input),
});

export const retargetSymlink = mutation<
  Parameters<typeof retargetAuxSymlinkAt>[0],
  Awaited<ReturnType<typeof retargetAuxSymlinkAt>>,
  RpcTagList
>({
  invalidate: (input) => [rpcTags.auxWorkspace(input.workspaceId)],
  handler: async (input) => await retargetAuxSymlinkAt(input),
});

export const deleteMutation = mutation<Parameters<typeof deleteAuxNodeAt>[0], void, RpcTagList>({
  invalidate: (input) => [rpcTags.auxWorkspace(input.workspaceId)],
  handler: async (input) => {
    await deleteAuxNodeAt(input);
  },
});

export const restoreDeleted = mutation<
  Parameters<typeof restoreDeletedAuxNodeAt>[0],
  Awaited<ReturnType<typeof restoreDeletedAuxNodeAt>>,
  RpcTagList
>({
  invalidate: (input) => [rpcTags.auxWorkspace(input.workspaceId)],
  handler: async (input) => await restoreDeletedAuxNodeAt(input),
});

export const readByPath = query<
  {
    projectId: string;
    workspaceId: string;
    pointId?: string | typeof ORIGIN_TIMELINE_POINT_ID;
    path: string;
  },
  Awaited<ReturnType<typeof readAuxByPathAt>>,
  RpcTagList
>({
  watch: auxSnapshotTags,
  handler: async ({ projectId, workspaceId, pointId, path }) =>
    await readAuxByPathAt(projectId, workspaceId, pointId, path),
});

export const listDir = query<
  {
    projectId: string;
    workspaceId: string;
    pointId?: string | typeof ORIGIN_TIMELINE_POINT_ID;
    path?: string;
  },
  Awaited<ReturnType<typeof listAuxDirAt>>,
  RpcTagList
>({
  watch: auxSnapshotTags,
  handler: async ({ projectId, workspaceId, pointId, path }) =>
    await listAuxDirAt(projectId, workspaceId, pointId, { path }),
});

export const snapshotTree = query<
  { projectId: string; workspaceId: string; pointId?: string | typeof ORIGIN_TIMELINE_POINT_ID },
  Awaited<ReturnType<typeof exportAuxSnapshotTree>>,
  RpcTagList
>({
  watch: auxSnapshotTags,
  handler: async ({ projectId, workspaceId, pointId }) =>
    await exportAuxSnapshotTree(projectId, workspaceId, pointId),
});

export const listChangesAt = query<
  { projectId: string; workspaceId: string; pointId: string },
  Awaited<ReturnType<typeof listAuxChangesAt>>,
  RpcTagList
>({
  watch: ({ workspaceId }) => [
    rpcTags.auxWorkspace(workspaceId),
    rpcTags.timelineList(workspaceId),
  ],
  handler: async ({ projectId, workspaceId, pointId }) =>
    await listAuxChangesAt(projectId, workspaceId, pointId),
});

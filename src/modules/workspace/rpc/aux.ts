import {
  deleteAuxNodeAt,
  exportAuxSnapshotTree,
  linkAt,
  listAuxChangesAt,
  listAuxDirAt,
  mkdirAt,
  moveAuxNodeAt,
  normalizeTimelinePointId,
  type ORIGIN_TIMELINE_POINT_ID,
  readAuxByPathAt,
  restoreDeletedAuxNodeAt,
  retargetAuxSymlinkAt,
  revertAuxChange,
  writeFileAt,
} from "@/modules/workspace/domain";
import { rpcTags } from "@/rpc/tags";

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

export async function mkdir(
  input: Parameters<typeof mkdirAt>[0],
): Promise<{ data: Awaited<ReturnType<typeof mkdirAt>>; invalidate?: unknown[] }> {
  const data = await mkdirAt(input);
  const invalidate = [rpcTags.auxWorkspace(input.workspaceId)];
  return { data, ...(invalidate ? { invalidate } : {}) };
}

export async function writeFile(
  input: Parameters<typeof writeFileAt>[0],
): Promise<{ data: Awaited<ReturnType<typeof writeFileAt>>; invalidate?: unknown[] }> {
  const data = await writeFileAt(input);
  const invalidate = [rpcTags.auxWorkspace(input.workspaceId)];
  return { data, ...(invalidate ? { invalidate } : {}) };
}

export async function link(
  input: Parameters<typeof linkAt>[0],
): Promise<{ data: Awaited<ReturnType<typeof linkAt>>; invalidate?: unknown[] }> {
  const data = await linkAt(input);
  const invalidate = [rpcTags.auxWorkspace(input.workspaceId)];
  return { data, ...(invalidate ? { invalidate } : {}) };
}

export async function move(
  input: Parameters<typeof moveAuxNodeAt>[0],
): Promise<{ data: Awaited<ReturnType<typeof moveAuxNodeAt>>; invalidate?: unknown[] }> {
  const data = await moveAuxNodeAt(input);
  const invalidate = [rpcTags.auxWorkspace(input.workspaceId)];
  return { data, ...(invalidate ? { invalidate } : {}) };
}

export async function retargetSymlink(
  input: Parameters<typeof retargetAuxSymlinkAt>[0],
): Promise<{ data: Awaited<ReturnType<typeof retargetAuxSymlinkAt>>; invalidate?: unknown[] }> {
  const data = await retargetAuxSymlinkAt(input);
  const invalidate = [rpcTags.auxWorkspace(input.workspaceId)];
  return { data, ...(invalidate ? { invalidate } : {}) };
}

export async function deleteMutation(
  input: Parameters<typeof deleteAuxNodeAt>[0],
): Promise<{ data: void; invalidate?: unknown[] }> {
  await deleteAuxNodeAt(input);
  const invalidate = [rpcTags.auxWorkspace(input.workspaceId)];
  return { data: undefined, ...(invalidate ? { invalidate } : {}) };
}

export async function restoreDeleted(
  input: Parameters<typeof restoreDeletedAuxNodeAt>[0],
): Promise<{ data: Awaited<ReturnType<typeof restoreDeletedAuxNodeAt>>; invalidate?: unknown[] }> {
  const data = await restoreDeletedAuxNodeAt(input);
  const invalidate = [rpcTags.auxWorkspace(input.workspaceId)];
  return { data, ...(invalidate ? { invalidate } : {}) };
}

export async function revert(
  input: Parameters<typeof revertAuxChange>[0],
): Promise<{ data: void; invalidate?: unknown[] }> {
  await revertAuxChange(input);
  const workspaceId = input.branchId;
  const invalidate = [rpcTags.auxWorkspace(workspaceId), rpcTags.commitHistory(input.branchId)];
  return { data: undefined, ...(invalidate ? { invalidate } : {}) };
}

export async function readByPath(input: {
  projectId: string;
  workspaceId: string;
  pointId?: string | typeof ORIGIN_TIMELINE_POINT_ID;
  path: string;
}): Promise<{ data: Awaited<ReturnType<typeof readAuxByPathAt>>; watch?: unknown[] }> {
  const data = await readAuxByPathAt(input.projectId, input.workspaceId, input.pointId, input.path);
  const watch = auxSnapshotTags(input);
  return { data, ...(watch ? { watch } : {}) };
}

export async function listDir(input: {
  projectId: string;
  workspaceId: string;
  pointId?: string | typeof ORIGIN_TIMELINE_POINT_ID;
  path?: string;
}): Promise<{ data: Awaited<ReturnType<typeof listAuxDirAt>>; watch?: unknown[] }> {
  const data = await listAuxDirAt(input.projectId, input.workspaceId, input.pointId, {
    path: input.path,
  });
  const watch = auxSnapshotTags(input);
  return { data, ...(watch ? { watch } : {}) };
}

export async function snapshotTree(input: {
  projectId: string;
  workspaceId: string;
  pointId?: string | typeof ORIGIN_TIMELINE_POINT_ID;
}): Promise<{ data: Awaited<ReturnType<typeof exportAuxSnapshotTree>>; watch?: unknown[] }> {
  const data = await exportAuxSnapshotTree(input.projectId, input.workspaceId, input.pointId);
  const watch = auxSnapshotTags(input);
  return { data, ...(watch ? { watch } : {}) };
}

export async function listChangesAt(input: {
  projectId: string;
  workspaceId: string;
  pointId: string;
}): Promise<{ data: Awaited<ReturnType<typeof listAuxChangesAt>>; watch?: unknown[] }> {
  const data = await listAuxChangesAt(input.projectId, input.workspaceId, input.pointId);
  const watch = [rpcTags.auxWorkspace(input.workspaceId), rpcTags.timelineList(input.workspaceId)];
  return { data, ...(watch ? { watch } : {}) };
}

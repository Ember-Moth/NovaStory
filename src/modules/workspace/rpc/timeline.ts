import {
  createTimelinePoint,
  deleteTimelinePoint,
  listTimelinePoints,
  moveTimelinePoint,
  type ORIGIN_TIMELINE_POINT_ID,
  revertTimelineChange,
  updateTimelinePoint,
} from "@/modules/workspace/domain";
import { rpcTags } from "@/rpc/tags";

export async function list(input: {
  projectId: string;
  workspaceId: string;
}): Promise<{ data: Awaited<ReturnType<typeof listTimelinePoints>>; watch?: unknown[] }> {
  const data = await listTimelinePoints(input.projectId, input.workspaceId);
  const watch = [rpcTags.timelineList(input.workspaceId)];
  return { data, watch };
}

export async function create(input: {
  projectId: string;
  workspaceId: string;
  afterPointId?: string | typeof ORIGIN_TIMELINE_POINT_ID;
  label: string;
  description?: string | null;
}): Promise<{ data: Awaited<ReturnType<typeof createTimelinePoint>>; invalidate?: unknown[] }> {
  const data = await createTimelinePoint(input);
  const invalidate = [
    rpcTags.timelineList(input.workspaceId),
    rpcTags.auxWorkspace(input.workspaceId),
  ];
  return { data, invalidate };
}

export async function move(input: {
  projectId: string;
  workspaceId: string;
  pointId: string;
  afterPointId?: string | typeof ORIGIN_TIMELINE_POINT_ID;
}): Promise<{ data: Awaited<ReturnType<typeof moveTimelinePoint>>; invalidate?: unknown[] }> {
  const data = await moveTimelinePoint(input);
  const invalidate = [
    rpcTags.timelineList(input.workspaceId),
    rpcTags.auxWorkspace(input.workspaceId),
  ];
  return { data, invalidate };
}

export async function deleteMutation(input: {
  projectId: string;
  workspaceId: string;
  pointId: string;
  purgeAuxLayers?: boolean;
}): Promise<{ data: void; invalidate?: unknown[] }> {
  const data = await deleteTimelinePoint(input.projectId, input.workspaceId, input.pointId, {
    purgeAuxLayers: input.purgeAuxLayers,
  });
  const invalidate = [
    rpcTags.timelineList(input.workspaceId),
    rpcTags.auxWorkspace(input.workspaceId),
  ];
  return { data, invalidate };
}

export async function update(input: {
  projectId: string;
  workspaceId: string;
  pointId: string;
  label?: string;
  description?: string | null;
}): Promise<{ data: Awaited<ReturnType<typeof updateTimelinePoint>>; invalidate?: unknown[] }> {
  const data = await updateTimelinePoint(input);
  const invalidate = [rpcTags.timelineList(input.workspaceId)];
  return { data, invalidate };
}

export async function revert(
  input: Parameters<typeof revertTimelineChange>[0],
): Promise<{ data: void; invalidate?: unknown[] }> {
  const data = await revertTimelineChange(input);
  const workspaceId = input.branchId;
  const invalidate = [
    rpcTags.timelineList(workspaceId),
    rpcTags.contentTree(workspaceId),
    rpcTags.auxWorkspace(workspaceId),
    rpcTags.commitHistory(input.branchId),
  ];
  return { data, invalidate };
}

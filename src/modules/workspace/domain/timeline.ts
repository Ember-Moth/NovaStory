import { ORIGIN_TIMELINE_POINT_ID } from "@/modules/workspace/domain/constants";
import { createId, invariant } from "@/shared/lib/domain";

import { getWorkspace, touchWorkspaceMeta } from "./lifecycle";
import { getWorkdirForBranch, getBranchMapping } from "./git-storage/git-store";
import type { TimelinePointRef, TimelinePointView } from "./types";
import {
  AUX_TIMELINE_DIR,
  normalizePointId,
  orderTimelineRows,
  pointIdOrOrigin,
  readWorktreeStateFromWorkdir,
  writeWorktreeStateToWorkdir,
} from "./git-storage/worktree-state";
import type { WorktreeState } from "./git-storage/worktree-state";
import { listAnchoredTimelinePointIds } from "./content";

function touchWorkspaceAsync(projectId: string, workspaceId: string) {
  return touchWorkspaceMeta(projectId, workspaceId);
}

/** 通过 workspaceId（即分支名）解析 workdir key，再获取 VirtualWorkdir */
function resolveWorkdir(projectId: string, workspaceId: string) {
  const workdirKey = getBranchMapping(projectId, workspaceId);
  invariant(workdirKey, `没有关联的 workdir key: ${workspaceId}`);
  return getWorkdirForBranch(projectId, workdirKey);
}

/** 从 VirtualWorkdir 读取并返回状态 */
function readWorkdirState(projectId: string, workspaceId: string): WorktreeState {
  const wd = resolveWorkdir(projectId, workspaceId);
  invariant(wd, "工作目录未初始化");
  return readWorktreeStateFromWorkdir(wd);
}

/** 写回 VirtualWorkdir */
function writeWorkdirState(projectId: string, workspaceId: string, state: WorktreeState) {
  const wd = resolveWorkdir(projectId, workspaceId);
  invariant(wd, "工作目录未初始化");
  writeWorktreeStateToWorkdir(wd, state);
}

function originTimelinePoint(): TimelinePointView {
  return {
    id: ORIGIN_TIMELINE_POINT_ID,
    label: "原点",
    description: null,
    prevPointId: null,
    isImplicitOrigin: true,
  };
}

export async function listTimelinePoints(
  projectId: string,
  workspaceId: string,
): Promise<TimelinePointView[]> {
  const workspace = await getWorkspace(projectId, workspaceId);
  const state = readWorkdirState(workspace.projectId, workspace.id);
  return [
    originTimelinePoint(),
    ...orderTimelineRows(state.timeline).map((row) => ({
      id: row.id,
      label: row.label,
      description: row.description,
      prevPointId: pointIdOrOrigin(row.prevPointId),
      isImplicitOrigin: false,
    })),
  ];
}

function validatePoint(state: WorktreeState, pointId: TimelinePointRef) {
  const normalized = normalizePointId(pointId);
  invariant(
    !normalized || state.timeline.some((point) => point.id === normalized),
    "未找到时间点。",
  );
  return normalized;
}

export async function createTimelinePoint(input: {
  projectId: string;
  workspaceId: string;
  afterPointId?: string | typeof ORIGIN_TIMELINE_POINT_ID;
  label: string;
  description?: string | null;
}) {
  const results = await createTimelinePoints({
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    afterPointId: input.afterPointId,
    points: [{ label: input.label, description: input.description }],
  });
  return results[0]!;
}

export async function createTimelinePoints(input: {
  projectId: string;
  workspaceId: string;
  afterPointId?: string | typeof ORIGIN_TIMELINE_POINT_ID;
  points: Array<{ label: string; description?: string | null }>;
}) {
  const workspace = await getWorkspace(input.projectId, input.workspaceId);
  const state = readWorkdirState(workspace.projectId, workspace.id);
  invariant(input.points.length > 0, "至少需要创建一个时间点。");
  let prevPointId = validatePoint(state, input.afterPointId);
  const successor = state.timeline.find((point) => point.prevPointId === prevPointId);
  const created = input.points.map((point) => {
    const row = {
      id: createId("timeline"),
      label: point.label,
      description: point.description ?? null,
      prevPointId,
    };
    state.timeline.push(row);
    prevPointId = row.id;
    return row;
  });
  if (successor) successor.prevPointId = prevPointId;
  writeWorkdirState(workspace.projectId, workspace.id, state);
  await touchWorkspaceAsync(workspace.projectId, workspace.id);
  return created;
}

export async function moveTimelinePoint(input: {
  projectId: string;
  workspaceId: string;
  pointId: string;
  afterPointId?: string | typeof ORIGIN_TIMELINE_POINT_ID;
}) {
  invariant(input.pointId !== ORIGIN_TIMELINE_POINT_ID, "无法移动原点时间点。");
  const workspace = await getWorkspace(input.projectId, input.workspaceId);
  const state = readWorkdirState(workspace.projectId, workspace.id);
  const point = state.timeline.find((item) => item.id === input.pointId);
  invariant(point, "未找到时间点。");
  const afterPointId = validatePoint(state, input.afterPointId);
  invariant(point.id !== afterPointId, "无法移动：不能把时间点移动到自己后面。");
  const oldSuccessor = state.timeline.find((item) => item.prevPointId === point.id);
  const targetSuccessor = state.timeline.find((item) => item.prevPointId === afterPointId);
  if (oldSuccessor) oldSuccessor.prevPointId = point.prevPointId;
  point.prevPointId = afterPointId;
  if (targetSuccessor && targetSuccessor.id !== point.id) targetSuccessor.prevPointId = point.id;
  writeWorkdirState(workspace.projectId, workspace.id, state);
  await touchWorkspaceAsync(workspace.projectId, workspace.id);
  return point;
}

export async function updateTimelinePoint(input: {
  projectId: string;
  workspaceId: string;
  pointId: string;
  label?: string;
  description?: string | null;
}) {
  invariant(input.pointId !== ORIGIN_TIMELINE_POINT_ID, "无法修改原点时间点。");
  const workspace = await getWorkspace(input.projectId, input.workspaceId);
  const state = readWorkdirState(workspace.projectId, workspace.id);
  const point = state.timeline.find((item) => item.id === input.pointId);
  invariant(point, "未找到时间点。");
  if (input.label !== undefined) point.label = input.label;
  if (input.description !== undefined) point.description = input.description;
  writeWorkdirState(workspace.projectId, workspace.id, state);
  await touchWorkspaceAsync(workspace.projectId, workspace.id);
  return point;
}

export async function deleteTimelinePoint(
  projectId: string,
  workspaceId: string,
  pointId: string,
  options: { purgeAuxLayers?: boolean } = {},
) {
  invariant(pointId !== ORIGIN_TIMELINE_POINT_ID, "无法删除原点时间点。");
  const workspace = await getWorkspace(projectId, workspaceId);
  const wd = resolveWorkdir(workspace.projectId, workspace.id);
  invariant(wd, "工作目录未初始化");
  const state = readWorktreeStateFromWorkdir(wd);
  const point = state.timeline.find((item) => item.id === pointId);
  invariant(point, "未找到时间点。");
  invariant(
    !(await listAnchoredTimelinePointIds(projectId, workspaceId)).has(pointId),
    "无法删除：仍有章节锚定到该时间点。",
  );
  if (!options.purgeAuxLayers) {
    const auxTimelineDir = `${AUX_TIMELINE_DIR}/${pointId}`;
    invariant(
      !wd.exists(auxTimelineDir) || wd.readdir(auxTimelineDir).length === 0,
      "无法删除：该时间点仍有辅助信息变更。",
    );
  }
  const successor = state.timeline.find((item) => item.prevPointId === pointId);
  if (successor) successor.prevPointId = point.prevPointId;
  state.timeline = state.timeline.filter((item) => item.id !== pointId);
  if (options.purgeAuxLayers) {
    wd.delete(`${AUX_TIMELINE_DIR}/${pointId}`, { force: true });
  }
  writeWorktreeStateToWorkdir(wd, state);
  await touchWorkspaceAsync(workspace.projectId, workspace.id);
}

export function normalizeTimelinePointId(pointId: TimelinePointRef) {
  return normalizePointId(pointId) ?? ORIGIN_TIMELINE_POINT_ID;
}

export function listAffectedTimelinePointIdsForDelete() {
  return [];
}

export function listAffectedTimelinePointIdsForInsert() {
  return [];
}

export function listAffectedTimelinePointIdsForMove() {
  return [];
}

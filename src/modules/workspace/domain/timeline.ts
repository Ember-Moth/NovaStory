import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { ORIGIN_TIMELINE_POINT_ID } from "@/modules/workspace/domain/constants";
import { createId, invariant, now } from "@/shared/lib/domain";

import { getWorkspace } from "./lifecycle";
import type { TimelinePointRef, TimelinePointView } from "./types";
import {
  normalizePointId,
  orderTimelineRows,
  pointIdOrOrigin,
  readWorktreeState,
  writeWorktreeStateSync,
} from "./git-storage/worktree-state";

function touchWorkspace(workspaceId: string) {
  db.update(schema.workspaces)
    .set({ updatedAt: now() })
    .where(eq(schema.workspaces.id, workspaceId))
    .run();
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

export function listTimelinePoints(workspaceId: string): TimelinePointView[] {
  const workspace = getWorkspace(workspaceId);
  const state = readWorktreeState(workspace.worktreePath);
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

function validatePoint(state: ReturnType<typeof readWorktreeState>, pointId: TimelinePointRef) {
  const normalized = normalizePointId(pointId);
  invariant(
    !normalized || state.timeline.some((point) => point.id === normalized),
    "未找到时间点。",
  );
  return normalized;
}

export function createTimelinePoint(input: {
  workspaceId: string;
  afterPointId?: string | typeof ORIGIN_TIMELINE_POINT_ID;
  label: string;
  description?: string | null;
}) {
  return createTimelinePoints({
    workspaceId: input.workspaceId,
    afterPointId: input.afterPointId,
    points: [{ label: input.label, description: input.description }],
  })[0]!;
}

export function createTimelinePoints(input: {
  workspaceId: string;
  afterPointId?: string | typeof ORIGIN_TIMELINE_POINT_ID;
  points: Array<{ label: string; description?: string | null }>;
}) {
  const workspace = getWorkspace(input.workspaceId);
  const state = readWorktreeState(workspace.worktreePath);
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
  writeWorktreeStateSync(workspace.worktreePath, state);
  touchWorkspace(workspace.id);
  return created;
}

export function moveTimelinePoint(input: {
  workspaceId: string;
  pointId: string;
  afterPointId?: string | typeof ORIGIN_TIMELINE_POINT_ID;
}) {
  invariant(input.pointId !== ORIGIN_TIMELINE_POINT_ID, "无法移动原点时间点。");
  const workspace = getWorkspace(input.workspaceId);
  const state = readWorktreeState(workspace.worktreePath);
  const point = state.timeline.find((item) => item.id === input.pointId);
  invariant(point, "未找到时间点。");
  const afterPointId = validatePoint(state, input.afterPointId);
  invariant(point.id !== afterPointId, "无法移动：不能把时间点移动到自己后面。");
  const oldSuccessor = state.timeline.find((item) => item.prevPointId === point.id);
  const targetSuccessor = state.timeline.find((item) => item.prevPointId === afterPointId);
  if (oldSuccessor) oldSuccessor.prevPointId = point.prevPointId;
  point.prevPointId = afterPointId;
  if (targetSuccessor && targetSuccessor.id !== point.id) targetSuccessor.prevPointId = point.id;
  writeWorktreeStateSync(workspace.worktreePath, state);
  touchWorkspace(workspace.id);
  return point;
}

export function updateTimelinePoint(input: {
  workspaceId: string;
  pointId: string;
  label?: string;
  description?: string | null;
}) {
  invariant(input.pointId !== ORIGIN_TIMELINE_POINT_ID, "无法修改原点时间点。");
  const workspace = getWorkspace(input.workspaceId);
  const state = readWorktreeState(workspace.worktreePath);
  const point = state.timeline.find((item) => item.id === input.pointId);
  invariant(point, "未找到时间点。");
  if (input.label !== undefined) point.label = input.label;
  if (input.description !== undefined) point.description = input.description;
  writeWorktreeStateSync(workspace.worktreePath, state);
  touchWorkspace(workspace.id);
  return point;
}

export function deleteTimelinePoint(
  workspaceId: string,
  pointId: string,
  options: { purgeAuxLayers?: boolean } = {},
) {
  invariant(pointId !== ORIGIN_TIMELINE_POINT_ID, "无法删除原点时间点。");
  const workspace = getWorkspace(workspaceId);
  const state = readWorktreeState(workspace.worktreePath);
  const point = state.timeline.find((item) => item.id === pointId);
  invariant(point, "未找到时间点。");
  invariant(
    !state.content.some((node) => node.anchorTimelinePointId === pointId),
    "无法删除：仍有章节锚定到该时间点。",
  );
  if (!options.purgeAuxLayers) {
    invariant(
      !state.auxLayers.some((layer) => layer.timelinePointId === pointId),
      "无法删除：该时间点仍有辅助信息变更。",
    );
  }
  const successor = state.timeline.find((item) => item.prevPointId === pointId);
  if (successor) successor.prevPointId = point.prevPointId;
  state.timeline = state.timeline.filter((item) => item.id !== pointId);
  if (options.purgeAuxLayers)
    state.auxLayers = state.auxLayers.filter((layer) => layer.timelinePointId !== pointId);
  writeWorktreeStateSync(workspace.worktreePath, state);
  touchWorkspace(workspace.id);
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

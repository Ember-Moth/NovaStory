import { eq } from "drizzle-orm";

import { type DatabaseExecutor, db, schema } from "@/db";
import { ORIGIN_TIMELINE_POINT_ID } from "@/shared/constants";

import {
  assertContentRoot,
  getTimelinePointOrThrow,
  getWorkspaceOrThrow,
  touchWorkspace,
} from "../internal/access";
import { purgeAuxLayersAtTimelinePoint } from "../internal/aux-snapshot";
import { buildContentNodeTitlePath } from "../internal/content-chain";
import { createId, invariant, now } from "../internal/ids";
import {
  getTimelineSuccessor,
  listTimelineRows,
  orderTimelineRows,
} from "../internal/timeline-chain";
import {
  originTimelinePoint,
  pointIdOrOrigin,
  validateTimelinePointRef,
} from "../internal/timeline-point";
import type { TimelinePointView } from "../types";

export function listTimelinePoints(workspaceId: string): TimelinePointView[] {
  getWorkspaceOrThrow(db, workspaceId);
  const ordered = orderTimelineRows(listTimelineRows(db, workspaceId));
  return [
    originTimelinePoint(),
    ...ordered.map((row) => ({
      id: row.id,
      key: row.key,
      label: row.label,
      description: row.description,
      prevPointId: pointIdOrOrigin(row.prevPointId),
      isImplicitOrigin: false,
    })),
  ];
}

export function createTimelinePoint(input: {
  workspaceId: string;
  afterPointId?: string | typeof ORIGIN_TIMELINE_POINT_ID;
  key: string;
  label: string;
  description?: string | null;
}) {
  return db.transaction((tx) => {
    const workspace = getWorkspaceOrThrow(tx, input.workspaceId);
    const afterPointId = validateTimelinePointRef(tx, workspace.id, input.afterPointId);
    const successor = getTimelineSuccessor(tx, workspace.id, afterPointId);
    const pointId = createId("timeline");
    const timestamp = now();

    tx.insert(schema.timelinePoints)
      .values({
        id: pointId,
        workspaceId: workspace.id,
        key: input.key,
        label: input.label,
        description: input.description ?? null,
        prevPointId: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();

    if (successor) {
      tx.update(schema.timelinePoints)
        .set({ prevPointId: pointId, updatedAt: timestamp })
        .where(eq(schema.timelinePoints.id, successor.id))
        .run();
    }

    tx.update(schema.timelinePoints)
      .set({ prevPointId: afterPointId, updatedAt: timestamp })
      .where(eq(schema.timelinePoints.id, pointId))
      .run();

    touchWorkspace(tx, workspace.id);
    return getTimelinePointOrThrow(tx, workspace.id, pointId);
  });
}

export function moveTimelinePoint(input: {
  workspaceId: string;
  pointId: string;
  afterPointId?: string | typeof ORIGIN_TIMELINE_POINT_ID;
}) {
  return db.transaction((tx) => {
    const workspace = getWorkspaceOrThrow(tx, input.workspaceId);
    const point = getTimelinePointOrThrow(tx, workspace.id, input.pointId);
    const afterPointId = validateTimelinePointRef(tx, workspace.id, input.afterPointId);
    invariant(point.id !== afterPointId, "Timeline point cannot move after itself");
    if (point.prevPointId === afterPointId) {
      return point;
    }

    const successor = getTimelineSuccessor(tx, workspace.id, point.id);
    const timestamp = now();

    tx.update(schema.timelinePoints)
      .set({ prevPointId: null, updatedAt: timestamp })
      .where(eq(schema.timelinePoints.id, point.id))
      .run();

    if (successor) {
      tx.update(schema.timelinePoints)
        .set({ prevPointId: point.prevPointId, updatedAt: timestamp })
        .where(eq(schema.timelinePoints.id, successor.id))
        .run();
    }

    const targetSuccessor = getTimelineSuccessor(tx, workspace.id, afterPointId);
    if (targetSuccessor && targetSuccessor.id !== point.id) {
      tx.update(schema.timelinePoints)
        .set({ prevPointId: point.id, updatedAt: timestamp })
        .where(eq(schema.timelinePoints.id, targetSuccessor.id))
        .run();
    }

    tx.update(schema.timelinePoints)
      .set({ prevPointId: afterPointId, updatedAt: timestamp })
      .where(eq(schema.timelinePoints.id, point.id))
      .run();

    touchWorkspace(tx, workspace.id);
    return getTimelinePointOrThrow(tx, workspace.id, point.id);
  });
}

export function updateTimelinePoint(input: {
  workspaceId: string;
  pointId: string;
  label?: string;
  description?: string | null;
}) {
  return db.transaction((tx) => {
    invariant(
      input.pointId !== ORIGIN_TIMELINE_POINT_ID,
      "Cannot update implicit origin timeline point",
    );

    const workspace = getWorkspaceOrThrow(tx, input.workspaceId);
    const point = getTimelinePointOrThrow(tx, workspace.id, input.pointId);

    tx.update(schema.timelinePoints)
      .set({
        label: input.label === undefined ? point.label : input.label,
        description: input.description === undefined ? point.description : input.description,
        updatedAt: now(),
      })
      .where(eq(schema.timelinePoints.id, point.id))
      .run();

    touchWorkspace(tx, workspace.id);
    return getTimelinePointOrThrow(tx, workspace.id, point.id);
  });
}

function formatContentAnchorBlockMessage(
  tx: DatabaseExecutor,
  workspaceId: string,
  contentRootId: string,
  anchors: Array<{ id: string }>,
) {
  const paths = anchors.map((anchor) =>
    buildContentNodeTitlePath(tx, workspaceId, anchor.id, contentRootId),
  );

  if (paths.length === 1) {
    return `无法删除：章节「${paths[0]}」仍锚定在此时间点。`;
  }

  return `无法删除：以下章节仍锚定在此时间点：${paths.map((path) => `「${path}」`).join("、")}。`;
}

export function deleteTimelinePoint(
  workspaceId: string,
  pointId: string,
  options?: { purgeAuxLayers?: boolean },
) {
  return db.transaction((tx) => {
    const workspace = getWorkspaceOrThrow(tx, workspaceId);
    const contentRootId = assertContentRoot(workspace);
    const point = getTimelinePointOrThrow(tx, workspace.id, pointId);
    const contentAnchors = tx
      .select()
      .from(schema.contentNodes)
      .where(eq(schema.contentNodes.anchorTimelinePointId, point.id))
      .all();
    invariant(
      contentAnchors.length === 0,
      contentAnchors.length > 0
        ? formatContentAnchorBlockMessage(tx, workspace.id, contentRootId, contentAnchors)
        : "无法删除：仍有章节锚定在此时间点。",
    );

    const auxLayers = tx
      .select()
      .from(schema.auxNodeLayers)
      .where(eq(schema.auxNodeLayers.timelinePointId, point.id))
      .all();
    if (auxLayers.length > 0) {
      invariant(
        options?.purgeAuxLayers === true,
        "无法删除：该时间点仍有关联的辅助信息，请先确认是否一并删除。",
      );
      purgeAuxLayersAtTimelinePoint(tx, workspace.id, point.id);
    }

    const successor = getTimelineSuccessor(tx, workspace.id, point.id);
    const timestamp = now();

    tx.update(schema.timelinePoints)
      .set({ prevPointId: null, updatedAt: timestamp })
      .where(eq(schema.timelinePoints.id, point.id))
      .run();

    if (successor) {
      tx.update(schema.timelinePoints)
        .set({ prevPointId: point.prevPointId, updatedAt: timestamp })
        .where(eq(schema.timelinePoints.id, successor.id))
        .run();
    }

    tx.delete(schema.timelinePoints).where(eq(schema.timelinePoints.id, point.id)).run();
    touchWorkspace(tx, workspace.id);
  });
}

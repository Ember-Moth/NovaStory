import { eq } from "drizzle-orm";

import { db, schema } from "@/db";
import { ORIGIN_TIMELINE_POINT_ID } from "@/shared/constants";

import { getTimelinePointOrThrow, getWorkspaceOrThrow, touchWorkspace } from "../internal/access";
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

export function deleteTimelinePoint(workspaceId: string, pointId: string) {
  return db.transaction((tx) => {
    const workspace = getWorkspaceOrThrow(tx, workspaceId);
    const point = getTimelinePointOrThrow(tx, workspace.id, pointId);
    const contentUse = tx
      .select()
      .from(schema.contentNodes)
      .where(eq(schema.contentNodes.anchorTimelinePointId, point.id))
      .get();
    invariant(!contentUse, "Timeline point is still referenced by content nodes");

    const auxUse = tx
      .select()
      .from(schema.auxNodeLayers)
      .where(eq(schema.auxNodeLayers.timelinePointId, point.id))
      .get();
    invariant(!auxUse, "Timeline point is still referenced by auxiliary layers");

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

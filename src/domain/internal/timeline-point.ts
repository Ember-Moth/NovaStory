import { eq, isNull } from "drizzle-orm";

import { type DatabaseExecutor, schema } from "@/db";
import { ORIGIN_TIMELINE_POINT_ID } from "@/shared/constants";

import type { TimelinePointRef, TimelinePointView } from "../types";
import { getTimelinePointOrThrow } from "./access";

export function normalizeTimelinePointId(pointId: TimelinePointRef) {
  return pointId == null || pointId === ORIGIN_TIMELINE_POINT_ID ? null : pointId;
}

export function pointIdOrOrigin(pointId: string | null) {
  return pointId ?? ORIGIN_TIMELINE_POINT_ID;
}

export function pointCondition(pointId: string | null) {
  return pointId == null
    ? isNull(schema.auxNodeLayers.timelinePointId)
    : eq(schema.auxNodeLayers.timelinePointId, pointId);
}

export function originTimelinePoint(): TimelinePointView {
  return {
    id: ORIGIN_TIMELINE_POINT_ID,
    key: ORIGIN_TIMELINE_POINT_ID,
    label: "Origin",
    description: "Implicit initial story state",
    prevPointId: null,
    isImplicitOrigin: true,
  };
}

export function validateTimelinePointRef(
  executor: DatabaseExecutor,
  workspaceId: string,
  pointId: TimelinePointRef,
) {
  const normalized = normalizeTimelinePointId(pointId);
  if (normalized) {
    getTimelinePointOrThrow(executor, workspaceId, normalized);
  }
  return normalized;
}

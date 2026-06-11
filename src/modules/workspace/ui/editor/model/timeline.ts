import { ORIGIN_TIMELINE_POINT_ID } from "@/modules/workspace/domain/constants";

export type TimelineDropPosition = "before" | "after";
type TimelineLikePoint = {
  id: string;
  isImplicitOrigin: boolean;
};

export function resolveTimelineMoveAfterPointId<TPoint extends TimelineLikePoint>(input: {
  points: TPoint[];
  pointId: string;
  targetId: string | null;
  position: TimelineDropPosition;
}) {
  const { points, pointId, targetId, position } = input;
  const movedPoint = points.find((point) => point.id === pointId);
  if (!movedPoint || movedPoint.isImplicitOrigin) {
    return null;
  }

  const movablePoints = points.filter((point) => !point.isImplicitOrigin && point.id !== pointId);
  let insertIndex = movablePoints.length;

  if (targetId !== null) {
    const targetPoint = points.find((point) => point.id === targetId);
    if (!targetPoint || targetPoint.id === pointId) {
      return null;
    }

    if (targetPoint.isImplicitOrigin) {
      insertIndex = 0;
    } else {
      const targetIndex = movablePoints.findIndex((point) => point.id === targetId);
      if (targetIndex < 0) {
        return null;
      }

      insertIndex = position === "before" ? targetIndex : targetIndex + 1;
    }
  }

  const afterPointId =
    insertIndex <= 0
      ? ORIGIN_TIMELINE_POINT_ID
      : (movablePoints[insertIndex - 1]?.id ?? ORIGIN_TIMELINE_POINT_ID);

  return currentTimelineAfterPointId(points, pointId) === afterPointId ? null : afterPointId;
}

function currentTimelineAfterPointId<TPoint extends TimelineLikePoint>(
  points: TPoint[],
  pointId: string,
) {
  const pointIndex = points.findIndex((point) => point.id === pointId);
  if (pointIndex <= 0) {
    return ORIGIN_TIMELINE_POINT_ID;
  }

  return points[pointIndex - 1]?.id ?? ORIGIN_TIMELINE_POINT_ID;
}

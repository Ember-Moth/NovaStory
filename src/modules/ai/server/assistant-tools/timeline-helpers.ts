import type { ProjectAssistantContextSnapshot } from "@/modules/ai/domain/types";
import { listTimelinePoints, ORIGIN_TIMELINE_POINT_ID } from "@/modules/workspace/domain";
import { invariant } from "@/shared/lib/domain";

import type { ToolRuntimeContext } from "./context";

export function resolveTimelinePointId(
  context: ProjectAssistantContextSnapshot | null | undefined,
) {
  return context?.activeTimelinePointId ?? ORIGIN_TIMELINE_POINT_ID;
}

export function resolveCurrentTimelinePointId(runtimeContext: ToolRuntimeContext) {
  return resolveTimelinePointId(runtimeContext.snapshot);
}

export function resolveSelectableTimelinePoint(input: {
  workspaceId: string;
  timelinePointId: string;
}) {
  if (input.timelinePointId === "origin") {
    return {
      timelinePointId: ORIGIN_TIMELINE_POINT_ID,
      timelineLabel: "原点",
    };
  }
  const points = listTimelinePoints(input.workspaceId);
  const found = points.find((point) => point.id === input.timelinePointId);
  invariant(found, "指定的时间点不存在。");
  return {
    timelinePointId: found.id,
    timelineLabel: found.label,
  };
}

export function resolveTimelinePointIdOrLabel(input: {
  workspaceId: string;
  timelinePointIdOrLabel: string;
}) {
  if (input.timelinePointIdOrLabel === "origin") {
    return ORIGIN_TIMELINE_POINT_ID;
  }

  const points = listTimelinePoints(input.workspaceId);
  const foundById = points.find((point) => point.id === input.timelinePointIdOrLabel);
  if (foundById) {
    return foundById.id;
  }

  const foundByLabel = points.find((point) => point.label === input.timelinePointIdOrLabel);
  invariant(foundByLabel, "指定的 afterPointId 不存在。");
  return foundByLabel.id;
}

export function updateRuntimeTimelineSelection(input: {
  runtimeContext: ToolRuntimeContext;
  timelinePointId: string;
  timelineLabel: string | null;
}) {
  input.runtimeContext.updateSnapshot((current) => ({
    workspaceId: current?.workspaceId ?? null,
    activeContentNodeId: current?.activeContentNodeId ?? null,
    activeContentTitle: current?.activeContentTitle ?? null,
    activeAuxNodeId: current?.activeAuxNodeId ?? null,
    activeAuxPath: current?.activeAuxPath ?? null,
    activeTimelinePointId: input.timelinePointId,
    activeTimelineLabel: input.timelineLabel,
  }));
}

export function getTimelineLabelById(workspaceId: string, timelinePointId: string): string | null {
  if (timelinePointId === ORIGIN_TIMELINE_POINT_ID) {
    return "原点";
  }
  const found = listTimelinePoints(workspaceId).find((point) => point.id === timelinePointId);
  return found?.label ?? null;
}

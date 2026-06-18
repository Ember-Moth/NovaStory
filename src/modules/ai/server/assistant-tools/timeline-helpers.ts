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

export async function resolveSelectableTimelinePoint(input: {
  projectId: string;
  workspaceId: string;
  timelinePointIdOrLabel: string;
}) {
  if (input.timelinePointIdOrLabel === "origin") {
    return {
      timelinePointId: ORIGIN_TIMELINE_POINT_ID,
      timelineLabel: "原点",
      matchedBy: "origin" as const,
    };
  }
  const points = await listTimelinePoints(input.projectId, input.workspaceId);
  const foundById = points.find((point) => point.id === input.timelinePointIdOrLabel);
  if (foundById) {
    return {
      timelinePointId: foundById.id,
      timelineLabel: foundById.label,
      matchedBy: "id" as const,
    };
  }

  const foundByLabel = points.find((point) => point.label === input.timelinePointIdOrLabel);
  invariant(foundByLabel, "指定的时间点不存在。");
  return {
    timelinePointId: foundByLabel.id,
    timelineLabel: foundByLabel.label,
    matchedBy: "label" as const,
  };
}

export async function resolveTimelinePointIdOrLabel(input: {
  projectId: string;
  workspaceId: string;
  timelinePointIdOrLabel: string;
}) {
  if (input.timelinePointIdOrLabel === "origin") {
    return ORIGIN_TIMELINE_POINT_ID;
  }

  const points = await listTimelinePoints(input.projectId, input.workspaceId);
  const foundById = points.find((point) => point.id === input.timelinePointIdOrLabel);
  if (foundById) {
    return foundById.id;
  }

  const foundByLabel = points.find((point) => point.label === input.timelinePointIdOrLabel);
  invariant(foundByLabel, "指定的 afterPointId 不存在。");
  return foundByLabel.id;
}

export async function resolveOptionalTimelinePointIdOrLabel(input: {
  projectId: string;
  workspaceId: string;
  timelinePointIdOrLabel?: string | null;
}) {
  if (input.timelinePointIdOrLabel == null) {
    return undefined;
  }

  return await resolveTimelinePointIdOrLabel({
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    timelinePointIdOrLabel: input.timelinePointIdOrLabel,
  });
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
    activeAuxPath: current?.activeAuxPath ?? null,
    activeTimelinePointId: input.timelinePointId,
    activeTimelineLabel: input.timelineLabel,
  }));
}

export async function getTimelineLabelById(
  projectId: string,
  workspaceId: string,
  timelinePointId: string,
): Promise<string | null> {
  if (timelinePointId === ORIGIN_TIMELINE_POINT_ID) {
    return "原点";
  }
  const points = await listTimelinePoints(projectId, workspaceId);
  const found = points.find((point) => point.id === timelinePointId);
  return found?.label ?? null;
}

import type {
  TimelineSelectionUpdatedEvent,
  WorkspaceRefreshRequestedEvent,
} from "@/modules/ai/domain/types";
import type { AuxTreeNodeVM } from "@/modules/workspace/ui/editor/model/types";

export function shouldHandleWorkspaceRefreshRequested({
  event,
  workspaceId,
}: {
  event: WorkspaceRefreshRequestedEvent | TimelineSelectionUpdatedEvent;
  workspaceId: string | null | undefined;
}) {
  return workspaceId != null && event.workspaceId === workspaceId;
}

export function shouldClearActiveContentDraftForRefresh({
  event,
  activeContentNodeId,
}: {
  event: WorkspaceRefreshRequestedEvent;
  activeContentNodeId: string | null;
}) {
  return (
    event.areas.includes("content") &&
    activeContentNodeId != null &&
    event.contentNodeId === activeContentNodeId
  );
}

export function shouldClearActiveAuxDraftForRefresh({
  event,
  activeAuxNode,
  activeTimelinePointId,
}: {
  event: WorkspaceRefreshRequestedEvent;
  activeAuxNode: AuxTreeNodeVM | null;
  activeTimelinePointId: string | null;
}) {
  if (
    typeof event.timelinePointId === "string" &&
    event.timelinePointId.trim().length > 0 &&
    event.timelinePointId !== activeTimelinePointId
  ) {
    return false;
  }

  return (
    event.areas.includes("aux") &&
    activeAuxNode?.nodeType === "file" &&
    event.auxNodeId === activeAuxNode.id
  );
}

export function getAuxRefreshTargetTimelinePointId(event: WorkspaceRefreshRequestedEvent) {
  if (!event.areas.includes("aux")) {
    return null;
  }

  return typeof event.timelinePointId === "string" && event.timelinePointId.trim().length > 0
    ? event.timelinePointId
    : null;
}

export function getContentRefreshTargetTimelinePointId(event: WorkspaceRefreshRequestedEvent) {
  if (!event.areas.includes("content")) {
    return null;
  }

  return typeof event.timelinePointId === "string" && event.timelinePointId.trim().length > 0
    ? event.timelinePointId
    : null;
}

export function getContentRefreshTargetNodeId(event: WorkspaceRefreshRequestedEvent) {
  if (!event.areas.includes("content")) {
    return null;
  }

  return typeof event.contentNodeId === "string" && event.contentNodeId.trim().length > 0
    ? event.contentNodeId
    : null;
}

export function shouldRefetchActiveAuxForRefresh({
  event,
  activeTimelinePointId,
}: {
  event: WorkspaceRefreshRequestedEvent;
  activeTimelinePointId: string | null;
}) {
  if (!event.areas.includes("aux")) {
    return false;
  }

  const targetTimelinePointId = getAuxRefreshTargetTimelinePointId(event);
  return targetTimelinePointId == null || targetTimelinePointId === activeTimelinePointId;
}

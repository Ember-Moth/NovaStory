import type {
  ProjectAssistantStreamEvent,
  TimelineSelectionUpdatedEvent,
  WorkspaceRefreshRequestedEvent,
} from "@/modules/ai/domain/types";

export type AssistantRefreshEvent = WorkspaceRefreshRequestedEvent | TimelineSelectionUpdatedEvent;

export function isToolInputResumeEvent(event: ProjectAssistantStreamEvent): boolean {
  return (
    event.type === "user-input-submitted" ||
    event.type === "assistant-message-started" ||
    event.type === "assistant-text-delta" ||
    event.type === "assistant-reasoning-delta" ||
    event.type === "tool-call-streaming-start" ||
    event.type === "tool-call-delta" ||
    event.type === "tool-call" ||
    event.type === "tool-result" ||
    event.type === "step-started" ||
    event.type === "step-finished"
  );
}

export function getForwardedAssistantRefreshEvent(
  event: ProjectAssistantStreamEvent,
): AssistantRefreshEvent | null {
  if (event.type === "workspace-refresh-requested" || event.type === "timeline-selection-updated") {
    return event;
  }

  return null;
}

export function isAssistantStreamAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "RpcStreamAborted";
}

import type { UIMessage } from "@ai-sdk/react";

import type {
  AssistantMentionInput,
  TimelineSelectionUpdatedEvent,
  WorkspaceRefreshRequestedEvent,
} from "@/modules/ai/domain/types";

export interface ProjectChatMessageMetadata {
  mentions?: AssistantMentionInput[];
}

export interface ProjectChatDataParts extends Record<string, unknown> {
  "workspace-refresh-requested": WorkspaceRefreshRequestedEvent;
  "timeline-selection-updated": TimelineSelectionUpdatedEvent;
}

export type ProjectChatMessage = UIMessage<ProjectChatMessageMetadata, ProjectChatDataParts>;

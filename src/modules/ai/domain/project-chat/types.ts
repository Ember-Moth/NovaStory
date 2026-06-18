import type { UIMessage } from "ai";

export interface ProjectChatModelConfig {
  connectionId: string;
  modelId: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ProjectChatInfo {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
  modelConfig: ProjectChatModelConfig;
}

export interface ProjectChatIndex {
  version: "v1";
  projectId: string;
  chats: ProjectChatInfo[];
  updatedAt: number;
}

export interface ProjectChatPathState {
  selectedChildIdByParentId: Record<string, string>;
}

export interface ProjectChatState {
  version: "v1";
  chats: Record<string, ProjectChatPathState>;
  updatedAt: number;
}

export interface StoredProjectChatMessage extends UIMessage {
  parentMessageId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectChatCandidateGroup {
  parentMessageId: string | null;
  activeMessageId: string;
  messageIds: string[];
}

export interface ProjectChatDetail {
  chat: ProjectChatInfo;
  messages: StoredProjectChatMessage[];
  visibleMessages: StoredProjectChatMessage[];
  state: ProjectChatPathState;
  candidateGroups: ProjectChatCandidateGroup[];
}

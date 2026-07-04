import { defineTags, type TagValue } from "@/lib/rpc/core";

export const rpcTags = defineTags({
  aiAssistantModelSelection: () => ["config", "ai", "assistant", "model-selection"] as const,
  aiAssistantOptions: () => ["config", "ai", "assistant", "options"] as const,

  projectsList: () => ["projects", "list"] as const,
  project: (projectId: string) => ["projects", "detail", projectId] as const,

  workspacesByProject: (projectId: string) => ["workspaces", "project", projectId] as const,
  workspace: (workspaceId: string) => ["workspaces", "detail", workspaceId] as const,

  branchesByProject: (projectId: string) => ["branches", "project", projectId] as const,
  branchHeadsByProject: (projectId: string) => ["branches", "heads", projectId] as const,
  branch: (branchId: string) => ["branches", "detail", branchId] as const,
  commitHistory: (branchId: string) => ["commits", "history", branchId] as const,
  commit: (commitId: string) => ["commits", "detail", commitId] as const,

  contentTree: (workspaceId: string) => ["content", "tree", workspaceId] as const,

  timelineList: (workspaceId: string) => ["timeline", "list", workspaceId] as const,

  auxWorkspace: (workspaceId: string) => ["aux", "workspace", workspaceId] as const,
  auxSnapshot: (workspaceId: string, timelinePointId: string | null) =>
    ["aux", "snapshot", workspaceId, timelinePointId] as const,

  aiCatalogPackages: () => ["ai", "catalog", "packages"] as const,
  aiCatalogStatus: () => ["ai", "catalog", "status"] as const,
  aiCatalogProviders: () => ["ai", "catalog", "providers"] as const,
  aiCatalogModels: () => ["ai", "catalog", "models"] as const,
  aiCatalogModelsByProvider: (catalogProviderId: string) =>
    ["ai", "catalog", "models", catalogProviderId] as const,
  aiConnections: () => ["ai", "connections"] as const,
  aiConnectionModels: (connectionId: string) =>
    ["ai", "connections", "models", connectionId] as const,
  aiGlobalPrompts: () => ["ai", "global-prompts"] as const,

  projectChats: (projectId: string) => ["ai", "chats", "list", projectId] as const,
  projectChat: (chatId: string) => ["ai", "chats", "detail", chatId] as const,
  projectChatModelConfig: (projectId: string) =>
    ["ai", "chats", "model-config", projectId] as const,
});

export type RpcTag = TagValue<typeof rpcTags>;
export type RpcTagList = readonly RpcTag[];

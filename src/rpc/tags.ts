import { defineTags, type TagValue } from "@codehz/rpc/core";

export const rpcTags = defineTags({
  aiAssistantModelSelection: () => ["config", "ai", "assistant", "model-selection"] as const,

  projectsList: () => ["projects", "list"] as const,
  project: (projectId: string) => ["projects", "detail", projectId] as const,

  workspacesByProject: (projectId: string) => ["workspaces", "project", projectId] as const,
  workspace: (workspaceId: string) => ["workspaces", "detail", workspaceId] as const,

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
  aiProjectAssistantOverview: (projectId: string) =>
    ["ai", "project-assistant-overview", projectId] as const,
  aiProjectThreads: (projectId: string) => ["ai", "project-threads", projectId] as const,
  aiThreadView: (threadId: string) => ["ai", "thread-view", threadId] as const,
  aiNodeCandidates: (parentNodeId: string) => ["ai", "node-candidates", parentNodeId] as const,
  aiRunTrace: (runId: string) => ["ai", "run-trace", runId] as const,
  aiChildRuns: (runId: string) => ["ai", "child-runs", runId] as const,
});

export type RpcTag = TagValue<typeof rpcTags>;
export type RpcTagList = readonly RpcTag[];

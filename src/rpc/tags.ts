import { defineTags, type TagValue } from "@codehz/rpc/core";

export const rpcTags = defineTags({
  projectsList: () => ["projects", "list"] as const,
  project: (projectId: string) => ["projects", "detail", projectId] as const,

  workspacesByProject: (projectId: string) => ["workspaces", "project", projectId] as const,

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
});

export type RpcTag = TagValue<typeof rpcTags>;
export type RpcTagList = readonly RpcTag[];

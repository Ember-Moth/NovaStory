import { query } from "@codehz/rpc/core";

import { getDefaultWorkspace, getWorkspace, listWorkspaces } from "@/modules/workspace/domain";
import { rpcTags, type RpcTagList } from "@/rpc/tags";

export const list = query<
  { projectId: string },
  Awaited<ReturnType<typeof listWorkspaces>>,
  RpcTagList
>({
  watch: ({ projectId }) => [rpcTags.workspacesByProject(projectId)],
  handler: async ({ projectId }) => await listWorkspaces(projectId),
});

export const defaultWorkspace = query<
  { projectId: string },
  Awaited<ReturnType<typeof getDefaultWorkspace>>,
  RpcTagList
>({
  watch: ({ projectId }) => [rpcTags.workspacesByProject(projectId)],
  handler: async ({ projectId }) => await getDefaultWorkspace(projectId),
});

export const get = query<
  { projectId: string; workspaceId: string },
  Awaited<ReturnType<typeof getWorkspace>>,
  RpcTagList
>({
  watch: ({ workspaceId }) => [rpcTags.workspace(workspaceId)],
  handler: async ({ projectId, workspaceId }) => await getWorkspace(projectId, workspaceId),
});

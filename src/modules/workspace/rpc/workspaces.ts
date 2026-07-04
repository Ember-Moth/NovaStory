import { query } from "@codehz/rpc/core";

import { getDefaultWorkspace, getWorkspace, listWorkspaces } from "@/modules/workspace/domain";
import { type RpcTagList, rpcTags } from "@/rpc/tags";

export const list = query<{ projectId: string }, ReturnType<typeof listWorkspaces>, RpcTagList>({
  watch: ({ projectId }) => [rpcTags.workspacesByProject(projectId)],
  handler: ({ projectId }) => listWorkspaces(projectId),
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
  ReturnType<typeof getWorkspace>,
  RpcTagList
>({
  watch: ({ workspaceId }) => [rpcTags.workspace(workspaceId)],
  handler: ({ projectId, workspaceId }) => getWorkspace(projectId, workspaceId),
});

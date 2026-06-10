import { query } from "@codehz/rpc/core";

import { getDefaultWorkspace, getWorkspace, listWorkspaces } from "@/modules/workspace/domain";
import { rpcTags, type RpcTagList } from "@/rpc/tags";

export const list = query<{ projectId: string }, ReturnType<typeof listWorkspaces>, RpcTagList>({
  watch: ({ projectId }) => [rpcTags.workspacesByProject(projectId)],
  handler: ({ projectId }) => listWorkspaces(projectId),
});

export const defaultWorkspace = query<
  { projectId: string },
  ReturnType<typeof getDefaultWorkspace>,
  RpcTagList
>({
  watch: ({ projectId }) => [rpcTags.workspacesByProject(projectId)],
  handler: ({ projectId }) => getDefaultWorkspace(projectId),
});

export const get = query<{ workspaceId: string }, ReturnType<typeof getWorkspace>, RpcTagList>({
  watch: ({ workspaceId }) => [rpcTags.workspace(workspaceId)],
  handler: ({ workspaceId }) => getWorkspace(workspaceId),
});

import { query } from "@codehz/rpc/core";

import { getDefaultWorkspace, listWorkspaces } from "@/domain";
import { rpcTags, type RpcTagList } from "@/server/rpc/tags";

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

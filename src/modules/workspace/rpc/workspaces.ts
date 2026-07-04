import { getDefaultWorkspace, getWorkspace, listWorkspaces } from "@/modules/workspace/domain";
import { rpcTags } from "@/rpc/tags";

export async function list(input: {
  projectId: string;
}): Promise<{ data: ReturnType<typeof listWorkspaces>; watch?: unknown[] }> {
  const data = await listWorkspaces(input.projectId);
  const watch = [rpcTags.workspacesByProject(input.projectId)];
  return { data, watch };
}

export async function defaultWorkspace(input: {
  projectId: string;
}): Promise<{ data: Awaited<ReturnType<typeof getDefaultWorkspace>>; watch?: unknown[] }> {
  const data = await getDefaultWorkspace(input.projectId);
  const watch = [rpcTags.workspacesByProject(input.projectId)];
  return { data, watch };
}

export async function get(input: {
  projectId: string;
  workspaceId: string;
}): Promise<{ data: ReturnType<typeof getWorkspace>; watch?: unknown[] }> {
  const data = await getWorkspace(input.projectId, input.workspaceId);
  const watch = [rpcTags.workspace(input.workspaceId)];
  return { data, watch };
}

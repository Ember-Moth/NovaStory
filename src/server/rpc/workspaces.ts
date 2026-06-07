import { query } from "@codehz/rpc";

import { getDefaultWorkspace, listWorkspaces } from "@/domain";

export const list = query<{ projectId: string }, ReturnType<typeof listWorkspaces>>(
  ({ projectId }, ctx) => {
    const result = listWorkspaces(projectId);
    ctx.watch(`workspaces:${projectId}`);
    return result;
  },
);

export const defaultWorkspace = query<
  { projectId: string },
  ReturnType<typeof getDefaultWorkspace>
>(({ projectId }, ctx) => {
  const result = getDefaultWorkspace(projectId);
  ctx.watch(`workspaces:${projectId}`);
  return result;
});

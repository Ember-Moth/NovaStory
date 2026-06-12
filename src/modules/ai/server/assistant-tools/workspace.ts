import { getDefaultWorkspace } from "@/modules/workspace/domain";

export function getWorkspaceForProject(projectId: string) {
  return getDefaultWorkspace(projectId);
}

import { expect, test } from "vitest";
import * as service from "@/modules/workspace/domain";
import { rpcTags } from "@/rpc/tags";
import { seedProjectRecord } from "@/test/project";
import * as workspaceHandlers from "./workspaces";

async function seedProject(projectId: string) {
  seedProjectRecord(projectId);
  if (!(await service.getDefaultWorkspace(projectId))) {
    await service.createDefaultWorkspace(projectId);
  }
  return (await service.getDefaultWorkspace(projectId))!;
}

test("workspace detail query watches the workspace tag and returns the workspace", async () => {
  const workspace = await seedProject("rpc_workspace_detail");

  const result = await workspaceHandlers.get({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
  });

  expect(result.watch).toEqual([rpcTags.workspace(workspace.id)]);
  expect(result.data).toMatchObject({
    id: workspace.id,
    projectId: "rpc_workspace_detail",
    name: "main",
    branchName: workspace.branchName,
  });
  expect(result.data).not.toHaveProperty("worktreePath");
});

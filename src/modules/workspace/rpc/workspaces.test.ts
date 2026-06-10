import { expect, test } from "bun:test";

import { setupMockDatabase } from "@/test/mock-db";

setupMockDatabase();

const { db, schema } = await import("@/db");
const service = await import("@/modules/workspace/domain");
const { rpcTags } = await import("@/rpc/tags");
const workspaceHandlers = await import("./workspaces");
const requestCtx = { req: new Request("http://localhost/api/rpc") } as unknown as Parameters<
  typeof workspaceHandlers.list.handler
>[1];

function seedProject(projectId: string) {
  db.insert(schema.projects)
    .values({
      id: projectId,
      name: `Project ${projectId}`,
      description: null,
    })
    .run();
  return service.createDefaultWorkspace(projectId);
}

test("workspace detail query watches the workspace tag and returns the workspace", async () => {
  const workspace = seedProject("rpc_workspace_detail");

  const result = await workspaceHandlers.get.handler({ workspaceId: workspace.id }, requestCtx);

  expect(result.watch).toEqual([rpcTags.workspace(workspace.id)]);
  expect(result.data).toMatchObject({
    id: workspace.id,
    projectId: "rpc_workspace_detail",
    name: "main",
    isDefault: true,
  });
});

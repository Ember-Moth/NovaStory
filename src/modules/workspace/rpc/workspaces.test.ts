import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, expect, test } from "bun:test";

const tempDir = mkdtempSync(join(tmpdir(), "novel-evolver-workspaces-rpc-"));
const dbPath = join(tempDir, "workspaces-rpc-test.sqlite");
process.env.DATABASE_URL = dbPath;

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

beforeEach(() => {
  db.delete(schema.auxNodeLayers).run();
  db.delete(schema.contentNodes).run();
  db.delete(schema.timelinePoints).run();
  db.delete(schema.auxNodes).run();
  db.delete(schema.workspaces).run();
  db.delete(schema.projects).run();
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

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

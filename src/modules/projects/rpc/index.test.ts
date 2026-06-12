import { expect, test } from "bun:test";

import { setupMockDatabase } from "@/test/mock-db";

setupMockDatabase();

const { db, schema } = await import("@/db");
const workspaceService = await import("@/modules/workspace/domain");
const projectHandlers = await import("./index");
const { rpcTags } = await import("@/rpc/tags");
const requestCtx = { req: new Request("http://localhost/api/rpc") } as unknown as Parameters<
  typeof projectHandlers.list.handler
>[1];

function seedProject(projectId: string) {
  db.insert(schema.projects)
    .values({
      id: projectId,
      name: `Project ${projectId}`,
      description: null,
    })
    .run();
  return workspaceService.createDefaultWorkspace(projectId);
}

test("project get watches the project tag and returns the project", async () => {
  seedProject("project_get");

  const result = await projectHandlers.get.handler({ projectId: "project_get" }, requestCtx);

  expect(result.watch).toEqual([rpcTags.project("project_get")]);
  expect(result.data).toMatchObject({
    id: "project_get",
    name: "Project project_get",
  });
});

test("setDefaultBranch rejects branches from another project", async () => {
  seedProject("project_default_a");
  const workspaceB = seedProject("project_default_b");

  await expect(
    projectHandlers.setDefaultBranch.handler(
      {
        projectId: "project_default_a",
        branchId: workspaceB.branchId,
      },
      requestCtx,
    ),
  ).rejects.toThrow("无法设置默认分支：该分支不属于当前项目。");
});

test("setDefaultBranch invalidates project list and detail tags", async () => {
  const workspace = seedProject("project_default_switch");
  workspaceService.createContentNode({
    workspaceId: workspace.id,
    parentId: workspace.contentRootId!,
    title: "Base",
  });
  const baseCommit = workspaceService.createCommit({
    branchId: workspace.branchId,
    message: "base",
  });
  const featureWorkspace = workspaceService.createBranchWorkspace({
    projectId: "project_default_switch",
    name: "feature",
    fromCommitId: baseCommit.id,
  });

  const result = await projectHandlers.setDefaultBranch.handler(
    {
      projectId: "project_default_switch",
      branchId: featureWorkspace.branchId,
    },
    requestCtx,
  );

  expect(result.invalidate).toEqual([
    rpcTags.projectsList(),
    rpcTags.project("project_default_switch"),
  ]);
  expect(
    db.query.projects
      .findFirst({
        where: (projects, { eq }) => eq(projects.id, "project_default_switch"),
      })
      .sync()?.defaultBranchId,
  ).toBe(featureWorkspace.branchId);
});

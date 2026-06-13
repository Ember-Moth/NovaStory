import { expect, test } from "bun:test";
import type { AnySQLiteTable } from "drizzle-orm/sqlite-core";

import { setupMockDatabase } from "@/test/mock-db";

setupMockDatabase();

const { db, schema } = await import("@/db");
const workspaceService = await import("@/modules/workspace/domain");
const auxService = await import("@/modules/workspace/domain/aux");
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

function countRows(table: AnySQLiteTable) {
  return db.select().from(table).all().length;
}

async function deleteProject(projectId: string) {
  return projectHandlers.deleteMutation.handler({ id: projectId }, requestCtx);
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
  const baseCommit = await workspaceService.createCommit({
    branchId: workspace.branchId,
    message: "base",
  });
  const featureWorkspace = await workspaceService.createBranchWorkspace({
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

test("delete project cascades default workspace roots", async () => {
  seedProject("project_delete_default");

  const result = await deleteProject("project_delete_default");

  expect(result.invalidate).toEqual([
    rpcTags.projectsList(),
    rpcTags.project("project_delete_default"),
  ]);
  expect(countRows(schema.projects)).toBe(0);
  expect(countRows(schema.workspaces)).toBe(0);
  expect(countRows(schema.contentNodes)).toBe(0);
  expect(countRows(schema.auxNodes)).toBe(0);
});

test("delete project cascades content anchored to timeline points", async () => {
  const workspace = seedProject("project_delete_content_anchor");
  const point = workspaceService.createTimelinePoint({
    workspaceId: workspace.id,
    label: "Act I",
  });
  workspaceService.createContentNode({
    workspaceId: workspace.id,
    parentId: workspace.contentRootId!,
    anchorPointId: point.id,
    title: "Opening",
  });

  await expect(deleteProject("project_delete_content_anchor")).resolves.toBeDefined();
  expect(countRows(schema.projects)).toBe(0);
  expect(countRows(schema.workspaces)).toBe(0);
  expect(countRows(schema.timelinePoints)).toBe(0);
  expect(countRows(schema.contentNodes)).toBe(0);
});

test("delete project cascades aux layers", async () => {
  const workspace = seedProject("project_delete_aux_layers");
  const point = workspaceService.createTimelinePoint({
    workspaceId: workspace.id,
    label: "Act I",
  });
  auxService.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: point.id,
    parentDirId: workspace.auxRootId!,
    name: "notes.md",
    content: "outline",
  });

  await expect(deleteProject("project_delete_aux_layers")).resolves.toBeDefined();
  expect(countRows(schema.projects)).toBe(0);
  expect(countRows(schema.workspaces)).toBe(0);
  expect(countRows(schema.timelinePoints)).toBe(0);
  expect(countRows(schema.auxNodes)).toBe(0);
  expect(countRows(schema.auxNodeLayers)).toBe(0);
});

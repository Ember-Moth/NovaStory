import { expect, test } from "bun:test";
import { existsSync } from "node:fs";

import { setupMockDatabase } from "@/test/mock-db";

setupMockDatabase();

const { db, schema } = await import("@/db");
const workspaceService = await import("@/modules/workspace/domain");
const auxService = await import("@/modules/workspace/domain/aux");
const { getProjectRepoGitDir, getProjectWorktreeRoot } =
  await import("@/modules/workspace/domain/git-storage/paths");
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

async function deleteProject(projectId: string) {
  return projectHandlers.deleteMutation.handler({ id: projectId }, requestCtx);
}

function projectIndexCounts() {
  return {
    projects: db.select().from(schema.projects).all().length,
    branches: db.select().from(schema.branches).all().length,
    workspaces: db.select().from(schema.workspaces).all().length,
  };
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
    parentId: null,
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
  expect(projectIndexCounts()).toEqual({ projects: 0, branches: 0, workspaces: 0 });
  expect(existsSync(getProjectRepoGitDir("project_delete_default"))).toBe(false);
  expect(existsSync(getProjectWorktreeRoot("project_delete_default"))).toBe(false);
});

test("delete project cascades content anchored to timeline points", async () => {
  const workspace = seedProject("project_delete_content_anchor");
  const point = workspaceService.createTimelinePoint({
    workspaceId: workspace.id,
    label: "Act I",
  });
  workspaceService.createContentNode({
    workspaceId: workspace.id,
    parentId: null,
    anchorPointId: point.id,
    title: "Opening",
  });

  await expect(deleteProject("project_delete_content_anchor")).resolves.toBeDefined();
  expect(projectIndexCounts()).toEqual({ projects: 0, branches: 0, workspaces: 0 });
  expect(existsSync(getProjectRepoGitDir("project_delete_content_anchor"))).toBe(false);
  expect(existsSync(getProjectWorktreeRoot("project_delete_content_anchor"))).toBe(false);
});

test("delete project cascades aux overlay files", async () => {
  const workspace = seedProject("project_delete_aux_overlay");
  const point = workspaceService.createTimelinePoint({
    workspaceId: workspace.id,
    label: "Act I",
  });
  auxService.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/notes.md",
    content: "outline",
  });

  await expect(deleteProject("project_delete_aux_overlay")).resolves.toBeDefined();
  expect(projectIndexCounts()).toEqual({ projects: 0, branches: 0, workspaces: 0 });
  expect(existsSync(getProjectRepoGitDir("project_delete_aux_overlay"))).toBe(false);
  expect(existsSync(getProjectWorktreeRoot("project_delete_aux_overlay"))).toBe(false);
});

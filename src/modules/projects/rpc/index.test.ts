import { expect, test } from "bun:test";
import { existsSync } from "node:fs";

import { seedProjectRecord } from "@/test/project";
import {
  listProjectRowsSync,
  readProjectMetaSync,
} from "@/modules/workspace/domain/git-storage/project-meta-store";
import * as auxService from "@/modules/workspace/domain/aux";
import {
  getProjectRepoGitDir,
  getProjectWorktreeRoot,
} from "@/modules/workspace/domain/git-storage/paths";
import * as workspaceService from "@/modules/workspace/domain";
import { rpcTags } from "@/rpc/tags";
import * as projectHandlers from "./index";
const requestCtx = { req: new Request("http://localhost/api/rpc") } as unknown as Parameters<
  typeof projectHandlers.list.handler
>[1];

async function seedProject(projectId: string) {
  seedProjectRecord(projectId);
  if (!workspaceService.getDefaultWorkspace(projectId)) {
    workspaceService.createDefaultWorkspace(projectId);
  }
  return workspaceService.getDefaultWorkspace(projectId)!;
}

async function deleteProject(projectId: string) {
  return projectHandlers.deleteMutation.handler({ id: projectId }, requestCtx);
}

function projectIndexCounts() {
  return {
    projects: listProjectRowsSync().length,
    branches: listProjectRowsSync().reduce(
      (count, project) => count + readProjectMetaSync(project.id).branches.length,
      0,
    ),
    workspaces: listProjectRowsSync().reduce(
      (count, project) => count + readProjectMetaSync(project.id).workspaces.length,
      0,
    ),
  };
}

test("project get watches the project tag and returns the project", async () => {
  await seedProject("project_get");

  const result = await projectHandlers.get.handler({ projectId: "project_get" }, requestCtx);

  expect(result.watch).toEqual([rpcTags.project("project_get")]);
  expect(result.data).toMatchObject({
    id: "project_get",
    name: "Project project_get",
  });
});

test("setDefaultBranch rejects branches from another project", async () => {
  await seedProject("project_default_a");
  const workspaceB = await seedProject("project_default_b");

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
  const workspace = await seedProject("project_default_switch");
  workspaceService.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    title: "Base",
  });
  const baseCommit = await workspaceService.createCommit({
    projectId: workspace.projectId,
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
  expect(readProjectMetaSync("project_default_switch").project.defaultBranchId).toBe(
    featureWorkspace.branchId,
  );
});

test("delete project cascades default workspace roots", async () => {
  await seedProject("project_delete_default");

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
  const workspace = await seedProject("project_delete_content_anchor");
  const point = workspaceService.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    label: "Act I",
  });
  workspaceService.createContentNode({
    projectId: workspace.projectId,
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
  const workspace = await seedProject("project_delete_aux_overlay");
  const point = workspaceService.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    label: "Act I",
  });
  auxService.writeFileAt({
    projectId: workspace.projectId,
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

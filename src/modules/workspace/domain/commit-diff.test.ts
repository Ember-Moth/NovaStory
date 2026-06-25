import { expect, test } from "bun:test";

import { seedProjectRecord } from "@/test/project";
import * as workspaceService from "@/modules/workspace/domain";

async function seedProject(projectId: string) {
  await seedProjectRecord(projectId);
  if (!(await workspaceService.getDefaultWorkspace(projectId))) {
    await workspaceService.createDefaultWorkspace(projectId);
  }
  return (await workspaceService.getDefaultWorkspace(projectId))!;
}

test("getCommitDiff reports added content for the root commit", async () => {
  const workspace = await seedProject("diff_root");
  const node = await workspaceService.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    title: "第一章",
    body: "开篇",
  });
  const commit = await workspaceService.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchName,
    message: "root",
  });

  const diff = await workspaceService.getCommitDiff(workspace.projectId, commit.id);

  expect(diff.isRoot).toBe(true);
  expect(diff.baseCommitId).toBeNull();
  expect(diff.hasChanges).toBe(true);
  expect(diff.areas.content.changes).toHaveLength(1);
  const change = diff.areas.content.changes[0]!;
  expect(change.kind).toBe("added");
  expect(change.nodeId).toBe(node.id);
});

test("getCommitDiff compares a commit against its first parent", async () => {
  const workspace = await seedProject("diff_parent");
  const node = await workspaceService.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    title: "第一章",
    body: "旧正文",
  });
  await workspaceService.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchName,
    message: "base",
  });

  await workspaceService.updateContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    nodeId: node.id,
    title: "第一章（修订）",
    body: "新正文",
  });
  const second = await workspaceService.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchName,
    message: "revise",
  });

  const diff = await workspaceService.getCommitDiff(workspace.projectId, second.id);

  expect(diff.isRoot).toBe(false);
  expect(diff.baseCommitId).not.toBeNull();
  expect(diff.areas.content.changes).toHaveLength(1);
  const change = diff.areas.content.changes[0]!;
  expect(change.kind).toBe("modified");
  expect(change.changedAspects).toContain("title");
  expect(change.changedAspects).toContain("body");
});

test("getCommitDiff reports no changes for an empty-message-only commit", async () => {
  const workspace = await seedProject("diff_noop");
  await workspaceService.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    title: "第一章",
    body: "正文",
  });
  await workspaceService.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchName,
    message: "base",
  });
  const second = await workspaceService.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchName,
    message: "no content change",
  });

  const diff = await workspaceService.getCommitDiff(workspace.projectId, second.id);

  expect(diff.hasChanges).toBe(false);
  expect(diff.areas.content.changes).toHaveLength(0);
});

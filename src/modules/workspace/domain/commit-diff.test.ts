import { expect, test } from "bun:test";

import { seedProjectRecord } from "@/test/project";
import * as workspaceService from "@/modules/workspace/domain";

async function seedProject(projectId: string) {
  seedProjectRecord(projectId);
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

test("getCommitDiff reports structured timeline changes", async () => {
  const workspace = await seedProject("diff_timeline_structured");
  const pointA = await workspaceService.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    label: "A",
    description: "desc-a",
  });
  await workspaceService.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchName,
    message: "base",
  });

  await workspaceService.updateTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    pointId: pointA.id,
    label: "A2",
  });
  const second = await workspaceService.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchName,
    message: "timeline",
  });

  const diff = await workspaceService.getCommitDiff(workspace.projectId, second.id);
  const change = diff.areas.timeline.changes[0];

  expect(change).toMatchObject({
    pointId: pointA.id,
    kind: "modified",
    label: "A2",
    previousLabel: "A",
  });
  expect(change?.changedAspects).toContain("label");
});

test("getCommitDiff structures aux paths and resolves timeline labels", async () => {
  const workspace = await seedProject("diff_aux_structured");
  const point = await workspaceService.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    label: "第二幕",
  });
  await workspaceService.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    path: "/notes.md",
    content: "origin",
  });
  await workspaceService.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchName,
    message: "base",
  });

  await workspaceService.deleteAuxNodeAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    path: "/notes.md",
  });
  await workspaceService.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/notes.md",
    content: "point",
  });
  const second = await workspaceService.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchName,
    message: "aux",
  });

  const diff = await workspaceService.getCommitDiff(workspace.projectId, second.id);

  expect(diff.areas.aux.changes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        label: "aux/origin/notes.md",
        path: "notes.md",
        timelinePointLabel: "原点",
        kind: "deleted",
      }),
      expect.objectContaining({
        label: `aux/timeline/${point.id}/notes.md`,
        path: "notes.md",
        timelinePointId: point.id,
        timelinePointLabel: "第二幕",
        isWhiteout: false,
      }),
    ]),
  );
});

test("getCommitDiff includes aux directory changes", async () => {
  const workspace = await seedProject("diff_aux_directory_changes");
  await workspaceService.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchName,
    message: "base",
  });

  await workspaceService.mkdirAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    path: "/设定",
  });
  const second = await workspaceService.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchName,
    message: "add aux dir",
  });

  const diff = await workspaceService.getCommitDiff(workspace.projectId, second.id);

  expect(diff.areas.aux.changes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        label: "aux/origin/设定",
        path: "设定",
        timelinePointLabel: "原点",
        isWhiteout: false,
        kind: "added",
      }),
    ]),
  );
});

test("getCommitDiff filters modified aux directories but keeps modified files", async () => {
  const workspace = await seedProject("diff_aux_filter_modified_dirs");
  await workspaceService.mkdirAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    path: "/设定",
  });
  await workspaceService.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    path: "/设定/角色.md",
    content: "base",
  });
  await workspaceService.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchName,
    message: "base",
  });

  await workspaceService.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    path: "/设定/角色.md",
    content: "updated",
  });
  const second = await workspaceService.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchName,
    message: "update aux file",
  });

  const diff = await workspaceService.getCommitDiff(workspace.projectId, second.id);

  expect(diff.areas.aux.changes).toEqual([
    expect.objectContaining({
      label: "aux/origin/设定/角色.md",
      path: "设定/角色.md",
      kind: "modified",
    }),
  ]);
});

test("getCommitDiff does not infer aux source info when tree diff lacks it", async () => {
  const workspace = await seedProject("diff_aux_no_source_info");
  await workspaceService.mkdirAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    path: "/设定",
  });
  await workspaceService.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    path: "/设定/角色.md",
    content: "base",
  });
  await workspaceService.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchName,
    message: "base",
  });

  await workspaceService.moveAuxNodeAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    path: "/设定/角色.md",
    newPath: "/设定/主角.md",
  });
  const second = await workspaceService.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchName,
    message: "move aux",
  });

  const diff = await workspaceService.getCommitDiff(workspace.projectId, second.id);
  const targetChange = diff.areas.aux.changes.find((change) => change.path === "设定/主角.md");

  expect(targetChange?.kind).toBe("added");
});

import type fs from "node:fs";

import { expect, spyOn, test } from "bun:test";
import git from "isomorphic-git";

import { seedProjectRecord } from "@/test/project";
import * as service from "./index";

async function seedProject(projectId: string) {
  await seedProjectRecord(projectId);
  if (!(await service.getDefaultWorkspace(projectId))) {
    await service.createDefaultWorkspace(projectId);
  }
  return (await service.getDefaultWorkspace(projectId))!;
}

function mockStatusMatrixWithoutRacyGitShortcut() {
  const originalStatusMatrix = git.statusMatrix;

  return spyOn(git, "statusMatrix").mockImplementation((args) => {
    const baseFs = args.fs as typeof fs;
    const promises = Object.create(baseFs.promises) as typeof baseFs.promises;

    promises.lstat = async (path) => {
      const stat = await baseFs.promises.lstat(path);
      const bumpedTime = 1000;

      return Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, {
        mtimeMs: stat.mtimeMs + bumpedTime,
        ctimeMs: stat.ctimeMs + bumpedTime,
        mtime: new Date(stat.mtimeMs + bumpedTime),
        ctime: new Date(stat.ctimeMs + bumpedTime),
      });
    };

    return originalStatusMatrix({
      ...args,
      fs: Object.defineProperty({ ...baseFs }, "promises", {
        value: promises,
        enumerable: true,
        configurable: true,
        writable: true,
      }) as typeof fs,
    });
  });
}

test("empty branch before first commit reports no diff areas", async () => {
  const workspace = await seedProject("status_empty_branch");

  const status = await service.getWorkingTreeStatus(workspace.projectId, workspace.branchId);

  expect(status.hasChanges).toBe(false);
  expect(status.headCommitId).toBeNull();
  expect(status.areas.content.changed).toBe(false);
  expect(status.areas.timeline.changed).toBe(false);
  expect(status.areas.aux.changed).toBe(false);
});

test("uncommitted edits before first commit appear as additions", async () => {
  const workspace = await seedProject("status_first_commit");
  const chapter = await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    title: "Chapter 1",
    body: "Once",
  });
  await service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    label: "Intro",
  });
  await service.mkdirAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    path: "/lore",
  });
  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    path: "/lore/world.md",
    content: "world building",
  });

  const status = await service.getWorkingTreeStatus(workspace.projectId, workspace.branchId);

  expect(status.hasChanges).toBe(true);
  expect(status.headCommitId).toBeNull();
  expect(status.areas.content.changes).toContainEqual({
    label: "Chapter 1",
    kind: "added",
    nodeId: chapter.id,
    title: "Chapter 1",
    parentId: null,
    parentLabel: null,
    parentPathLabel: "顶层",
    anchorTimelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    anchorTimelinePointLabel: "原点",
    changedAspects: ["title", "body", "parent", "order", "anchor"],
    bodyCharDelta: { added: 4, removed: 0 },
    previousTitle: null,
    previousParentId: null,
    previousParentLabel: null,
    previousParentPathLabel: null,
    previousAnchorTimelinePointId: null,
    previousAnchorTimelinePointLabel: null,
    revertable: true,
  });
  expect(status.areas.timeline.changes).toContainEqual({
    label: "timeline.jsonl",
    kind: "added",
  });
  expect(status.areas.aux.changes.some((change) => change.label.startsWith("aux/"))).toBe(true);
});

test("committed workspace with no edits reports hasChanges false", async () => {
  const workspace = await seedProject("status_clean");
  await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    title: "Chapter 1",
    body: "Once",
  });
  await service.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchId,
    message: "first",
  });

  const status = await service.getWorkingTreeStatus(workspace.projectId, workspace.branchId);

  expect(status.hasChanges).toBe(false);
  expect(status.headCommitId).toMatch(/^[0-9a-f]{40}$/);
  expect(status.areas.content.changes).toEqual([]);
  expect(status.areas.timeline.changes).toEqual([]);
  expect(status.areas.aux.changes).toEqual([]);
});

test("content, timeline and aux edits appear in the diff summary", async () => {
  const workspace = await seedProject("status_diff");
  const chapter = await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    title: "Chapter 1",
    body: "Once",
  });
  const introPoint = await service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    label: "Intro",
  });
  await service.mkdirAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    path: "/lore",
  });
  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    path: "/lore/world.md",
    content: "world building",
  });
  await service.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchId,
    message: "base",
  });

  await service.updateContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    nodeId: chapter.id,
    title: "Changed title",
    body: "different",
  });
  await service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    label: "Middle",
  });
  await service.deleteAuxNodeAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    path: "/lore",
  });
  await service.mkdirAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: introPoint.id,
    path: "/notes",
  });
  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: introPoint.id,
    path: "/notes/draft.md",
    content: "timeline-specific note",
  });

  const status = await service.getWorkingTreeStatus(workspace.projectId, workspace.branchId);
  const chapterChange = status.areas.content.changes.find((change) => change.nodeId === chapter.id);

  expect(status.hasChanges).toBe(true);
  expect(chapterChange).toMatchObject({
    label: "Changed title",
    kind: "modified",
    title: "Changed title",
    previousTitle: "Chapter 1",
    bodyCharDelta: { added: 8, removed: 3 },
  });
  expect(chapterChange?.changedAspects).toEqual(expect.arrayContaining(["title", "body"]));
  expect(status.areas.timeline.changes).toContainEqual({
    label: "timeline.jsonl",
    kind: "modified",
  });
  expect(status.areas.aux.changed).toBe(true);
});

test("content move and anchor updates are summarized semantically", async () => {
  const workspace = await seedProject("status_semantic_content_diff");
  const introPoint = await service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    label: "Intro",
  });
  const middlePoint = await service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    label: "Middle",
  });
  const chapterA = await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    title: "Chapter A",
    body: "A",
  });
  const chapterB = await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    title: "Chapter B",
    body: "B",
    anchorPointId: introPoint.id,
  });
  await service.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchId,
    message: "base",
  });

  await service.moveContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    nodeId: chapterB.id,
    newParentId: chapterA.id,
  });
  await service.updateContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    nodeId: chapterB.id,
    anchorPointId: middlePoint.id,
  });

  const status = await service.getWorkingTreeStatus(workspace.projectId, workspace.branchId);
  const chapterChange = status.areas.content.changes.find(
    (change) => change.nodeId === chapterB.id,
  );

  expect(chapterChange).toMatchObject({
    label: "Chapter B",
    kind: "modified",
    parentId: chapterA.id,
    parentLabel: "Chapter A",
    parentPathLabel: "Chapter A",
    previousParentId: null,
    previousParentLabel: null,
    previousParentPathLabel: "顶层",
    anchorTimelinePointId: middlePoint.id,
    anchorTimelinePointLabel: "Middle",
    previousAnchorTimelinePointId: introPoint.id,
    previousAnchorTimelinePointLabel: "Intro",
    bodyCharDelta: null,
    revertable: true,
  });
  expect(chapterChange?.changedAspects).toEqual(expect.arrayContaining(["parent", "anchor"]));
});

test("reverting workspace to head clears the diff summary", async () => {
  const workspace = await seedProject("status_revert");
  const chapter = await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    title: "Chapter 1",
    body: "Once",
  });
  const commit = await service.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchId,
    message: "first",
  });

  await service.updateContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    nodeId: chapter.id,
    title: "Changed title",
    body: "different",
  });
  expect(
    (await service.getWorkingTreeStatus(workspace.projectId, workspace.branchId)).hasChanges,
  ).toBe(true);

  await service.checkoutCommit({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    commitId: commit.id,
  });

  const status = await service.getWorkingTreeStatus(workspace.projectId, workspace.branchId);
  expect(status.hasChanges).toBe(false);
  expect(status.areas.content.changes).toEqual([]);
});

test("inserting a new node before existing ones does not mark them as order-changed", async () => {
  const workspace = await seedProject("status_order_noise");
  const nodeA = await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    title: "A",
    body: "",
  });
  const nodeB = await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    title: "B",
    body: "",
  });
  await service.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchId,
    message: "base",
  });

  // 在 A 前面插入一个新节点 X → [X, A, B]
  await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    title: "X",
    body: "",
  });

  const status = await service.getWorkingTreeStatus(workspace.projectId, workspace.branchId);

  const changeA = status.areas.content.changes.find((c) => c.nodeId === nodeA.id);
  const changeB = status.areas.content.changes.find((c) => c.nodeId === nodeB.id);

  // A 和 B 的相对顺序没变，不应有 order；也不应有任何 modified 变更
  expect(changeA).toBeUndefined();
  expect(changeB).toBeUndefined();
});

test("truly swapping two nodes marks both as order-changed", async () => {
  using _statusMatrixSpy = mockStatusMatrixWithoutRacyGitShortcut();
  const workspace = await seedProject("status_true_reorder_uniq");
  const nodeA = await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    title: "A",
    body: "",
  });
  const nodeB = await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    title: "B",
    body: "",
    afterSiblingId: nodeA.id,
  });
  await service.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchId,
    message: "base",
  });

  // 将 B 移到最前面 → [B, A]
  await service.moveContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    nodeId: nodeB.id,
    newParentId: null,
    afterSiblingId: null,
  });

  const status = await service.getWorkingTreeStatus(workspace.projectId, workspace.branchId);

  const changeA = status.areas.content.changes.find((c) => c.nodeId === nodeA.id);
  const changeB = status.areas.content.changes.find((c) => c.nodeId === nodeB.id);

  expect(changeA).toBeDefined();
  expect(changeB).toBeDefined();
  expect(changeA!.changedAspects).toContain("order");
  expect(changeB!.changedAspects).toContain("order");
});

test("revertContentChange('modified') restores title and body", async () => {
  const workspace = await seedProject("revert_modified");
  const node = await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    title: "Original",
    body: "Original body",
  });
  await service.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchId,
    message: "base",
  });

  await service.updateContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    nodeId: node.id,
    title: "Changed",
    body: "Changed body",
  });

  await service.revertContentChange({
    projectId: workspace.projectId,
    branchId: workspace.branchId,
    nodeId: node.id,
    kind: "modified",
  });

  const status = await service.getWorkingTreeStatus(workspace.projectId, workspace.branchId);
  expect(status.hasChanges).toBe(false);

  const read = await service.readManuscriptNode(workspace.projectId, workspace.id, node.id);
  expect(read.title).toBe("Original");
  expect(read.body).toBe("Original body");
});

test("revertContentChange('added') removes the node", async () => {
  const workspace = await seedProject("revert_added");
  await service.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchId,
    message: "base",
  });

  const node = await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    title: "Extra",
    body: "extra",
  });

  expect(
    (await service.getWorkingTreeStatus(workspace.projectId, workspace.branchId)).hasChanges,
  ).toBe(true);

  await service.revertContentChange({
    projectId: workspace.projectId,
    branchId: workspace.branchId,
    nodeId: node.id,
    kind: "added",
  });

  const status = await service.getWorkingTreeStatus(workspace.projectId, workspace.branchId);
  expect(status.hasChanges).toBe(false);
  expect(status.areas.content.changes).toEqual([]);
});

test("revertContentChange('deleted') restores the node and its subtree", async () => {
  const workspace = await seedProject("revert_deleted");
  const parent = await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    title: "Parent",
    body: "parent",
  });
  const child = await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: parent.id,
    title: "Child",
    body: "child",
  });
  await service.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchId,
    message: "base",
  });

  await service.deleteContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    nodeId: parent.id,
  });

  expect(
    (await service.getWorkingTreeStatus(workspace.projectId, workspace.branchId)).hasChanges,
  ).toBe(true);

  await service.revertContentChange({
    projectId: workspace.projectId,
    branchId: workspace.branchId,
    nodeId: parent.id,
    kind: "deleted",
  });

  const status = await service.getWorkingTreeStatus(workspace.projectId, workspace.branchId);
  expect(status.hasChanges).toBe(false);

  const read = await service.readManuscriptNode(workspace.projectId, workspace.id, parent.id);
  expect(read.title).toBe("Parent");
  expect(read.children).toHaveLength(1);
  expect(read.children[0]?.id).toBe(child.id);
});

test("deleted node within a deleted parent reports revertable as false", async () => {
  const workspace = await seedProject("revertable_deleted_parent");
  const parent = await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    title: "Parent",
    body: "",
  });
  const child = await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: parent.id,
    title: "Child",
    body: "",
  });
  await service.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchId,
    message: "base",
  });

  // 删除父节点→工作树中 parent 和 child 都消失
  await service.deleteContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    nodeId: parent.id,
  });

  const status = await service.getWorkingTreeStatus(workspace.projectId, workspace.branchId);
  const childChange = status.areas.content.changes.find((c) => c.nodeId === child.id);
  expect(childChange?.kind).toBe("deleted");
  expect(childChange?.revertable).toBe(false);
});

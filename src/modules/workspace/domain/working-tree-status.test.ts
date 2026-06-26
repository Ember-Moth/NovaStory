import type { SHA1 } from "nano-git";
import { expect, test } from "bun:test";

import { seedProjectRecord } from "@/test/project";
import { getWorkdirForBranch, getBranchMapping } from "./git-storage/git-store";
import * as service from "./index";

async function seedProject(projectId: string) {
  seedProjectRecord(projectId);
  if (!(await service.getDefaultWorkspace(projectId))) {
    await service.createDefaultWorkspace(projectId);
  }
  return (await service.getDefaultWorkspace(projectId))!;
}

function wdFor(workspace: { projectId: string; id: string }) {
  const workdirKey = getBranchMapping(workspace.projectId, workspace.id);
  if (!workdirKey) return undefined;
  return getWorkdirForBranch(workspace.projectId, workdirKey);
}

test("empty branch before first commit reports no diff areas", async () => {
  const workspace = await seedProject("status_empty_branch");

  const status = await service.getWorkingTreeStatus(workspace.projectId, workspace.branchName);

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

  const status = await service.getWorkingTreeStatus(workspace.projectId, workspace.branchName);

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
  expect(status.areas.timeline.changes).toHaveLength(1);
  expect(status.areas.timeline.changes[0]).toMatchObject({
    kind: "added",
    label: "Intro",
    changedAspects: ["label", "description", "order"],
  });
  expect(status.areas.aux.changes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        label: "aux/origin/lore/world.md",
        path: "lore/world.md",
        timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
        timelinePointLabel: "原点",
        isWhiteout: false,
      }),
    ]),
  );
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
    branchId: workspace.branchName,
    message: "first",
  });

  const status = await service.getWorkingTreeStatus(workspace.projectId, workspace.branchName);

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
    branchId: workspace.branchName,
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

  const status = await service.getWorkingTreeStatus(workspace.projectId, workspace.branchName);
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
  expect(status.areas.timeline.changes).toHaveLength(1);
  expect(status.areas.timeline.changes[0]).toMatchObject({
    kind: "added",
    label: "Middle",
  });
  expect(status.areas.aux.changed).toBe(true);
  expect(status.areas.aux.changes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        label: `aux/timeline/${introPoint.id}/notes`,
        path: "notes",
        timelinePointId: introPoint.id,
        timelinePointLabel: "Intro",
        isWhiteout: false,
        kind: "added",
      }),
      expect.objectContaining({
        label: "aux/origin/lore/world.md",
        path: "lore/world.md",
        timelinePointLabel: "原点",
        kind: "deleted",
      }),
      expect.objectContaining({
        label: `aux/timeline/${introPoint.id}/notes/draft.md`,
        path: "notes/draft.md",
        timelinePointId: introPoint.id,
        timelinePointLabel: "Intro",
        isWhiteout: false,
      }),
    ]),
  );
});

test("pure manuscript body edit only reports the touched node", async () => {
  const workspace = await seedProject("status_manuscript_only_body_diff");
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
  });
  await service.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchName,
    message: "base",
  });

  const wd = wdFor(workspace);
  wd!.writeFile(`manuscript/${chapterA.id}.md`, Buffer.from("AA", "utf8"));

  const status = await service.getWorkingTreeStatus(workspace.projectId, workspace.branchName);

  expect(status.areas.content.changes).toHaveLength(1);
  expect(status.areas.content.changes[0]).toMatchObject({
    nodeId: chapterA.id,
    kind: "modified",
    changedAspects: ["body"],
    bodyCharDelta: { added: 1, removed: 0 },
  });
  expect(
    status.areas.content.changes.find((change) => change.nodeId === chapterB.id),
  ).toBeUndefined();
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
    branchId: workspace.branchName,
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

  const status = await service.getWorkingTreeStatus(workspace.projectId, workspace.branchName);
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
    branchId: workspace.branchName,
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
    (await service.getWorkingTreeStatus(workspace.projectId, workspace.branchName)).hasChanges,
  ).toBe(true);

  await service.checkoutCommit({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    commitId: commit.id as SHA1,
  });

  const status = await service.getWorkingTreeStatus(workspace.projectId, workspace.branchName);
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
    branchId: workspace.branchName,
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

  const status = await service.getWorkingTreeStatus(workspace.projectId, workspace.branchName);

  const changeA = status.areas.content.changes.find((c) => c.nodeId === nodeA.id);
  const changeB = status.areas.content.changes.find((c) => c.nodeId === nodeB.id);

  // A 和 B 的相对顺序没变，不应有 order；也不应有任何 modified 变更
  expect(changeA).toBeUndefined();
  expect(changeB).toBeUndefined();
});

test("truly swapping two nodes marks both as order-changed", async () => {
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
    branchId: workspace.branchName,
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

  const status = await service.getWorkingTreeStatus(workspace.projectId, workspace.branchName);

  const changeA = status.areas.content.changes.find((c) => c.nodeId === nodeA.id);
  const changeB = status.areas.content.changes.find((c) => c.nodeId === nodeB.id);

  expect(changeA).toBeDefined();
  expect(changeB).toBeDefined();
  expect(changeA!.changedAspects).toContain("order");
  expect(changeB!.changedAspects).toContain("order");
});

test("inserting a new timeline point before existing ones does not mark them as order-changed", async () => {
  const workspace = await seedProject("status_timeline_order_noise");
  const pointA = await service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    label: "A",
  });
  const pointB = await service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: pointA.id,
    label: "B",
  });
  await service.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchName,
    message: "base",
  });

  await service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "X",
  });

  const status = await service.getWorkingTreeStatus(workspace.projectId, workspace.branchName);
  const changeA = status.areas.timeline.changes.find((change) => change.pointId === pointA.id);
  const changeB = status.areas.timeline.changes.find((change) => change.pointId === pointB.id);

  expect(changeA).toBeUndefined();
  expect(changeB).toBeUndefined();
});

test("revertTimelineChange('modified') restores label, description and order", async () => {
  const workspace = await seedProject("revert_timeline_modified");
  const pointA = await service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    label: "A",
    description: "desc-a",
  });
  const pointB = await service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: pointA.id,
    label: "B",
    description: "desc-b",
  });
  await service.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchName,
    message: "base",
  });

  await service.updateTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    pointId: pointB.id,
    label: "B2",
    description: "desc-b2",
  });
  await service.moveTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    pointId: pointB.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
  });

  await service.revertTimelineChange({
    projectId: workspace.projectId,
    branchId: workspace.branchName,
    pointId: pointB.id,
    kind: "modified",
  });

  const status = await service.getWorkingTreeStatus(workspace.projectId, workspace.branchName);
  expect(status.areas.timeline.changes).toEqual([]);
  expect(status.hasChanges).toBe(false);
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
    branchId: workspace.branchName,
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
    branchId: workspace.branchName,
    nodeId: node.id,
    kind: "modified",
  });

  const status = await service.getWorkingTreeStatus(workspace.projectId, workspace.branchName);
  expect(status.hasChanges).toBe(false);

  const read = await service.readManuscriptNode(workspace.projectId, workspace.id, node.id);
  expect(read.title).toBe("Original");
  expect(read.body).toBe("Original body");
});

test("revertContentChange('added') removes the node", async () => {
  const workspace = await seedProject("revert_added");
  await service.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchName,
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
    (await service.getWorkingTreeStatus(workspace.projectId, workspace.branchName)).hasChanges,
  ).toBe(true);

  await service.revertContentChange({
    projectId: workspace.projectId,
    branchId: workspace.branchName,
    nodeId: node.id,
    kind: "added",
  });

  const status = await service.getWorkingTreeStatus(workspace.projectId, workspace.branchName);
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
    branchId: workspace.branchName,
    message: "base",
  });

  await service.deleteContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    nodeId: parent.id,
  });

  expect(
    (await service.getWorkingTreeStatus(workspace.projectId, workspace.branchName)).hasChanges,
  ).toBe(true);

  await service.revertContentChange({
    projectId: workspace.projectId,
    branchId: workspace.branchName,
    nodeId: parent.id,
    kind: "deleted",
  });

  const status = await service.getWorkingTreeStatus(workspace.projectId, workspace.branchName);
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
    branchId: workspace.branchName,
    message: "base",
  });

  // 删除父节点→工作树中 parent 和 child 都消失
  await service.deleteContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    nodeId: parent.id,
  });

  const status = await service.getWorkingTreeStatus(workspace.projectId, workspace.branchName);
  const childChange = status.areas.content.changes.find((c) => c.nodeId === child.id);
  expect(childChange?.kind).toBe("deleted");
  expect(childChange?.revertable).toBe(false);
});

test("revertAuxChange('modified') restores file content", async () => {
  const workspace = await seedProject("revert_aux_modified");
  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    path: "/lore.md",
    content: "base",
  });
  await service.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchName,
    message: "base",
  });

  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    path: "/lore.md",
    content: "changed",
  });

  await service.revertAuxChange({
    projectId: workspace.projectId,
    branchId: workspace.branchName,
    filepath: "aux/origin/lore.md",
    kind: "modified",
  });

  const status = await service.getWorkingTreeStatus(workspace.projectId, workspace.branchName);
  expect(status.areas.aux.changes).toEqual([]);
  expect(status.hasChanges).toBe(false);
  expect(
    (
      await service.readAuxByPathAt(
        workspace.projectId,
        workspace.id,
        service.ORIGIN_TIMELINE_POINT_ID,
        "/lore.md",
      )
    )?.content,
  ).toBe("base");
});

test("revertAuxChange('added') removes added aux file", async () => {
  const workspace = await seedProject("revert_aux_added");
  await service.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchName,
    message: "base",
  });

  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    path: "/draft.md",
    content: "draft",
  });

  await service.revertAuxChange({
    projectId: workspace.projectId,
    branchId: workspace.branchName,
    filepath: "aux/origin/draft.md",
    kind: "added",
  });

  const status = await service.getWorkingTreeStatus(workspace.projectId, workspace.branchName);
  expect(status.areas.aux.changes).toEqual([]);
  expect(status.hasChanges).toBe(false);
});

test("revertAuxChange('deleted') restores deleted aux file", async () => {
  const workspace = await seedProject("revert_aux_deleted");
  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    path: "/notes.md",
    content: "base",
  });
  await service.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchName,
    message: "base",
  });

  await service.deleteAuxNodeAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    path: "/notes.md",
  });

  await service.revertAuxChange({
    projectId: workspace.projectId,
    branchId: workspace.branchName,
    filepath: "aux/origin/notes.md",
    kind: "deleted",
  });

  const status = await service.getWorkingTreeStatus(workspace.projectId, workspace.branchName);
  expect(status.areas.aux.changes).toEqual([]);
  expect(status.hasChanges).toBe(false);
  expect(
    (
      await service.readAuxByPathAt(
        workspace.projectId,
        workspace.id,
        service.ORIGIN_TIMELINE_POINT_ID,
        "/notes.md",
      )
    )?.content,
  ).toBe("base");
});

test("aux move keeps source info in working tree diff", async () => {
  const workspace = await seedProject("status_aux_move_source");
  await service.mkdirAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    path: "/设定",
  });
  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    path: "/设定/角色.md",
    content: "base",
  });
  await service.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchName,
    message: "base",
  });

  await service.moveAuxNodeAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    path: "/设定/角色.md",
    newPath: "/设定/主角.md",
  });

  const status = await service.getWorkingTreeStatus(workspace.projectId, workspace.branchName);
  expect(status.areas.aux.changes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        label: "aux/origin/设定/主角.md",
        path: "设定/主角.md",
        kind: "modified",
        sourceKind: "move",
        sourcePath: "设定/角色.md",
        sourceTimelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
        sourceTimelinePointLabel: "原点",
      }),
    ]),
  );
});

test("aux copy keeps source info in working tree diff", async () => {
  const workspace = await seedProject("status_aux_copy_source");
  await service.mkdirAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    path: "/设定",
  });
  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    path: "/设定/角色.md",
    content: "base",
  });
  await service.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchName,
    message: "base",
  });

  const wd = wdFor(workspace)!;
  wd.copy("aux/origin/设定/角色.md", "aux/origin/设定/副本.md");

  const status = await service.getWorkingTreeStatus(workspace.projectId, workspace.branchName);
  expect(status.areas.aux.changes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        label: "aux/origin/设定/副本.md",
        path: "设定/副本.md",
        kind: "added",
        sourceKind: "copy",
        sourcePath: "设定/角色.md",
        sourceTimelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
        sourceTimelinePointLabel: "原点",
      }),
    ]),
  );
});

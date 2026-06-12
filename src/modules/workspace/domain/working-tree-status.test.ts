import { expect, test } from "bun:test";

import { setupMockDatabase } from "@/test/mock-db";

setupMockDatabase();

const { db, schema } = await import("@/db");
const service = await import("./index");

function seedProject(projectId: string) {
  db.insert(schema.projects)
    .values({ id: projectId, name: `Project ${projectId}`, description: null })
    .run();
  return service.createDefaultWorkspace(projectId);
}

test("empty branch before first commit reports no diff areas", () => {
  const workspace = seedProject("status_empty_branch");

  const status = service.getWorkingTreeStatus(workspace.branchId);

  expect(status.hasChanges).toBe(false);
  expect(status.headCommitId).toBeNull();
  expect(status.areas.content.changed).toBe(false);
  expect(status.areas.timeline.changed).toBe(false);
  expect(status.areas.aux.changed).toBe(false);
});

test("uncommitted edits before first commit appear as additions", () => {
  const workspace = seedProject("status_first_commit");
  service.createContentNode({
    workspaceId: workspace.id,
    parentId: workspace.contentRootId!,
    title: "Chapter 1",
    body: "Once",
  });
  service.createTimelinePoint({
    workspaceId: workspace.id,
    label: "Intro",
  });
  const dir = service.mkdirAt({
    workspaceId: workspace.id,
    parentDirId: workspace.auxRootId!,
    name: "lore",
  });
  service.writeFileAt({
    workspaceId: workspace.id,
    parentDirId: dir.id,
    name: "world.md",
    content: "world building",
  });

  const status = service.getWorkingTreeStatus(workspace.branchId);

  expect(status.hasChanges).toBe(true);
  expect(status.headCommitId).toBeNull();
  expect(status.areas.content.changes).toEqual([{ label: "Chapter 1", kind: "added" }]);
  expect(status.areas.timeline.changes).toEqual([{ label: "Intro", kind: "added" }]);
  expect(status.areas.aux.changes).toEqual([
    { label: "/lore@原点", kind: "added" },
    { label: "/lore/world.md@原点", kind: "added" },
  ]);
});

test("committed workspace with no edits reports hasChanges false", () => {
  const workspace = seedProject("status_clean");
  service.createContentNode({
    workspaceId: workspace.id,
    parentId: workspace.contentRootId!,
    title: "Chapter 1",
    body: "Once",
  });
  service.createCommit({ branchId: workspace.branchId, message: "first" });

  const status = service.getWorkingTreeStatus(workspace.branchId);

  expect(status.hasChanges).toBe(false);
  expect(status.headCommitId).toMatch(/^commit_/);
  expect(status.areas.content.changes).toEqual([]);
  expect(status.areas.timeline.changes).toEqual([]);
  expect(status.areas.aux.changes).toEqual([]);
});

test("content, timeline and aux edits appear in the diff summary", () => {
  const workspace = seedProject("status_diff");
  const chapter = service.createContentNode({
    workspaceId: workspace.id,
    parentId: workspace.contentRootId!,
    title: "Chapter 1",
    body: "Once",
  });
  const introPoint = service.createTimelinePoint({
    workspaceId: workspace.id,
    label: "Intro",
  });
  const dir = service.mkdirAt({
    workspaceId: workspace.id,
    parentDirId: workspace.auxRootId!,
    name: "lore",
  });
  service.writeFileAt({
    workspaceId: workspace.id,
    parentDirId: dir.id,
    name: "world.md",
    content: "world building",
  });
  service.createCommit({ branchId: workspace.branchId, message: "base" });

  service.updateContentNode({
    workspaceId: workspace.id,
    nodeId: chapter.id,
    title: "Changed title",
    body: "different",
  });
  service.createTimelinePoint({
    workspaceId: workspace.id,
    label: "Middle",
  });
  service.deleteAuxNodeAt({ workspaceId: workspace.id, nodeId: dir.id });
  const notesDir = service.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: introPoint.id,
    parentDirId: workspace.auxRootId!,
    name: "notes",
  });
  service.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: introPoint.id,
    parentDirId: notesDir.id,
    name: "draft.md",
    content: "timeline-specific note",
  });

  const status = service.getWorkingTreeStatus(workspace.branchId);

  expect(status.hasChanges).toBe(true);
  expect(status.areas.content.changes).toEqual([{ label: "Changed title", kind: "modified" }]);
  expect(status.areas.timeline.changes).toEqual([{ label: "Middle", kind: "added" }]);
  expect(status.areas.aux.changes).toEqual([
    { label: "/lore@原点", kind: "deleted" },
    { label: "/notes@Intro", kind: "added" },
    { label: "/notes/draft.md@Intro", kind: "added" },
  ]);
});

test("reverting workspace to head clears the diff summary", () => {
  const workspace = seedProject("status_revert");
  const chapter = service.createContentNode({
    workspaceId: workspace.id,
    parentId: workspace.contentRootId!,
    title: "Chapter 1",
    body: "Once",
  });
  const commit = service.createCommit({ branchId: workspace.branchId, message: "first" });

  service.updateContentNode({
    workspaceId: workspace.id,
    nodeId: chapter.id,
    title: "Changed title",
    body: "different",
  });
  expect(service.getWorkingTreeStatus(workspace.branchId).hasChanges).toBe(true);

  service.checkoutCommit({ workspaceId: workspace.id, commitId: commit.id });

  const status = service.getWorkingTreeStatus(workspace.branchId);
  expect(status.hasChanges).toBe(false);
  expect(status.areas.content.changes).toEqual([]);
});

import { expect, test } from "bun:test";

import { seedProjectRecord } from "@/test/project";
import * as service from "./index";

function seedProject(projectId: string) {
  seedProjectRecord(projectId);
  if (!service.getDefaultWorkspace(projectId)) {
    service.createDefaultWorkspace(projectId);
  }
  return service.getDefaultWorkspace(projectId)!;
}

test("empty branch before first commit reports no diff areas", async () => {
  const workspace = seedProject("status_empty_branch");

  const status = await service.getWorkingTreeStatus(workspace.branchId);

  expect(status.hasChanges).toBe(false);
  expect(status.headCommitId).toBeNull();
  expect(status.areas.content.changed).toBe(false);
  expect(status.areas.timeline.changed).toBe(false);
  expect(status.areas.aux.changed).toBe(false);
});

test("uncommitted edits before first commit appear as additions", async () => {
  const workspace = seedProject("status_first_commit");
  service.createContentNode({
    workspaceId: workspace.id,
    parentId: null,
    title: "Chapter 1",
    body: "Once",
  });
  service.createTimelinePoint({
    workspaceId: workspace.id,
    label: "Intro",
  });
  service.mkdirAt({
    workspaceId: workspace.id,
    path: "/lore",
  });
  service.writeFileAt({
    workspaceId: workspace.id,
    path: "/lore/world.md",
    content: "world building",
  });

  const status = await service.getWorkingTreeStatus(workspace.branchId);

  expect(status.hasChanges).toBe(true);
  expect(status.headCommitId).toBeNull();
  expect(status.areas.content.changes).toContainEqual({
    label: expect.stringMatching(/^manuscript\/0001-[A-Za-z0-9]+\/content\.md$/),
    kind: "added",
  });
  expect(status.areas.timeline.changes).toContainEqual({
    label: "novel-evolver/timeline.jsonl",
    kind: "added",
  });
  expect(status.areas.aux.changes.some((change) => change.label.startsWith("aux/"))).toBe(true);
});

test("committed workspace with no edits reports hasChanges false", async () => {
  const workspace = seedProject("status_clean");
  service.createContentNode({
    workspaceId: workspace.id,
    parentId: null,
    title: "Chapter 1",
    body: "Once",
  });
  await service.createCommit({ branchId: workspace.branchId, message: "first" });

  const status = await service.getWorkingTreeStatus(workspace.branchId);

  expect(status.hasChanges).toBe(false);
  expect(status.headCommitId).toMatch(/^[0-9a-f]{40}$/);
  expect(status.areas.content.changes).toEqual([]);
  expect(status.areas.timeline.changes).toEqual([]);
  expect(status.areas.aux.changes).toEqual([]);
});

test("content, timeline and aux edits appear in the diff summary", async () => {
  const workspace = seedProject("status_diff");
  const chapter = service.createContentNode({
    workspaceId: workspace.id,
    parentId: null,
    title: "Chapter 1",
    body: "Once",
  });
  const introPoint = service.createTimelinePoint({
    workspaceId: workspace.id,
    label: "Intro",
  });
  service.mkdirAt({
    workspaceId: workspace.id,
    path: "/lore",
  });
  service.writeFileAt({
    workspaceId: workspace.id,
    path: "/lore/world.md",
    content: "world building",
  });
  await service.createCommit({ branchId: workspace.branchId, message: "base" });

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
  service.deleteAuxNodeAt({ workspaceId: workspace.id, path: "/lore" });
  service.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: introPoint.id,
    path: "/notes",
  });
  service.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: introPoint.id,
    path: "/notes/draft.md",
    content: "timeline-specific note",
  });

  const status = await service.getWorkingTreeStatus(workspace.branchId);

  expect(status.hasChanges).toBe(true);
  expect(status.areas.content.changes).toContainEqual({
    label: expect.stringMatching(/^manuscript\/0001-[A-Za-z0-9]+\/content\.md$/),
    kind: "modified",
  });
  expect(status.areas.timeline.changes).toContainEqual({
    label: "novel-evolver/timeline.jsonl",
    kind: "modified",
  });
  expect(status.areas.aux.changed).toBe(true);
});

test("reverting workspace to head clears the diff summary", async () => {
  const workspace = seedProject("status_revert");
  const chapter = service.createContentNode({
    workspaceId: workspace.id,
    parentId: null,
    title: "Chapter 1",
    body: "Once",
  });
  const commit = await service.createCommit({ branchId: workspace.branchId, message: "first" });

  service.updateContentNode({
    workspaceId: workspace.id,
    nodeId: chapter.id,
    title: "Changed title",
    body: "different",
  });
  expect((await service.getWorkingTreeStatus(workspace.branchId)).hasChanges).toBe(true);

  await service.checkoutCommit({ workspaceId: workspace.id, commitId: commit.id });

  const status = await service.getWorkingTreeStatus(workspace.branchId);
  expect(status.hasChanges).toBe(false);
  expect(status.areas.content.changes).toEqual([]);
});

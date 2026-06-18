import { expect, test } from "bun:test";

import { setupMockDatabase } from "@/test/mock-db";
import { seedProjectRecord } from "@/test/project";
import { readProjectMetaSync } from "@/modules/workspace/domain/git-storage/project-meta-store";

setupMockDatabase();

const service = await import("./index");

function seedProject(projectId: string) {
  seedProjectRecord(projectId);
  return service.createDefaultWorkspace(projectId);
}

test("default workspace creates a default branch and links project", async () => {
  const workspace = seedProject("proj_default");
  expect(workspace.branchId).toBeTruthy();

  const project = readProjectMetaSync("proj_default").project;
  expect(project.defaultBranchId).toBe(workspace.branchId);

  const branch = service.getBranch(workspace.projectId, workspace.branchId);
  expect(branch.name).toBe("main");
  expect(await service.getBranchHeadCommitId(workspace.projectId, workspace.branchId)).toBeNull();
});

test("commit then checkout round-trips content, timeline and aux state", async () => {
  const workspace = seedProject("proj_rt");
  const rootId = null;

  const point = service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    label: "Intro",
  });
  const chapter = service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: rootId,
    title: "Chapter 1",
    body: "Once upon a time",
    anchorPointId: point.id,
  });
  service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: chapter.id,
    title: "Scene 1",
    body: "Opening",
  });
  service.mkdirAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    path: "/lore",
  });
  service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    path: "/lore/world.md",
    content: "world building",
  });

  const before = service.exportContentSubtree(workspace.projectId, workspace.id);
  const auxBefore = service.exportAuxSnapshotTree(workspace.projectId, workspace.id);
  const timelineBefore = service.listTimelinePoints(workspace.projectId, workspace.id);

  const commit = await service.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchId,
    message: "first commit",
    author: "tester",
  });
  expect(commit.id).toMatch(/^[0-9a-f]{40}$/);

  // Mutate the working copy after the commit.
  service.updateContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    nodeId: chapter.id,
    title: "Changed title",
    body: "different",
  });
  service.deleteAuxNodeAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    path: "/lore",
  });

  // Checkout the commit and verify state is restored exactly.
  await service.checkoutCommit({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    commitId: commit.id,
  });

  expect(service.exportContentSubtree(workspace.projectId, workspace.id)).toEqual(before);
  expect(service.exportAuxSnapshotTree(workspace.projectId, workspace.id)).toEqual(auxBefore);
  expect(service.listTimelinePoints(workspace.projectId, workspace.id)).toEqual(timelineBefore);
});

test("identical content across commits shares the same git tree", async () => {
  const workspace = seedProject("proj_dedup");
  service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    title: "Dup",
    body: "shared body text",
  });

  const first = await service.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchId,
    message: "c1",
  });

  // Commit again without changes: Git may create a new commit, but it should point at the same tree.
  const second = await service.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchId,
    message: "c2",
  });
  expect(second.id).toMatch(/^[0-9a-f]{40}$/);
  expect(second.treeId).toBe(first.treeId);
});

test("branch off a commit shares the same head and forked metadata", async () => {
  const workspace = seedProject("proj_branch");
  service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    title: "Base",
    body: "base",
  });
  const commit = await await service.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchId,
    message: "base",
  });

  const featureWorkspace = await service.createBranchWorkspace({
    projectId: "proj_branch",
    name: "feature",
    fromCommitId: commit.id,
  });

  const branch = service.getBranch(featureWorkspace.projectId, featureWorkspace.branchId);
  expect(branch.forkedFromCommitId).toBe(commit.id);
  expect(
    await service.getBranchHeadCommitId(featureWorkspace.projectId, featureWorkspace.branchId),
  ).toBe(commit.id);

  // The new workspace is checked out from the commit and has the same content.
  const exported = service.exportContentSubtree(featureWorkspace.projectId, featureWorkspace.id);
  expect(exported.nodes[0]?.title).toBe("Base");
  expect(exported.nodes[0]?.body).toBe("base");
});

test("branch workspaces restore aux overlay paths", async () => {
  const workspace = seedProject("proj_branch_aux_overlay_paths");
  service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    path: "/notes.md",
    content: "origin",
  });
  const point = service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    label: "Point",
  });
  service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/notes.md",
    content: "point",
  });
  const commit = await await service.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchId,
    message: "base",
  });

  const firstFeature = await service.createBranchWorkspace({
    projectId: "proj_branch_aux_overlay_paths",
    name: "feature-one",
    fromCommitId: commit.id,
  });
  const secondFeature = await service.createBranchWorkspace({
    projectId: "proj_branch_aux_overlay_paths",
    name: "feature-two",
    fromCommitId: commit.id,
  });

  expect(
    service.readAuxByPathAt(firstFeature.projectId, firstFeature.id, point.id, "/notes.md")
      ?.content,
  ).toBe("point");
  expect(
    service.readAuxByPathAt(secondFeature.projectId, secondFeature.id, point.id, "/notes.md")
      ?.content,
  ).toBe("point");
});

test("branch workspace timeline deletion only checks anchors in that workspace", async () => {
  const workspace = seedProject("proj_branch_timeline_delete");
  const point = service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    label: "Shared timeline point id",
  });
  service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    title: "Main branch chapter",
    anchorPointId: point.id,
  });
  const commit = await await service.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchId,
    message: "base",
  });
  const featureWorkspace = await service.createBranchWorkspace({
    projectId: "proj_branch_timeline_delete",
    name: "feature",
    fromCommitId: commit.id,
  });

  const featureChapter = service
    .exportContentSubtree(featureWorkspace.projectId, featureWorkspace.id)
    .nodes.find((node) => node.title === "Main branch chapter");
  expect(featureChapter?.anchorTimelinePointId).toBe(point.id);

  service.deleteContentNode({
    projectId: featureWorkspace.projectId,
    workspaceId: featureWorkspace.id,
    nodeId: featureChapter!.id,
  });

  expect(() =>
    service.deleteTimelinePoint(featureWorkspace.projectId, featureWorkspace.id, point.id),
  ).not.toThrow();
  expect(
    service
      .listTimelinePoints(featureWorkspace.projectId, featureWorkspace.id)
      .map((item) => item.id),
  ).toEqual([service.ORIGIN_TIMELINE_POINT_ID]);
  expect(
    service.listTimelinePoints(workspace.projectId, workspace.id).map((item) => item.id),
  ).toContain(point.id);
});

test("deleting a branch also deletes its workspace", async () => {
  const workspace = seedProject("proj_delete_branch");
  const featureWorkspace = await service.createBranchWorkspace({
    projectId: "proj_delete_branch",
    name: "feature",
  });

  await service.deleteBranch(featureWorkspace.projectId, featureWorkspace.branchId);

  expect(() => service.getBranch(featureWorkspace.projectId, featureWorkspace.branchId)).toThrow(
    "未找到分支。",
  );
  expect(() => service.getWorkspace(featureWorkspace.projectId, featureWorkspace.id)).toThrow(
    "未找到工作区。",
  );
  expect(service.getWorkspace(workspace.projectId, workspace.id).branchId).toBe(workspace.branchId);
});

test("default branch still cannot be deleted", async () => {
  const workspace = seedProject("proj_delete_default");

  await expect(service.deleteBranch(workspace.projectId, workspace.branchId)).rejects.toThrow(
    "无法删除：这是项目的默认分支。",
  );
});

test("merge metadata records multiple parents without merging", async () => {
  const workspace = seedProject("proj_merge");
  service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    title: "A",
  });
  const base = await await service.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchId,
    message: "base",
  });

  const otherWorkspace = await service.createBranchWorkspace({
    projectId: "proj_merge",
    name: "side",
    fromCommitId: base.id,
  });
  const sideCommit = await await service.createCommit({
    projectId: otherWorkspace.projectId,
    branchId: otherWorkspace.branchId,
    message: "side change",
  });

  const mergeCommit = await service.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchId,
    message: "merge side",
    extraParents: [{ parentId: sideCommit.id }],
  });

  const detail = await service.getCommit(mergeCommit.id, "proj_merge");
  expect(detail.parents.length).toBe(2);
  expect(detail.parents[0]?.parentId).toBe(base.id);
  expect(detail.parents[0]?.mergeRole).toBe("mainline");
  expect(detail.parents[1]?.parentId).toBe(sideCommit.id);
  expect(detail.parents[1]?.mergeRole).toBe("merged");
});

test("listCommits walks the mainline history newest first", async () => {
  const workspace = seedProject("proj_history");
  service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    title: "One",
  });
  const c1 = await await service.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchId,
    message: "one",
  });
  service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    title: "Two",
  });
  const c2 = await await service.createCommit({
    projectId: workspace.projectId,
    branchId: workspace.branchId,
    message: "two",
  });

  const history = await service.listCommits(workspace.projectId, workspace.branchId);
  expect(history.map((commit) => commit.id)).toEqual([c2.id, c1.id]);
});

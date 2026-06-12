import { eq } from "drizzle-orm";
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

test("default workspace creates a default branch and links project", () => {
  const workspace = seedProject("proj_default");
  expect(workspace.branchId).toBeTruthy();

  const project = db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, "proj_default"))
    .get();
  expect(project?.defaultBranchId).toBe(workspace.branchId);

  const branch = service.getBranch(workspace.branchId);
  expect(branch.name).toBe("main");
  expect(branch.headCommitId).toBeNull();
});

test("commit then checkout round-trips content, timeline and aux state", () => {
  const workspace = seedProject("proj_rt");
  const rootId = workspace.contentRootId!;

  const point = service.createTimelinePoint({
    workspaceId: workspace.id,
    label: "Intro",
  });
  const chapter = service.createContentNode({
    workspaceId: workspace.id,
    parentId: rootId,
    title: "Chapter 1",
    body: "Once upon a time",
    anchorPointId: point.id,
  });
  service.createContentNode({
    workspaceId: workspace.id,
    parentId: chapter.id,
    title: "Scene 1",
    body: "Opening",
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

  const before = service.exportContentSubtree(workspace.id);
  const auxBefore = service.exportAuxSnapshotTree(workspace.id);
  const timelineBefore = service.listTimelinePoints(workspace.id);

  const commit = service.createCommit({
    branchId: workspace.branchId,
    message: "first commit",
    author: "tester",
  });
  expect(commit.id).toMatch(/^commit_/);

  // Mutate the working copy after the commit.
  service.updateContentNode({
    workspaceId: workspace.id,
    nodeId: chapter.id,
    title: "Changed title",
    body: "different",
  });
  service.deleteAuxNodeAt({ workspaceId: workspace.id, nodeId: dir.id });

  // Checkout the commit and verify state is restored exactly.
  service.checkoutCommit({ workspaceId: workspace.id, commitId: commit.id });

  expect(service.exportContentSubtree(workspace.id)).toEqual(before);
  expect(service.exportAuxSnapshotTree(workspace.id)).toEqual(auxBefore);
  expect(service.listTimelinePoints(workspace.id)).toEqual(timelineBefore);
});

test("identical content across commits shares blobs and tree objects", () => {
  const workspace = seedProject("proj_dedup");
  service.createContentNode({
    workspaceId: workspace.id,
    parentId: workspace.contentRootId!,
    title: "Dup",
    body: "shared body text",
  });

  service.createCommit({ branchId: workspace.branchId, message: "c1" });
  const blobCountAfterFirst = db.select().from(schema.blobs).all().length;
  const treeCountAfterFirst = db.select().from(schema.treeObjects).all().length;

  // Commit again without changes: should not create new blobs or tree objects.
  service.createCommit({ branchId: workspace.branchId, message: "c2" });
  expect(db.select().from(schema.blobs).all().length).toBe(blobCountAfterFirst);
  expect(db.select().from(schema.treeObjects).all().length).toBe(treeCountAfterFirst);
});

test("branch off a commit shares the same head and forked metadata", () => {
  const workspace = seedProject("proj_branch");
  service.createContentNode({
    workspaceId: workspace.id,
    parentId: workspace.contentRootId!,
    title: "Base",
    body: "base",
  });
  const commit = service.createCommit({ branchId: workspace.branchId, message: "base" });

  const featureWorkspace = service.createBranchWorkspace({
    projectId: "proj_branch",
    name: "feature",
    fromCommitId: commit.id,
  });

  const branch = service.getBranch(featureWorkspace.branchId);
  expect(branch.forkedFromCommitId).toBe(commit.id);
  expect(branch.headCommitId).toBe(commit.id);

  // The new workspace is checked out from the commit and has the same content.
  const exported = service.exportContentSubtree(featureWorkspace.id);
  expect(exported.nodes[0]?.title).toBe("Base");
  expect(exported.nodes[0]?.body).toBe("base");
});

test("branch workspaces restore aux layers with globally unique layer ids", () => {
  const workspace = seedProject("proj_branch_aux_layer_ids");
  const rootId = workspace.auxRootId!;
  const notesFile = service.writeFileAt({
    workspaceId: workspace.id,
    parentDirId: rootId,
    name: "notes.md",
    content: "origin",
  });
  const point = service.createTimelinePoint({
    workspaceId: workspace.id,
    label: "Point",
  });
  service.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: point.id,
    nodeId: notesFile.id,
    content: "point",
  });
  const commit = service.createCommit({ branchId: workspace.branchId, message: "base" });

  const firstFeature = service.createBranchWorkspace({
    projectId: "proj_branch_aux_layer_ids",
    name: "feature-one",
    fromCommitId: commit.id,
  });
  const secondFeature = service.createBranchWorkspace({
    projectId: "proj_branch_aux_layer_ids",
    name: "feature-two",
    fromCommitId: commit.id,
  });

  expect(service.readAuxByPathAt(firstFeature.id, point.id, "/notes.md")?.content).toBe("point");
  expect(service.readAuxByPathAt(secondFeature.id, point.id, "/notes.md")?.content).toBe("point");
});

test("branch workspace timeline deletion only checks anchors in that workspace", () => {
  const workspace = seedProject("proj_branch_timeline_delete");
  const point = service.createTimelinePoint({
    workspaceId: workspace.id,
    label: "Shared timeline point id",
  });
  service.createContentNode({
    workspaceId: workspace.id,
    parentId: workspace.contentRootId!,
    title: "Main branch chapter",
    anchorPointId: point.id,
  });
  const commit = service.createCommit({ branchId: workspace.branchId, message: "base" });
  const featureWorkspace = service.createBranchWorkspace({
    projectId: "proj_branch_timeline_delete",
    name: "feature",
    fromCommitId: commit.id,
  });

  const featureChapter = service
    .exportContentSubtree(featureWorkspace.id)
    .nodes.find((node) => node.title === "Main branch chapter");
  expect(featureChapter?.anchorTimelinePointId).toBe(point.id);

  service.deleteContentNode({ workspaceId: featureWorkspace.id, nodeId: featureChapter!.id });

  expect(() => service.deleteTimelinePoint(featureWorkspace.id, point.id)).not.toThrow();
  expect(service.listTimelinePoints(featureWorkspace.id).map((item) => item.id)).toEqual([
    service.ORIGIN_TIMELINE_POINT_ID,
  ]);
  expect(service.listTimelinePoints(workspace.id).map((item) => item.id)).toContain(point.id);
});

test("deleting a branch also deletes its workspace", () => {
  const workspace = seedProject("proj_delete_branch");
  const featureWorkspace = service.createBranchWorkspace({
    projectId: "proj_delete_branch",
    name: "feature",
  });

  service.deleteBranch(featureWorkspace.branchId);

  expect(() => service.getBranch(featureWorkspace.branchId)).toThrow("未找到分支。");
  expect(() => service.getWorkspace(featureWorkspace.id)).toThrow("未找到工作区。");
  expect(service.getWorkspace(workspace.id).branchId).toBe(workspace.branchId);
});

test("default branch still cannot be deleted", () => {
  const workspace = seedProject("proj_delete_default");

  expect(() => service.deleteBranch(workspace.branchId)).toThrow("无法删除：这是项目的默认分支。");
});

test("merge metadata records multiple parents without merging", () => {
  const workspace = seedProject("proj_merge");
  service.createContentNode({
    workspaceId: workspace.id,
    parentId: workspace.contentRootId!,
    title: "A",
  });
  const base = service.createCommit({ branchId: workspace.branchId, message: "base" });

  const otherWorkspace = service.createBranchWorkspace({
    projectId: "proj_merge",
    name: "side",
    fromCommitId: base.id,
  });
  const sideCommit = service.createCommit({
    branchId: otherWorkspace.branchId,
    message: "side change",
  });

  const mergeCommit = service.createCommit({
    branchId: workspace.branchId,
    message: "merge side",
    extraParents: [{ parentId: sideCommit.id }],
  });

  const detail = service.getCommit(mergeCommit.id, "proj_merge");
  expect(detail.parents.length).toBe(2);
  expect(detail.parents[0]?.parentId).toBe(base.id);
  expect(detail.parents[0]?.mergeRole).toBe("mainline");
  expect(detail.parents[1]?.parentId).toBe(sideCommit.id);
  expect(detail.parents[1]?.mergeRole).toBe("merged");
});

test("listCommits walks the mainline history newest first", () => {
  const workspace = seedProject("proj_history");
  service.createContentNode({
    workspaceId: workspace.id,
    parentId: workspace.contentRootId!,
    title: "One",
  });
  const c1 = service.createCommit({ branchId: workspace.branchId, message: "one" });
  service.createContentNode({
    workspaceId: workspace.id,
    parentId: workspace.contentRootId!,
    title: "Two",
  });
  const c2 = service.createCommit({ branchId: workspace.branchId, message: "two" });

  const history = service.listCommits(workspace.branchId);
  expect(history.map((commit) => commit.id)).toEqual([c2.id, c1.id]);
});

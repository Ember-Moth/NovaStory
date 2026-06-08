import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

const tempDir = mkdtempSync(join(tmpdir(), "novel-evolver-"));
const dbPath = join(tempDir, "workspace-test.sqlite");
process.env.DATABASE_URL = dbPath;

const { db, schema } = await import("../db");
const service = await import("./index");

function seedProject(projectId: string) {
  db.insert(schema.projects)
    .values({
      id: projectId,
      name: `Project ${projectId}`,
      description: null,
    })
    .run();
  return service.createDefaultWorkspace(projectId);
}

beforeEach(() => {
  db.delete(schema.auxNodeLayers).run();
  db.delete(schema.contentNodes).run();
  db.delete(schema.timelinePoints).run();
  db.delete(schema.auxNodes).run();
  db.delete(schema.workspaces).run();
  db.delete(schema.projects).run();
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

test("content export preserves sibling order and nesting", () => {
  const workspace = seedProject("project_content");
  const rootId = workspace.contentRootId!;

  const chapter1 = service.createContentNode({
    workspaceId: workspace.id,
    parentId: rootId,
    kind: "chapter",
    title: "Chapter 1",
  });
  const chapter2 = service.createContentNode({
    workspaceId: workspace.id,
    parentId: rootId,
    afterSiblingId: chapter1.id,
    kind: "chapter",
    title: "Chapter 2",
  });
  service.createContentNode({
    workspaceId: workspace.id,
    parentId: rootId,
    kind: "chapter",
    title: "Prologue",
  });
  service.createContentNode({
    workspaceId: workspace.id,
    parentId: chapter1.id,
    kind: "scene",
    title: "Scene 1",
    body: "Opening scene",
  });

  const exported = service.exportContentSubtree(workspace.id);
  expect(exported.nodes.map((node) => node.title)).toEqual(["Prologue", "Chapter 1", "Chapter 2"]);
  expect(exported.nodes[1]?.children.map((node) => node.title)).toEqual(["Scene 1"]);
  expect(chapter2.parentId).toBe(rootId);
});

test("aux overlay resolves by timeline point and composeWritingContext follows anchor point", () => {
  const workspace = seedProject("project_overlay");
  const rootId = workspace.auxRootId!;
  const contentRootId = workspace.contentRootId!;

  const stateDir = service.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: rootId,
    name: "state",
  });
  const locationFile = service.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: stateDir.id,
    name: "location.md",
    content: "home",
  });
  const point = service.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    key: "after_leave_home",
    label: "After leave home",
  });
  service.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: point.id,
    nodeId: locationFile.id,
    content: "park",
  });
  const scene = service.createContentNode({
    workspaceId: workspace.id,
    parentId: contentRootId,
    anchorPointId: point.id,
    kind: "scene",
    title: "Arrival",
  });

  expect(
    service.readAuxByPathAt(workspace.id, service.ORIGIN_TIMELINE_POINT_ID, "/state/location.md")
      ?.content,
  ).toBe("home");
  expect(service.readAuxByPathAt(workspace.id, point.id, "/state/location.md")?.content).toBe(
    "park",
  );

  const context = service.composeWritingContext(workspace.id, scene.id);
  expect(context.timelinePointId).toBe(point.id);
  expect(context.auxSnapshot.find((node) => node.path === "/state/location.md")?.content).toBe(
    "park",
  );
});

test("symlink keeps following the same aux node after rename and move", () => {
  const workspace = seedProject("project_symlink");
  const rootId = workspace.auxRootId!;

  const places = service.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: rootId,
    name: "places",
  });
  const home = service.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: places.id,
    name: "home",
  });
  const bathroom = service.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: home.id,
    name: "bathroom",
  });
  service.linkAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: rootId,
    name: "current_location",
    targetNodeId: bathroom.id,
  });

  const point = service.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    key: "after_move",
    label: "After move",
  });
  const villa = service.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: point.id,
    parentDirId: places.id,
    name: "villa",
  });
  service.moveAuxNodeAt({
    workspaceId: workspace.id,
    timelinePointId: point.id,
    nodeId: bathroom.id,
    newParentDirId: villa.id,
    newName: "main_bathroom",
  });

  const resolved = service.readAuxByPathAt(workspace.id, point.id, "/current_location");
  expect(resolved?.id).toBe(bathroom.id);
  expect(resolved?.path).toBe("/places/villa/main_bathroom");

  const exported = service.exportAuxSnapshotTree(workspace.id, point.id);
  expect(exported.timelinePointId).toBe(point.id);
  expect(exported.nodes.map((node) => node.name)).toEqual(["current_location", "places"]);
  expect(exported.nodes[0]?.symlinkTargetPath).toBe("/places/villa/main_bathroom");
  expect(exported.nodes[1]?.children.map((node) => node.name)).toEqual(["home", "villa"]);
});

test("content node deletion removes subtree and preserves sibling order", () => {
  const workspace = seedProject("project_content_delete");
  const rootId = workspace.contentRootId!;

  const chapter1 = service.createContentNode({
    workspaceId: workspace.id,
    parentId: rootId,
    kind: "chapter",
    title: "Chapter 1",
  });
  service.createContentNode({
    workspaceId: workspace.id,
    parentId: rootId,
    afterSiblingId: chapter1.id,
    kind: "chapter",
    title: "Chapter 2",
  });
  service.createContentNode({
    workspaceId: workspace.id,
    parentId: chapter1.id,
    kind: "scene",
    title: "Scene 1",
  });

  service.deleteContentNode({ workspaceId: workspace.id, nodeId: chapter1.id });

  const exported = service.exportContentSubtree(workspace.id);
  expect(exported.nodes.map((node) => node.title)).toEqual(["Chapter 2"]);
});

test("deleting a middle content sibling rewires next sibling without violating uniqueness", () => {
  const workspace = seedProject("project_content_delete_middle");
  const rootId = workspace.contentRootId!;

  const chapter1 = service.createContentNode({
    workspaceId: workspace.id,
    parentId: rootId,
    kind: "chapter",
    title: "Chapter 1",
  });
  const chapter2 = service.createContentNode({
    workspaceId: workspace.id,
    parentId: rootId,
    afterSiblingId: chapter1.id,
    kind: "chapter",
    title: "Chapter 2",
  });
  service.createContentNode({
    workspaceId: workspace.id,
    parentId: rootId,
    afterSiblingId: chapter2.id,
    kind: "chapter",
    title: "Chapter 3",
  });

  expect(() =>
    service.deleteContentNode({ workspaceId: workspace.id, nodeId: chapter2.id }),
  ).not.toThrow();

  const exported = service.exportContentSubtree(workspace.id);
  expect(exported.nodes.map((node) => node.title)).toEqual(["Chapter 1", "Chapter 3"]);
});

test("content node anchor point can be updated", () => {
  const workspace = seedProject("project_anchor_update");
  const contentRootId = workspace.contentRootId!;

  const pointA = service.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    key: "anchor_point_a",
    label: "Point A",
  });
  const pointB = service.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: pointA.id,
    key: "anchor_point_b",
    label: "Point B",
  });
  const scene = service.createContentNode({
    workspaceId: workspace.id,
    parentId: contentRootId,
    anchorPointId: pointA.id,
    kind: "scene",
    title: "Scene",
  });

  service.updateContentNode({
    workspaceId: workspace.id,
    nodeId: scene.id,
    anchorPointId: pointB.id,
  });

  const exported = service.exportContentSubtree(workspace.id);
  expect(exported.nodes[0]?.anchorTimelinePointId).toBe(pointB.id);
});

test("timeline point deletion is blocked when content still anchors to it", () => {
  const workspace = seedProject("project_guard");
  const contentRootId = workspace.contentRootId!;
  const point = service.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    key: "occupied_point",
    label: "Occupied point",
  });

  service.createContentNode({
    workspaceId: workspace.id,
    parentId: contentRootId,
    anchorPointId: point.id,
    kind: "scene",
    title: "Guarded",
  });

  expect(() => service.deleteTimelinePoint(workspace.id, point.id)).toThrow(
    "无法删除：章节「Guarded」仍锚定在此时间点。",
  );
});

test("listAuxChangesAt only returns layer changes at the requested timeline point", () => {
  const workspace = seedProject("project_aux_changes");
  const rootId = workspace.auxRootId!;

  const stateDir = service.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: rootId,
    name: "state",
  });
  const locationFile = service.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: stateDir.id,
    name: "location.md",
    content: "home",
  });
  const point = service.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    key: "overlay_point",
    label: "Overlay point",
  });
  service.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: point.id,
    nodeId: locationFile.id,
    content: "park",
  });
  service.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: point.id,
    parentDirId: rootId,
    name: "delta-only",
  });

  expect(service.listAuxChangesAt(workspace.id, point.id)).toEqual([
    { path: "/delta-only", isDeleted: false },
    { path: "/state/location.md", isDeleted: false },
  ]);
});

test("timeline point deletion is blocked when auxiliary layers exist without purge", () => {
  const workspace = seedProject("project_aux_guard");
  const auxRootId = workspace.auxRootId!;
  const point = service.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    key: "aux_point",
    label: "Aux point",
  });

  service.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: point.id,
    parentDirId: auxRootId,
    name: "notes",
  });

  expect(() => service.deleteTimelinePoint(workspace.id, point.id)).toThrow(
    "无法删除：该时间点仍有关联的辅助信息，请先确认是否一并删除。",
  );
});

test("timeline point deletion purges auxiliary layers when requested", () => {
  const workspace = seedProject("project_aux_purge");
  const auxRootId = workspace.auxRootId!;
  const point = service.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    key: "purge_point",
    label: "Purge point",
  });

  const notesDir = service.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: point.id,
    parentDirId: auxRootId,
    name: "notes",
  });

  service.deleteTimelinePoint(workspace.id, point.id, { purgeAuxLayers: true });

  expect(service.listTimelinePoints(workspace.id).some((item) => item.id === point.id)).toBe(false);
  expect(
    db
      .select()
      .from(schema.auxNodeLayers)
      .where(eq(schema.auxNodeLayers.timelinePointId, point.id))
      .all(),
  ).toEqual([]);
  expect(db.select().from(schema.auxNodes).where(eq(schema.auxNodes.id, notesDir.id)).get()).toBe(
    undefined,
  );
});

test("deleteAuxNodeAt garbage-collects the aux node and tombstone layers", () => {
  const workspace = seedProject("project_aux_gc_delete");
  const auxRootId = workspace.auxRootId!;

  const notesDir = service.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: auxRootId,
    name: "notes",
  });

  service.deleteAuxNodeAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    nodeId: notesDir.id,
  });

  expect(db.select().from(schema.auxNodes).where(eq(schema.auxNodes.id, notesDir.id)).get()).toBe(
    undefined,
  );
  expect(
    db
      .select()
      .from(schema.auxNodeLayers)
      .where(eq(schema.auxNodeLayers.auxNodeId, notesDir.id))
      .all(),
  ).toEqual([]);
});

test("aux gc keeps parent while a child layer still references it", () => {
  const workspace = seedProject("project_aux_gc_parent_guard");
  const auxRootId = workspace.auxRootId!;

  const parentDir = service.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: auxRootId,
    name: "state",
  });
  const childFile = service.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: parentDir.id,
    name: "location.md",
    content: "home",
  });

  service.deleteAuxNodeAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    nodeId: parentDir.id,
  });

  expect(
    db.select().from(schema.auxNodes).where(eq(schema.auxNodes.id, parentDir.id)).get(),
  ).not.toBe(undefined);
  expect(
    db.select().from(schema.auxNodes).where(eq(schema.auxNodes.id, childFile.id)).get(),
  ).not.toBe(undefined);
});

test("aux gc keeps symlink target while a symlink still references it", () => {
  const workspace = seedProject("project_aux_gc_symlink_guard");
  const auxRootId = workspace.auxRootId!;

  const targetDir = service.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: auxRootId,
    name: "places",
  });
  const link = service.linkAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: auxRootId,
    name: "current",
    targetNodeId: targetDir.id,
  });

  service.deleteAuxNodeAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    nodeId: link.id,
  });

  expect(
    db.select().from(schema.auxNodes).where(eq(schema.auxNodes.id, targetDir.id)).get(),
  ).not.toBe(undefined);
});

test("aux gc removes deleted subtrees bottom-up", () => {
  const workspace = seedProject("project_aux_gc_subtree");
  const auxRootId = workspace.auxRootId!;

  const parentDir = service.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: auxRootId,
    name: "state",
  });
  const childFile = service.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    parentDirId: parentDir.id,
    name: "location.md",
    content: "home",
  });

  service.deleteAuxNodeAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    nodeId: childFile.id,
  });
  service.deleteAuxNodeAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    nodeId: parentDir.id,
  });

  expect(db.select().from(schema.auxNodes).where(eq(schema.auxNodes.id, childFile.id)).get()).toBe(
    undefined,
  );
  expect(db.select().from(schema.auxNodes).where(eq(schema.auxNodes.id, parentDir.id)).get()).toBe(
    undefined,
  );
});

test("timeline point label can be updated", () => {
  const workspace = seedProject("project_timeline_update");
  const point = service.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    key: "before_update",
    label: "Before update",
  });

  service.updateTimelinePoint({
    workspaceId: workspace.id,
    pointId: point.id,
    label: "After update",
  });

  const points = service.listTimelinePoints(workspace.id);
  const updated = points.find((entry) => entry.id === point.id);
  expect(updated?.label).toBe("After update");
});

test("implicit origin timeline point cannot be updated", () => {
  const workspace = seedProject("project_timeline_origin_guard");

  expect(() =>
    service.updateTimelinePoint({
      workspaceId: workspace.id,
      pointId: service.ORIGIN_TIMELINE_POINT_ID,
      label: "Forbidden",
    }),
  ).toThrow("Cannot update implicit origin timeline point");
});

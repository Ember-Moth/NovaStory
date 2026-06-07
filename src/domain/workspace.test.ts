import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, expect, test } from "bun:test";

const tempDir = mkdtempSync(join(tmpdir(), "novel-evolver-"));
const dbPath = join(tempDir, "workspace-test.sqlite");
process.env.DATABASE_URL = dbPath;

const { db, schema, sqlite } = await import("../db");
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
  sqlite.close();
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
    "Timeline point is still referenced by content nodes",
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

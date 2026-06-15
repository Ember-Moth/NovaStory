import { expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { setupMockDatabase } from "@/test/mock-db";

setupMockDatabase();

const { db, schema } = await import("@/db");
const service = await import("./index");

type ExportedAuxNode = ReturnType<typeof service.exportAuxSnapshotTree>["nodes"][number];

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

function flattenAuxNodes(nodes: ExportedAuxNode[]): ExportedAuxNode[] {
  return nodes.flatMap((node) => [node, ...flattenAuxNodes(node.children)]);
}

function listManuscriptDirs(worktreePath: string) {
  const manuscriptRoot = path.join(worktreePath, "manuscript");
  return fs
    .readdirSync(manuscriptRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function expectNoTemporaryManuscriptDirs(worktreePath: string) {
  expect(listManuscriptDirs(worktreePath).filter((name) => name.startsWith("__tmp__"))).toEqual([]);
}

test("content export preserves sibling order and nesting", () => {
  const workspace = seedProject("project_content");
  const rootId = null;

  const chapter1 = service.createContentNode({
    workspaceId: workspace.id,
    parentId: rootId,
    title: "Chapter 1",
  });
  const chapter2 = service.createContentNode({
    workspaceId: workspace.id,
    parentId: rootId,
    afterSiblingId: chapter1.id,
    title: "Chapter 2",
  });
  service.createContentNode({
    workspaceId: workspace.id,
    parentId: rootId,
    title: "Prologue",
  });
  service.createContentNode({
    workspaceId: workspace.id,
    parentId: chapter1.id,
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
  const contentRootId = null;

  service.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state",
  });
  service.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state/location.md",
    content: "home",
  });
  const point = service.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "After leave home",
  });
  service.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/state/location.md",
    content: "park",
  });
  const scene = service.createContentNode({
    workspaceId: workspace.id,
    parentId: contentRootId,
    anchorPointId: point.id,
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

test("symlink stores a logical aux path target and does not follow target moves", () => {
  const workspace = seedProject("project_symlink");

  service.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/places",
  });
  service.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/places/home",
  });
  service.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/places/home/bathroom",
  });
  service.linkAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/current_location",
    targetPath: "/places/home/bathroom",
  });

  const point = service.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "After move",
  });
  service.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/places/villa",
  });
  service.moveAuxNodeAt({
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/places/home/bathroom",
    newPath: "/places/villa/main_bathroom",
  });

  const resolved = service.readAuxByPathAt(workspace.id, point.id, "/current_location");
  expect(resolved?.nodeType).toBe("symlink");
  expect(resolved?.path).toBe("/current_location");
  expect(resolved?.symlinkTargetPath).toBe("/places/home/bathroom");

  const exported = service.exportAuxSnapshotTree(workspace.id, point.id);
  expect(exported.timelinePointId).toBe(point.id);
  expect(exported.nodes.map((node) => node.name)).toEqual(["current_location", "places"]);
  expect(exported.nodes.find((node) => node.name === "current_location")?.symlinkTargetPath).toBe(
    "/places/home/bathroom",
  );
  expect(
    exported.nodes.find((node) => node.name === "places")?.children.map((node) => node.name),
  ).toEqual(["home", "villa"]);
});

test("retargetAuxSymlinkAt updates the exported symlink target path", () => {
  const workspace = seedProject("project_symlink_retarget");

  service.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/old.md",
    content: "old",
  });
  service.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state",
  });
  service.linkAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/current",
    targetPath: "/old.md",
  });

  service.retargetAuxSymlinkAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/current",
    targetPath: "/state",
  });

  const exported = service.exportAuxSnapshotTree(workspace.id);
  expect(exported.nodes.find((node) => node.path === "/current")?.symlinkTargetPath).toBe("/state");
  expect(
    service.readAuxByPathAt(workspace.id, service.ORIGIN_TIMELINE_POINT_ID, "/current")?.path,
  ).toBe("/current");
});

test("retargetAuxSymlinkAt can point to another symlink node", () => {
  const workspace = seedProject("project_symlink_retarget_symlink");

  service.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/notes.md",
    content: "notes",
  });
  service.linkAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/target_link",
    targetPath: "/notes.md",
  });
  service.linkAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/source_link",
    targetPath: "/notes.md",
  });

  service.retargetAuxSymlinkAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/source_link",
    targetPath: "/target_link",
  });

  const exported = service.exportAuxSnapshotTree(workspace.id);
  expect(exported.nodes.find((node) => node.path === "/source_link")?.symlinkTargetPath).toBe(
    "/target_link",
  );
  expect(
    service.readAuxByPathAt(workspace.id, service.ORIGIN_TIMELINE_POINT_ID, "/source_link")?.path,
  ).toBe("/source_link");
});

test("retargetAuxSymlinkAt records self and indirect symlink targets", () => {
  const workspace = seedProject("project_symlink_retarget_cycle");

  service.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/notes.md",
    content: "notes",
  });
  service.linkAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/source_link",
    targetPath: "/notes.md",
  });
  service.linkAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/loop_b",
    targetPath: "/source_link",
  });
  service.linkAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/loop_a",
    targetPath: "/loop_b",
  });

  service.retargetAuxSymlinkAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/source_link",
    targetPath: "/source_link",
  });
  expect(
    service.exportAuxSnapshotTree(workspace.id).nodes.find((node) => node.path === "/source_link")
      ?.symlinkTargetPath,
  ).toBe("/source_link");

  service.retargetAuxSymlinkAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/source_link",
    targetPath: "/loop_a",
  });
  expect(
    service.exportAuxSnapshotTree(workspace.id).nodes.find((node) => node.path === "/source_link")
      ?.symlinkTargetPath,
  ).toBe("/loop_a");
});

test("retargetAuxSymlinkAt rejects non-symlink sources", () => {
  const workspace = seedProject("project_symlink_retarget_non_symlink");

  service.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/notes.md",
    content: "notes",
  });
  service.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state",
  });

  expect(() =>
    service.retargetAuxSymlinkAt({
      workspaceId: workspace.id,
      timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
      path: "/notes.md",
      targetPath: "/state",
    }),
  ).toThrow("当前辅助信息不是链接。");
});

test("aux node names must stay unique within the same parent", () => {
  const workspace = seedProject("project_aux_unique_names");

  service.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/notes.md",
    content: "notes",
  });
  service.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state",
  });

  expect(() =>
    service.moveAuxNodeAt({
      workspaceId: workspace.id,
      timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
      path: "/state",
      newPath: "/notes.md",
    }),
  ).toThrow("同路径辅助信息已存在。");

  const spacedDir = service.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/ notes.md ",
  });
  expect(spacedDir.path).toBe("/ notes.md");

  service.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/notes.md",
    content: "updated",
  });
  expect(
    service.readAuxByPathAt(workspace.id, service.ORIGIN_TIMELINE_POINT_ID, "/notes.md")?.content,
  ).toBe("updated");

  expect(() =>
    service.linkAt({
      workspaceId: workspace.id,
      timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
      path: "/notes.md",
      targetPath: "/notes.md",
    }),
  ).toThrow("同路径辅助信息已存在。");

  expect(service.exportAuxSnapshotTree(workspace.id).nodes.map((node) => node.path)).toEqual([
    "/ notes.md",
    "/notes.md",
    "/state",
  ]);
});

test("origin aux creation can coexist with descendant timeline names", () => {
  const workspace = seedProject("project_aux_origin_descendant_duplicate");
  const point = service.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "Point 1",
  });

  service.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/新文件 1",
    content: "point file",
  });

  service.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/新文件 1",
    content: "origin file",
  });

  expect(
    service.exportAuxSnapshotTree(workspace.id, point.id).nodes.map((node) => node.path),
  ).toEqual(["/新文件 1"]);
  expect(service.readAuxByPathAt(workspace.id, point.id, "/新文件 1")?.content).toBe("point file");
});

test("aux snapshot sorts top-level nodes by path", () => {
  const workspace = seedProject("project_aux_natural_sort");

  service.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/文件10",
    content: "",
  });
  service.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/目录十",
  });
  service.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/文件2",
    content: "",
  });
  service.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/目录二",
  });
  service.linkAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/文件１ - 链接",
    targetPath: "/目录十",
  });

  expect(service.exportAuxSnapshotTree(workspace.id).nodes.map((node) => node.path)).toEqual([
    "/文件１ - 链接",
    "/文件10",
    "/文件2",
    "/目录二",
    "/目录十",
  ]);
});

test("aux snapshot shows current timeline deleted file tombstones", () => {
  const workspace = seedProject("project_aux_deleted_ghost_natural_sort");

  service.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/文件10",
    content: "",
  });
  service.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/文件2",
    content: "",
  });

  const point = service.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "After delete file 10",
  });
  service.deleteAuxNodeAt({
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/文件10",
  });
  service.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/文件1",
    content: "",
  });

  const snapshot = service.exportAuxSnapshotTree(workspace.id, point.id);
  const statusByPath = new Map(snapshot.nodes.map((node) => [node.path, node.overlayStatus]));

  expect(statusByPath.get("/文件1")).toBe("visible");
  expect(statusByPath.get("/文件10")).toBe("deleted");
  expect(statusByPath.get("/文件2")).toBe("visible");
});

test("aux snapshot marks visible nodes with layers at the active timeline point", () => {
  const workspace = seedProject("project_aux_snapshot_changes");

  service.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state",
  });
  service.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state/location.md",
    content: "home",
  });
  service.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state/character.md",
    content: "calm",
  });

  const originSnapshot = service.exportAuxSnapshotTree(
    workspace.id,
    service.ORIGIN_TIMELINE_POINT_ID,
  );
  expect(flattenAuxNodes(originSnapshot.nodes).every((node) => !node.hasTimelineChange)).toBe(true);

  const point = service.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "After departure",
  });
  service.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/state/location.md",
    content: "home",
  });
  service.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/delta-only",
  });
  service.moveAuxNodeAt({
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/state/character.md",
    newPath: "/cast.md",
  });

  const pointSnapshot = service.exportAuxSnapshotTree(workspace.id, point.id);
  const changesByPath = new Map(
    flattenAuxNodes(pointSnapshot.nodes).map((node) => [node.path, node.hasTimelineChange]),
  );

  expect(changesByPath.get("/state")).toBe(false);
  expect(changesByPath.get("/state/location.md")).toBe(true);
  expect(changesByPath.get("/delta-only")).toBe(true);
  expect(changesByPath.get("/cast.md")).toBe(true);
});

test("aux snapshot shows deleted folder tombstones without descendants", () => {
  const workspace = seedProject("project_aux_deleted_ghosts");

  service.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state",
  });
  service.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state/location.md",
    content: "home",
  });

  const point = service.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "After delete state",
  });
  service.deleteAuxNodeAt({
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/state",
  });

  const snapshot = service.exportAuxSnapshotTree(workspace.id, point.id);
  expect(snapshot.nodes.find((node) => node.path === "/state")).toMatchObject({
    path: "/state",
    nodeType: "dir",
    overlayStatus: "deleted",
    children: [],
  });
  expect(
    flattenAuxNodes(snapshot.nodes).find((node) => node.path === "/state/location.md"),
  ).toBeUndefined();
});

test("whiteout deletion can be overridden by rewriting the same path", () => {
  const workspace = seedProject("project_aux_whiteout_recreate");

  service.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/notes.md",
    content: "origin",
  });
  const point = service.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "After delete notes",
  });
  service.deleteAuxNodeAt({
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/notes.md",
  });
  expect(service.readAuxByPathAt(workspace.id, point.id, "/notes.md")).toBeNull();

  service.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/notes.md",
    content: "replacement",
  });

  expect(service.readAuxByPathAt(workspace.id, point.id, "/notes.md")?.content).toBe("replacement");
});

test("aux snapshot exposes current timeline whiteouts as deleted rows", () => {
  const workspace = seedProject("project_aux_whiteout_deleted_rows");
  service.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/notes.md",
    content: "origin",
  });
  const point = service.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "After delete notes",
  });

  service.deleteAuxNodeAt({
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/notes.md",
  });

  const snapshot = service.exportAuxSnapshotTree(workspace.id, point.id);
  expect(snapshot.nodes).toEqual([
    expect.objectContaining({
      path: "/notes.md",
      name: "notes.md",
      nodeType: "file",
      overlayStatus: "deleted",
      hasTimelineChange: true,
      children: [],
    }),
  ]);
  expect(service.exportAuxSnapshotTree(workspace.id).nodes).toEqual([
    expect.objectContaining({
      path: "/notes.md",
      overlayStatus: "visible",
    }),
  ]);
});

test("aux snapshot does not expose origin or upper-only deletes as deleted rows", () => {
  const workspace = seedProject("project_aux_whiteout_deleted_rows_scope");
  service.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/origin.md",
    content: "origin",
  });
  service.deleteAuxNodeAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/origin.md",
  });
  expect(service.exportAuxSnapshotTree(workspace.id).nodes).toEqual([]);

  const point = service.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "Draft",
  });
  service.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/draft.md",
    content: "draft",
  });
  service.deleteAuxNodeAt({
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/draft.md",
  });

  expect(service.exportAuxSnapshotTree(workspace.id, point.id).nodes).toEqual([]);
});

test("restoreDeletedAuxNodeAt removes the current whiteout and restores lower folders", () => {
  const workspace = seedProject("project_aux_whiteout_restore");
  service.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state",
  });
  service.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state/location.md",
    content: "home",
  });
  const point = service.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "After delete state",
  });
  service.deleteAuxNodeAt({
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/state",
  });

  let snapshot = service.exportAuxSnapshotTree(workspace.id, point.id);
  expect(snapshot.nodes).toEqual([
    expect.objectContaining({
      path: "/state",
      nodeType: "dir",
      overlayStatus: "deleted",
      children: [],
    }),
  ]);

  service.restoreDeletedAuxNodeAt({
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/state",
  });

  snapshot = service.exportAuxSnapshotTree(workspace.id, point.id);
  expect(snapshot.nodes[0]).toMatchObject({
    path: "/state",
    overlayStatus: "visible",
    children: [
      expect.objectContaining({
        path: "/state/location.md",
        overlayStatus: "visible",
      }),
    ],
  });
  expect(
    fs.existsSync(path.join(workspace.worktreePath, `aux/timeline/${point.id}/.wh.state`)),
  ).toBe(false);
});

test("restoreDeletedAuxNodeAt rejects origin and missing whiteouts", () => {
  const workspace = seedProject("project_aux_whiteout_restore_rejects");
  service.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/notes.md",
    content: "origin",
  });
  const point = service.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "Draft",
  });

  expect(() =>
    service.restoreDeletedAuxNodeAt({
      workspaceId: workspace.id,
      timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
      path: "/notes.md",
    }),
  ).toThrow();
  expect(() =>
    service.restoreDeletedAuxNodeAt({
      workspaceId: workspace.id,
      timelinePointId: point.id,
      path: "/notes.md",
    }),
  ).toThrow();
});

test("content node deletion removes subtree and preserves sibling order", () => {
  const workspace = seedProject("project_content_delete");
  const rootId = null;

  const chapter1 = service.createContentNode({
    workspaceId: workspace.id,
    parentId: rootId,
    title: "Chapter 1",
  });
  service.createContentNode({
    workspaceId: workspace.id,
    parentId: rootId,
    afterSiblingId: chapter1.id,
    title: "Chapter 2",
  });
  service.createContentNode({
    workspaceId: workspace.id,
    parentId: chapter1.id,
    title: "Scene 1",
  });

  service.deleteContentNode({ workspaceId: workspace.id, nodeId: chapter1.id });

  const exported = service.exportContentSubtree(workspace.id);
  expect(exported.nodes.map((node) => node.title)).toEqual(["Chapter 2"]);
});

test("deleting a middle content sibling rewires next sibling without violating uniqueness", () => {
  const workspace = seedProject("project_content_delete_middle");
  const rootId = null;

  const chapter1 = service.createContentNode({
    workspaceId: workspace.id,
    parentId: rootId,
    title: "Chapter 1",
  });
  const chapter2 = service.createContentNode({
    workspaceId: workspace.id,
    parentId: rootId,
    afterSiblingId: chapter1.id,
    title: "Chapter 2",
  });
  service.createContentNode({
    workspaceId: workspace.id,
    parentId: rootId,
    afterSiblingId: chapter2.id,
    title: "Chapter 3",
  });

  expect(() =>
    service.deleteContentNode({ workspaceId: workspace.id, nodeId: chapter2.id }),
  ).not.toThrow();

  const exported = service.exportContentSubtree(workspace.id);
  expect(exported.nodes.map((node) => node.title)).toEqual(["Chapter 1", "Chapter 3"]);
});

test("content node move can reorder across parents and preserve child order", () => {
  const workspace = seedProject("project_content_move_cross_parent");
  const rootId = null;

  const chapter1 = service.createContentNode({
    workspaceId: workspace.id,
    parentId: rootId,
    title: "Chapter 1",
  });
  const chapter2 = service.createContentNode({
    workspaceId: workspace.id,
    parentId: rootId,
    afterSiblingId: chapter1.id,
    title: "Chapter 2",
  });
  const scene1 = service.createContentNode({
    workspaceId: workspace.id,
    parentId: chapter1.id,
    title: "Scene 1",
  });
  service.createContentNode({
    workspaceId: workspace.id,
    parentId: chapter1.id,
    afterSiblingId: scene1.id,
    title: "Scene 2",
  });

  service.moveContentNode({
    workspaceId: workspace.id,
    nodeId: scene1.id,
    newParentId: chapter2.id,
  });

  const exported = service.exportContentSubtree(workspace.id);
  expect(exported.nodes.map((node) => node.title)).toEqual(["Chapter 1", "Chapter 2"]);
  expect(exported.nodes[0]?.children.map((node) => node.title)).toEqual(["Scene 2"]);
  expect(exported.nodes[1]?.children.map((node) => node.title)).toEqual(["Scene 1"]);

  service.moveContentNode({
    workspaceId: workspace.id,
    nodeId: chapter2.id,
    newParentId: rootId,
  });

  expect(service.exportContentSubtree(workspace.id).nodes.map((node) => node.title)).toEqual([
    "Chapter 2",
    "Chapter 1",
  ]);
});

test("content node move can lift a nested child to the top level and remain reloadable", () => {
  const workspace = seedProject("project_content_move_child_to_top");

  const parent = service.createContentNode({
    workspaceId: workspace.id,
    parentId: null,
    title: "Parent",
  });
  const child = service.createContentNode({
    workspaceId: workspace.id,
    parentId: parent.id,
    title: "Child",
    body: "hello",
  });

  expect(() =>
    service.moveContentNode({
      workspaceId: workspace.id,
      nodeId: child.id,
      newParentId: null,
      afterSiblingId: parent.id,
    }),
  ).not.toThrow();

  const exported = service.exportContentSubtree(workspace.id);
  expect(exported.nodes.map((node) => node.title)).toEqual(["Parent", "Child"]);
  expect(exported.nodes[0]?.children).toEqual([]);
  expect(exported.nodes[1]).toMatchObject({
    id: child.id,
    title: "Child",
    body: "hello",
    children: [],
  });
});

test("content node move rejects moving a node below its own descendant", () => {
  const workspace = seedProject("project_content_move_into_descendant");
  const rootId = null;

  const chapter = service.createContentNode({
    workspaceId: workspace.id,
    parentId: rootId,
    title: "Chapter",
  });
  const scene = service.createContentNode({
    workspaceId: workspace.id,
    parentId: chapter.id,
    title: "Scene",
  });

  expect(() =>
    service.moveContentNode({
      workspaceId: workspace.id,
      nodeId: chapter.id,
      newParentId: scene.id,
    }),
  ).toThrow("无法移动：不能把章节移动到自己的子章节下。");
});

test("content node move rejects invalid targets without corrupting persisted tree", () => {
  const workspace = seedProject("project_content_move_invalid_target_clean");

  const chapter1 = service.createContentNode({
    workspaceId: workspace.id,
    parentId: null,
    title: "Chapter 1",
    body: "one",
  });
  const chapter2 = service.createContentNode({
    workspaceId: workspace.id,
    parentId: null,
    afterSiblingId: chapter1.id,
    title: "Chapter 2",
    body: "two",
  });
  const scene = service.createContentNode({
    workspaceId: workspace.id,
    parentId: chapter1.id,
    title: "Scene",
    body: "scene",
  });
  const before = service.exportContentSubtree(workspace.id);
  const rootDirsBefore = listManuscriptDirs(workspace.worktreePath);

  expect(() =>
    service.moveContentNode({
      workspaceId: workspace.id,
      nodeId: scene.id,
      newParentId: chapter2.id,
      afterSiblingId: chapter1.id,
    }),
  ).toThrow("无法移动章节：目标位置不在同一个父级下。");

  expect(service.exportContentSubtree(workspace.id)).toEqual(before);
  expect(listManuscriptDirs(workspace.worktreePath)).toEqual(rootDirsBefore);
  expectNoTemporaryManuscriptDirs(workspace.worktreePath);
});

test("content node move rejects self-referential positions without detaching directories", () => {
  const workspace = seedProject("project_content_move_self_target_clean");

  const chapter = service.createContentNode({
    workspaceId: workspace.id,
    parentId: null,
    title: "Chapter",
  });
  service.createContentNode({
    workspaceId: workspace.id,
    parentId: chapter.id,
    title: "Scene",
  });
  const before = service.exportContentSubtree(workspace.id);

  expect(() =>
    service.moveContentNode({
      workspaceId: workspace.id,
      nodeId: chapter.id,
      newParentId: chapter.id,
    }),
  ).toThrow("无法移动：不能把章节移动到自己的子章节下。");
  expect(() =>
    service.moveContentNode({
      workspaceId: workspace.id,
      nodeId: chapter.id,
      newParentId: null,
      afterSiblingId: chapter.id,
    }),
  ).toThrow("无法移动：目标位置不能是章节自身。");

  expect(service.exportContentSubtree(workspace.id)).toEqual(before);
  expectNoTemporaryManuscriptDirs(workspace.worktreePath);
});

test("content node creation rejects foreign after-sibling without writing partial nodes", () => {
  const workspace = seedProject("project_content_create_invalid_sibling_clean");

  const chapter = service.createContentNode({
    workspaceId: workspace.id,
    parentId: null,
    title: "Chapter",
  });
  const scene = service.createContentNode({
    workspaceId: workspace.id,
    parentId: chapter.id,
    title: "Scene",
  });
  const before = service.exportContentSubtree(workspace.id);

  expect(() =>
    service.createContentNode({
      workspaceId: workspace.id,
      parentId: null,
      afterSiblingId: scene.id,
      title: "Should not persist",
      body: "partial",
    }),
  ).toThrow("无法创建章节：目标位置不在同一个父级下。");

  expect(service.exportContentSubtree(workspace.id)).toEqual(before);
  expectNoTemporaryManuscriptDirs(workspace.worktreePath);
});

test("content body updates preserve front matter delimiters and normalize newlines", () => {
  const workspace = seedProject("project_content_body_roundtrip");
  const point = service.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "Draft",
  });
  const body = "---\nnot front matter inside body\n---\r\nLine 1\r\nLine 2\n";

  const chapter = service.createContentNode({
    workspaceId: workspace.id,
    parentId: null,
    title: "Original",
    body,
  });

  service.updateContentNode({
    workspaceId: workspace.id,
    nodeId: chapter.id,
    title: "",
    anchorPointId: point.id,
    body,
  });

  const exported = service.exportContentSubtree(workspace.id).nodes[0];
  expect(exported).toMatchObject({
    id: chapter.id,
    title: null,
    anchorTimelinePointId: point.id,
    body: "---\nnot front matter inside body\n---\nLine 1\nLine 2\n",
  });
  expect(service.readManuscriptNode(workspace.id, chapter.id).body).toBe(
    "---\nnot front matter inside body\n---\nLine 1\nLine 2\n",
  );
});

test("content node anchor point can be updated", () => {
  const workspace = seedProject("project_anchor_update");
  const contentRootId = null;

  const pointA = service.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "Point A",
  });
  const pointB = service.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: pointA.id,
    label: "Point B",
  });
  const scene = service.createContentNode({
    workspaceId: workspace.id,
    parentId: contentRootId,
    anchorPointId: pointA.id,
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
  const contentRootId = null;
  const point = service.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "Occupied point",
  });

  service.createContentNode({
    workspaceId: workspace.id,
    parentId: contentRootId,
    anchorPointId: point.id,
    title: "Guarded",
  });

  expect(() => service.deleteTimelinePoint(workspace.id, point.id)).toThrow(
    "无法删除：仍有章节锚定到该时间点。",
  );
});

test("listAuxChangesAt only returns layer changes at the requested timeline point", () => {
  const workspace = seedProject("project_aux_changes");

  service.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state",
  });
  service.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state/location.md",
    content: "home",
  });
  const point = service.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "Overlay point",
  });
  service.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/state/location.md",
    content: "park",
  });
  service.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/delta-only",
  });

  expect(service.listAuxChangesAt(workspace.id, point.id)).toEqual([
    { path: "/delta-only", isDeleted: false },
    { path: "/state/location.md", isDeleted: false },
  ]);
});

test("listAuxTimelineChangesAt compares a timeline point against its predecessor", () => {
  const workspace = seedProject("project_aux_timeline_diff");

  service.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state",
  });
  service.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state/location.md",
    content: "home",
  });
  service.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state/backup.md",
    content: "backup",
  });
  service.linkAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/current_location",
    targetPath: "/state/location.md",
  });
  const pointA = service.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "离家后",
  });
  service.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: pointA.id,
    path: "/delta-only.md",
    content: "delta",
  });
  service.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: pointA.id,
    path: "/state/location.md",
    content: "park",
  });
  const pointB = service.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: pointA.id,
    label: "折返前",
  });
  service.deleteAuxNodeAt({
    workspaceId: workspace.id,
    timelinePointId: pointB.id,
    path: "/delta-only.md",
  });
  service.retargetAuxSymlinkAt({
    workspaceId: workspace.id,
    timelinePointId: pointB.id,
    path: "/current_location",
    targetPath: "/state/backup.md",
  });

  expect(service.summarizeAuxTimelineChangesAt(workspace.id, pointA.id)).toEqual({
    hasChanges: true,
    added: 1,
    modified: 1,
    deleted: 0,
    total: 2,
  });
  expect(service.listAuxTimelineChangesAt(workspace.id, pointB.id)).toEqual([
    {
      kind: "modified",
      nodeType: "symlink",
      path: "/current_location",
      previousPath: null,
      symlinkTargetPath: "/state/backup.md",
      previousSymlinkTargetPath: "/state/location.md",
      changedAspects: ["symlink_target"],
    },
    {
      kind: "deleted",
      nodeType: "file",
      path: "/delta-only.md",
      previousPath: null,
      symlinkTargetPath: null,
      previousSymlinkTargetPath: null,
      changedAspects: [],
    },
  ]);
});

test("timeline point deletion is blocked when auxiliary layers exist without purge", () => {
  const workspace = seedProject("project_aux_guard");
  const point = service.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "Aux point",
  });

  service.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/notes",
  });

  expect(() => service.deleteTimelinePoint(workspace.id, point.id)).toThrow(
    "无法删除：该时间点仍有辅助信息变更。",
  );
});

test("timeline point deletion purges auxiliary overlay directory when requested", () => {
  const workspace = seedProject("project_aux_purge");
  const point = service.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "Purge point",
  });

  service.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/notes",
  });

  service.deleteTimelinePoint(workspace.id, point.id, { purgeAuxLayers: true });

  expect(service.listTimelinePoints(workspace.id).some((item) => item.id === point.id)).toBe(false);
  expect(fs.existsSync(path.join(workspace.worktreePath, "aux/timeline", point.id))).toBe(false);
});

test("timeline point insertion at origin rewires the previous head", () => {
  const workspace = seedProject("project_timeline_insert_origin");
  const pointA = service.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "Point A",
  });

  const pointB = service.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "Point B",
  });

  const ordered = service.listTimelinePoints(workspace.id);
  expect(ordered.map((point) => point.id)).toEqual([
    service.ORIGIN_TIMELINE_POINT_ID,
    pointB.id,
    pointA.id,
  ]);
});

test("timeline point batch insertion preserves order without requiring intermediate ids", () => {
  const workspace = seedProject("project_timeline_insert_batch");
  const pointA = service.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "Point A",
  });

  const created = service.createTimelinePoints({
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    points: [{ label: "Point B" }, { label: "Point C" }, { label: "Point D" }],
  });

  const ordered = service.listTimelinePoints(workspace.id);
  expect(created.map((point) => point.label)).toEqual(["Point B", "Point C", "Point D"]);
  expect(ordered.map((point) => point.id)).toEqual([
    service.ORIGIN_TIMELINE_POINT_ID,
    created[0]!.id,
    created[1]!.id,
    created[2]!.id,
    pointA.id,
  ]);
});

test("timeline point move rewires both source and target segments", () => {
  const workspace = seedProject("project_timeline_move");
  const pointA = service.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "Point A",
  });
  const pointB = service.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: pointA.id,
    label: "Point B",
  });
  const pointC = service.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: pointB.id,
    label: "Point C",
  });
  const pointD = service.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: pointC.id,
    label: "Point D",
  });

  service.moveTimelinePoint({
    workspaceId: workspace.id,
    pointId: pointC.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
  });

  let ordered = service.listTimelinePoints(workspace.id);
  expect(ordered.map((point) => point.id)).toEqual([
    service.ORIGIN_TIMELINE_POINT_ID,
    pointC.id,
    pointA.id,
    pointB.id,
    pointD.id,
  ]);

  service.moveTimelinePoint({
    workspaceId: workspace.id,
    pointId: pointA.id,
    afterPointId: pointD.id,
  });

  ordered = service.listTimelinePoints(workspace.id);
  expect(ordered.map((point) => point.id)).toEqual([
    service.ORIGIN_TIMELINE_POINT_ID,
    pointC.id,
    pointB.id,
    pointD.id,
    pointA.id,
  ]);
});

test("deleteAuxNodeAt physically removes origin aux nodes without whiteouts", () => {
  const workspace = seedProject("project_aux_gc_delete");

  service.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/notes",
  });
  fs.writeFileSync(path.join(workspace.worktreePath, "aux/origin/.wh.orphan"), "", "utf8");

  service.deleteAuxNodeAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/notes",
  });

  expect(
    service.readAuxByPathAt(workspace.id, service.ORIGIN_TIMELINE_POINT_ID, "/notes"),
  ).toBeNull();
  expect(fs.existsSync(path.join(workspace.worktreePath, "aux/origin/notes"))).toBe(false);
  expect(fs.existsSync(path.join(workspace.worktreePath, "aux/origin/.wh.notes"))).toBe(false);
  expect(fs.existsSync(path.join(workspace.worktreePath, "aux/origin/.wh.orphan"))).toBe(false);
});

test("deleteAuxNodeAt keeps timeline whiteouts only when hiding lower nodes", () => {
  const workspace = seedProject("project_aux_gc_timeline_whiteout");

  service.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/origin.md",
    content: "origin",
  });
  const point = service.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "Draft",
  });
  service.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/draft.md",
    content: "draft",
  });

  service.deleteAuxNodeAt({
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/draft.md",
  });
  service.deleteAuxNodeAt({
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/origin.md",
  });

  expect(
    fs.existsSync(path.join(workspace.worktreePath, `aux/timeline/${point.id}/draft.md`)),
  ).toBe(false);
  expect(
    fs.existsSync(path.join(workspace.worktreePath, `aux/timeline/${point.id}/.wh.draft.md`)),
  ).toBe(false);
  expect(
    fs.existsSync(path.join(workspace.worktreePath, `aux/timeline/${point.id}/.wh.origin.md`)),
  ).toBe(true);
});

test("deleting an aux parent hides its descendants", () => {
  const workspace = seedProject("project_aux_gc_parent_guard");

  service.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state",
  });
  service.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state/location.md",
    content: "home",
  });

  service.deleteAuxNodeAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state",
  });

  expect(
    service.readAuxByPathAt(workspace.id, service.ORIGIN_TIMELINE_POINT_ID, "/state"),
  ).toBeNull();
  expect(
    service.readAuxByPathAt(workspace.id, service.ORIGIN_TIMELINE_POINT_ID, "/state/location.md"),
  ).toBeNull();
});

test("deleting an aux symlink leaves its target visible", () => {
  const workspace = seedProject("project_aux_gc_symlink_guard");

  service.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/places",
  });
  service.linkAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/current",
    targetPath: "/places",
  });

  service.deleteAuxNodeAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/current",
  });

  expect(
    service.readAuxByPathAt(workspace.id, service.ORIGIN_TIMELINE_POINT_ID, "/places"),
  ).not.toBeNull();
  expect(
    service.readAuxByPathAt(workspace.id, service.ORIGIN_TIMELINE_POINT_ID, "/current"),
  ).toBeNull();
});

test("deleted aux subtree nodes are hidden and whiteouts are path-based", () => {
  const workspace = seedProject("project_aux_gc_subtree");

  service.mkdirAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state",
  });
  service.writeFileAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state/location.md",
    content: "home",
  });

  service.deleteAuxNodeAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state/location.md",
  });
  service.deleteAuxNodeAt({
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state",
  });

  expect(
    service.readAuxByPathAt(workspace.id, service.ORIGIN_TIMELINE_POINT_ID, "/state/location.md"),
  ).toBeNull();
  expect(
    service.readAuxByPathAt(workspace.id, service.ORIGIN_TIMELINE_POINT_ID, "/state"),
  ).toBeNull();
  expect(fs.existsSync(path.join(workspace.worktreePath, "aux/origin/state/.wh.location.md"))).toBe(
    false,
  );
  expect(fs.existsSync(path.join(workspace.worktreePath, "aux/origin/.wh.state"))).toBe(false);
});

test("timeline point label can be updated", () => {
  const workspace = seedProject("project_timeline_update");
  const point = service.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
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
  ).toThrow("无法修改原点时间点。");
});

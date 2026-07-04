import { expect, test } from "vitest";

import { seedProjectRecord } from "@/test/project";
import { getBranchMapping, getWorkdirForBranch } from "./git-storage/git-store";
import * as service from "./index";

type ExportedAuxNode = Awaited<ReturnType<typeof service.exportAuxSnapshotTree>>["nodes"][number];

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

function flattenAuxNodes(nodes: ExportedAuxNode[]): ExportedAuxNode[] {
  return nodes.flatMap((node) => [node, ...flattenAuxNodes(node.children)]);
}

function expectNoOrphanManuscriptFiles(_workspace: { projectId: string; id: string }) {
  // Data integrity is now maintained internally by writeWorktreeStateToWorkdir
}

test("content export preserves sibling order and nesting", async () => {
  const workspace = await seedProject("project_content");
  const rootId = null;

  const chapter1 = await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: rootId,
    title: "Chapter 1",
  });
  const chapter2 = await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: rootId,
    afterSiblingId: chapter1.id,
    title: "Chapter 2",
  });
  await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: rootId,
    title: "Prologue",
  });
  await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: chapter1.id,
    title: "Scene 1",
    body: "Opening scene",
  });

  const exported = await service.exportContentSubtree(workspace.projectId, workspace.id);
  expect(exported.nodes.map((node) => node.title)).toEqual(["Prologue", "Chapter 1", "Chapter 2"]);
  expect(exported.nodes[1]?.children.map((node) => node.title)).toEqual(["Scene 1"]);
  expect(chapter2.parentId).toBe(rootId);
});

test("aux overlay resolves by timeline point and composeWritingContext follows anchor point", async () => {
  const workspace = await seedProject("project_overlay");
  const contentRootId = null;

  await service.mkdirAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state",
  });
  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state/location.md",
    content: "home",
  });
  const point = await service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "After leave home",
  });
  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/state/location.md",
    content: "park",
  });
  const scene = await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: contentRootId,
    anchorPointId: point.id,
    title: "Arrival",
  });

  expect(
    (
      await service.readAuxByPathAt(
        workspace.projectId,
        workspace.id,
        service.ORIGIN_TIMELINE_POINT_ID,
        "/state/location.md",
      )
    )?.content,
  ).toBe("home");
  expect(
    (
      await service.readAuxByPathAt(
        workspace.projectId,
        workspace.id,
        point.id,
        "/state/location.md",
      )
    )?.content,
  ).toBe("park");

  const context = await service.composeWritingContext(workspace.projectId, workspace.id, scene.id);
  expect(context.timelinePointId).toBe(point.id);
  expect(context.auxSnapshot.find((node) => node.path === "/state/location.md")?.content).toBe(
    "park",
  );
});

test("symlink stores a logical aux path target and does not follow target moves", async () => {
  const workspace = await seedProject("project_symlink");

  await service.mkdirAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/places",
  });
  await service.mkdirAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/places/home",
  });
  await service.mkdirAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/places/home/bathroom",
  });
  await service.linkAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/current_location",
    targetPath: "/places/home/bathroom",
  });

  const point = await service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "After move",
  });
  await service.mkdirAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/places/villa",
  });
  await service.moveAuxNodeAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/places/home/bathroom",
    newPath: "/places/villa/main_bathroom",
  });

  const resolved = await service.readAuxByPathAt(
    workspace.projectId,
    workspace.id,
    point.id,
    "/current_location",
  );
  expect(resolved?.nodeType).toBe("symlink");
  expect(resolved?.path).toBe("/current_location");
  expect(resolved?.symlinkTargetPath).toBe("/places/home/bathroom");

  const exported = await service.exportAuxSnapshotTree(workspace.projectId, workspace.id, point.id);
  expect(exported.timelinePointId).toBe(point.id);
  expect(exported.nodes.map((node) => node.name)).toEqual(["current_location", "places"]);
  expect(exported.nodes.find((node) => node.name === "current_location")?.symlinkTargetPath).toBe(
    "/places/home/bathroom",
  );
  expect(
    exported.nodes.find((node) => node.name === "places")?.children.map((node) => node.name),
  ).toEqual(["home", "villa"]);
});

test("moving an inherited aux file across directories writes the whiteout at the source path", async () => {
  const workspace = await seedProject("project_aux_move_inherited_whiteout_path");

  await service.mkdirAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/设定",
  });
  await service.mkdirAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/资料库",
  });
  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/设定/角色.md",
    content: "主角设定",
  });
  const point = await service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "move inherited file",
  });

  await service.moveAuxNodeAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/设定/角色.md",
    newPath: "/资料库/角色.md",
  });

  const wd = wdFor(workspace);
  expect(wd?.exists(`aux/timeline/${point.id}/设定/.wh.角色.md`) ?? false).toBe(true);
  expect(wd?.exists(`aux/timeline/${point.id}/资料库/.wh.角色.md`) ?? false).toBe(false);
  expect(wd?.exists(`aux/timeline/${point.id}/资料库/角色.md`) ?? false).toBe(true);
  expect(
    await service.readAuxByPathAt(workspace.projectId, workspace.id, point.id, "/设定/角色.md"),
  ).toBeNull();
  expect(
    (await service.readAuxByPathAt(workspace.projectId, workspace.id, point.id, "/资料库/角色.md"))
      ?.content,
  ).toBe("主角设定");
});

test("retargetAuxSymlinkAt updates the exported symlink target path", async () => {
  const workspace = await seedProject("project_symlink_retarget");

  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/old.md",
    content: "old",
  });
  await service.mkdirAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state",
  });
  await service.linkAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/current",
    targetPath: "/old.md",
  });

  await service.retargetAuxSymlinkAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/current",
    targetPath: "/state",
  });

  const exported = await service.exportAuxSnapshotTree(workspace.projectId, workspace.id);
  expect(exported.nodes.find((node) => node.path === "/current")?.symlinkTargetPath).toBe("/state");
  expect(
    (
      await service.readAuxByPathAt(
        workspace.projectId,
        workspace.id,
        service.ORIGIN_TIMELINE_POINT_ID,
        "/current",
      )
    )?.path,
  ).toBe("/current");
});

test("retargetAuxSymlinkAt can point to another symlink node", async () => {
  const workspace = await seedProject("project_symlink_retarget_symlink");

  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/notes.md",
    content: "notes",
  });
  await service.linkAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/target_link",
    targetPath: "/notes.md",
  });
  await service.linkAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/source_link",
    targetPath: "/notes.md",
  });

  await service.retargetAuxSymlinkAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/source_link",
    targetPath: "/target_link",
  });

  const exported = await service.exportAuxSnapshotTree(workspace.projectId, workspace.id);
  expect(exported.nodes.find((node) => node.path === "/source_link")?.symlinkTargetPath).toBe(
    "/target_link",
  );
  expect(
    (
      await service.readAuxByPathAt(
        workspace.projectId,
        workspace.id,
        service.ORIGIN_TIMELINE_POINT_ID,
        "/source_link",
      )
    )?.path,
  ).toBe("/source_link");
});

test("retargetAuxSymlinkAt records self and indirect symlink targets", async () => {
  const workspace = await seedProject("project_symlink_retarget_cycle");

  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/notes.md",
    content: "notes",
  });
  await service.linkAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/source_link",
    targetPath: "/notes.md",
  });
  await service.linkAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/loop_b",
    targetPath: "/source_link",
  });
  await service.linkAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/loop_a",
    targetPath: "/loop_b",
  });

  await service.retargetAuxSymlinkAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/source_link",
    targetPath: "/source_link",
  });
  expect(
    (await service.exportAuxSnapshotTree(workspace.projectId, workspace.id)).nodes.find(
      (node) => node.path === "/source_link",
    )?.symlinkTargetPath,
  ).toBe("/source_link");

  await service.retargetAuxSymlinkAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/source_link",
    targetPath: "/loop_a",
  });
  expect(
    (await service.exportAuxSnapshotTree(workspace.projectId, workspace.id)).nodes.find(
      (node) => node.path === "/source_link",
    )?.symlinkTargetPath,
  ).toBe("/loop_a");
});

test("retargetAuxSymlinkAt rejects non-symlink sources", async () => {
  const workspace = await seedProject("project_symlink_retarget_non_symlink");

  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/notes.md",
    content: "notes",
  });
  await service.mkdirAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state",
  });

  expect(
    async () =>
      await service.retargetAuxSymlinkAt({
        projectId: workspace.projectId,
        workspaceId: workspace.id,
        timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
        path: "/notes.md",
        targetPath: "/state",
      }),
  ).toThrow("当前辅助信息不是链接。");
});

test("aux node names must stay unique within the same parent", async () => {
  const workspace = await seedProject("project_aux_unique_names");

  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/notes.md",
    content: "notes",
  });
  await service.mkdirAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state",
  });

  expect(
    async () =>
      await service.moveAuxNodeAt({
        projectId: workspace.projectId,
        workspaceId: workspace.id,
        timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
        path: "/state",
        newPath: "/notes.md",
      }),
  ).toThrow("同路径辅助信息已存在。");

  const spacedDir = await service.mkdirAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/ notes.md ",
  });
  expect(spacedDir.path).toBe("/ notes.md");

  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/notes.md",
    content: "updated",
  });
  expect(
    (
      await service.readAuxByPathAt(
        workspace.projectId,
        workspace.id,
        service.ORIGIN_TIMELINE_POINT_ID,
        "/notes.md",
      )
    )?.content,
  ).toBe("updated");

  expect(
    async () =>
      await service.linkAt({
        projectId: workspace.projectId,
        workspaceId: workspace.id,
        timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
        path: "/notes.md",
        targetPath: "/notes.md",
      }),
  ).toThrow("同路径辅助信息已存在。");

  expect(
    (await service.exportAuxSnapshotTree(workspace.projectId, workspace.id)).nodes.map(
      (node) => node.path,
    ),
  ).toEqual(["/ notes.md", "/notes.md", "/state"]);
});

test("origin aux creation can coexist with descendant timeline names", async () => {
  const workspace = await seedProject("project_aux_origin_descendant_duplicate");
  const point = await service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "Point 1",
  });

  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/新文件 1",
    content: "point file",
  });

  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/新文件 1",
    content: "origin file",
  });

  expect(
    (await service.exportAuxSnapshotTree(workspace.projectId, workspace.id, point.id)).nodes.map(
      (node) => node.path,
    ),
  ).toEqual(["/新文件 1"]);
  expect(
    (await service.readAuxByPathAt(workspace.projectId, workspace.id, point.id, "/新文件 1"))
      ?.content,
  ).toBe("point file");
});

test("aux snapshot sorts top-level nodes by path", async () => {
  const workspace = await seedProject("project_aux_natural_sort");

  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/文件10",
    content: "",
  });
  await service.mkdirAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/目录十",
  });
  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/文件2",
    content: "",
  });
  await service.mkdirAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/目录二",
  });
  await service.linkAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/文件１ - 链接",
    targetPath: "/目录十",
  });

  expect(
    (await service.exportAuxSnapshotTree(workspace.projectId, workspace.id)).nodes.map(
      (node) => node.path,
    ),
  ).toEqual(["/文件１ - 链接", "/文件10", "/文件2", "/目录二", "/目录十"]);
});

test("aux snapshot shows current timeline deleted file tombstones", async () => {
  const workspace = await seedProject("project_aux_deleted_ghost_natural_sort");

  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/文件10",
    content: "",
  });
  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/文件2",
    content: "",
  });

  const point = await service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "After delete file 10",
  });
  await service.deleteAuxNodeAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/文件10",
  });
  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/文件1",
    content: "",
  });

  const snapshot = await service.exportAuxSnapshotTree(workspace.projectId, workspace.id, point.id);
  const statusByPath = new Map(snapshot.nodes.map((node) => [node.path, node.overlayStatus]));

  expect(statusByPath.get("/文件1")).toBe("visible");
  expect(statusByPath.get("/文件10")).toBe("deleted");
  expect(statusByPath.get("/文件2")).toBe("visible");
});

test("aux snapshot marks visible nodes with layers at the active timeline point", async () => {
  const workspace = await seedProject("project_aux_snapshot_changes");

  await service.mkdirAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state",
  });
  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state/location.md",
    content: "home",
  });
  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state/character.md",
    content: "calm",
  });

  const originSnapshot = await service.exportAuxSnapshotTree(
    workspace.projectId,
    workspace.id,
    service.ORIGIN_TIMELINE_POINT_ID,
  );
  expect(flattenAuxNodes(originSnapshot.nodes).every((node) => !node.hasTimelineChange)).toBe(true);

  const point = await service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "After departure",
  });
  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/state/location.md",
    content: "home",
  });
  await service.mkdirAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/delta-only",
  });
  await service.moveAuxNodeAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/state/character.md",
    newPath: "/cast.md",
  });

  const pointSnapshot = await service.exportAuxSnapshotTree(
    workspace.projectId,
    workspace.id,
    point.id,
  );
  const changesByPath = new Map(
    flattenAuxNodes(pointSnapshot.nodes).map((node) => [node.path, node.hasTimelineChange]),
  );

  expect(changesByPath.get("/state")).toBe(false);
  expect(changesByPath.get("/state/location.md")).toBe(true);
  expect(changesByPath.get("/delta-only")).toBe(true);
  expect(changesByPath.get("/cast.md")).toBe(true);
});

test("aux snapshot marks inherited earlier timeline nodes as unchanged at the current point", async () => {
  const workspace = await seedProject("project_aux_snapshot_inherited_layer_flags");

  const firstPoint = await service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "First point",
  });
  await service.mkdirAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: firstPoint.id,
    path: "/state",
  });
  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: firstPoint.id,
    path: "/state/location.md",
    content: "home",
  });

  const secondPoint = await service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: firstPoint.id,
    label: "Second point",
  });
  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: secondPoint.id,
    path: "/notes.md",
    content: "delta",
  });

  const snapshot = await service.exportAuxSnapshotTree(
    workspace.projectId,
    workspace.id,
    secondPoint.id,
  );
  const changesByPath = new Map(
    flattenAuxNodes(snapshot.nodes).map((node) => [node.path, node.hasTimelineChange]),
  );

  expect(changesByPath.get("/state")).toBe(false);
  expect(changesByPath.get("/state/location.md")).toBe(false);
  expect(changesByPath.get("/notes.md")).toBe(true);
});

test("aux snapshot shows deleted folder tombstones without descendants", async () => {
  const workspace = await seedProject("project_aux_deleted_ghosts");

  await service.mkdirAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state",
  });
  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state/location.md",
    content: "home",
  });

  const point = await service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "After delete state",
  });
  await service.deleteAuxNodeAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/state",
  });

  const snapshot = await service.exportAuxSnapshotTree(workspace.projectId, workspace.id, point.id);
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

test("whiteout deletion can be overridden by rewriting the same path", async () => {
  const workspace = await seedProject("project_aux_whiteout_recreate");

  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/notes.md",
    content: "origin",
  });
  const point = await service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "After delete notes",
  });
  await service.deleteAuxNodeAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/notes.md",
  });
  expect(
    await service.readAuxByPathAt(workspace.projectId, workspace.id, point.id, "/notes.md"),
  ).toBeNull();

  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/notes.md",
    content: "replacement",
  });

  expect(
    (await service.readAuxByPathAt(workspace.projectId, workspace.id, point.id, "/notes.md"))
      ?.content,
  ).toBe("replacement");
});

test("aux snapshot exposes current timeline whiteouts as deleted rows", async () => {
  const workspace = await seedProject("project_aux_whiteout_deleted_rows");
  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/notes.md",
    content: "origin",
  });
  const point = await service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "After delete notes",
  });

  await service.deleteAuxNodeAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/notes.md",
  });

  const snapshot = await service.exportAuxSnapshotTree(workspace.projectId, workspace.id, point.id);
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
  expect((await service.exportAuxSnapshotTree(workspace.projectId, workspace.id)).nodes).toEqual([
    expect.objectContaining({
      path: "/notes.md",
      overlayStatus: "visible",
    }),
  ]);
});

test("aux snapshot does not expose origin or upper-only deletes as deleted rows", async () => {
  const workspace = await seedProject("project_aux_whiteout_deleted_rows_scope");
  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/origin.md",
    content: "origin",
  });
  await service.deleteAuxNodeAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/origin.md",
  });
  expect((await service.exportAuxSnapshotTree(workspace.projectId, workspace.id)).nodes).toEqual(
    [],
  );

  const point = await service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "Draft",
  });
  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/draft.md",
    content: "draft",
  });
  await service.deleteAuxNodeAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/draft.md",
  });

  expect(
    (await service.exportAuxSnapshotTree(workspace.projectId, workspace.id, point.id)).nodes,
  ).toEqual([]);
});

test("restoreDeletedAuxNodeAt removes the current whiteout and restores lower folders", async () => {
  const workspace = await seedProject("project_aux_whiteout_restore");
  await service.mkdirAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state",
  });
  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state/location.md",
    content: "home",
  });
  const point = await service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "After delete state",
  });
  await service.deleteAuxNodeAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/state",
  });

  let snapshot = await service.exportAuxSnapshotTree(workspace.projectId, workspace.id, point.id);
  expect(snapshot.nodes).toEqual([
    expect.objectContaining({
      path: "/state",
      nodeType: "dir",
      overlayStatus: "deleted",
      children: [],
    }),
  ]);

  await service.restoreDeletedAuxNodeAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/state",
  });

  snapshot = await service.exportAuxSnapshotTree(workspace.projectId, workspace.id, point.id);
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
  const wd = wdFor(workspace);
  expect(wd?.exists(`aux/timeline/${point.id}/.wh.state`) ?? false).toBe(false);
});

test("restoreDeletedAuxNodeAt rejects origin and missing whiteouts", async () => {
  const workspace = await seedProject("project_aux_whiteout_restore_rejects");
  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/notes.md",
    content: "origin",
  });
  const point = await service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "Draft",
  });

  expect(
    async () =>
      await service.restoreDeletedAuxNodeAt({
        projectId: workspace.projectId,
        workspaceId: workspace.id,
        timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
        path: "/notes.md",
      }),
  ).toThrow();
  expect(
    async () =>
      await service.restoreDeletedAuxNodeAt({
        projectId: workspace.projectId,
        workspaceId: workspace.id,
        timelinePointId: point.id,
        path: "/notes.md",
      }),
  ).toThrow();
});

test("content node deletion removes subtree and preserves sibling order", async () => {
  const workspace = await seedProject("project_content_delete");
  const rootId = null;

  const chapter1 = await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: rootId,
    title: "Chapter 1",
  });
  await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: rootId,
    afterSiblingId: chapter1.id,
    title: "Chapter 2",
  });
  await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: chapter1.id,
    title: "Scene 1",
  });

  await service.deleteContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    nodeId: chapter1.id,
  });

  const exported = await service.exportContentSubtree(workspace.projectId, workspace.id);
  expect(exported.nodes.map((node) => node.title)).toEqual(["Chapter 2"]);
});

test("deleting a middle content sibling rewires next sibling without violating uniqueness", async () => {
  const workspace = await seedProject("project_content_delete_middle");
  const rootId = null;

  const chapter1 = await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: rootId,
    title: "Chapter 1",
  });
  const chapter2 = await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: rootId,
    afterSiblingId: chapter1.id,
    title: "Chapter 2",
  });
  await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: rootId,
    afterSiblingId: chapter2.id,
    title: "Chapter 3",
  });

  expect(
    async () =>
      await service.deleteContentNode({
        projectId: workspace.projectId,
        workspaceId: workspace.id,
        nodeId: chapter2.id,
      }),
  ).not.toThrow();

  const exported = await service.exportContentSubtree(workspace.projectId, workspace.id);
  expect(exported.nodes.map((node) => node.title)).toEqual(["Chapter 1", "Chapter 3"]);
});

test("content node move can reorder across parents and preserve child order", async () => {
  const workspace = await seedProject("project_content_move_cross_parent");
  const rootId = null;

  const chapter1 = await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: rootId,
    title: "Chapter 1",
  });
  const chapter2 = await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: rootId,
    afterSiblingId: chapter1.id,
    title: "Chapter 2",
  });
  const scene1 = await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: chapter1.id,
    title: "Scene 1",
  });
  await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: chapter1.id,
    afterSiblingId: scene1.id,
    title: "Scene 2",
  });

  await service.moveContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    nodeId: scene1.id,
    newParentId: chapter2.id,
  });

  const exported = await service.exportContentSubtree(workspace.projectId, workspace.id);
  expect(exported.nodes.map((node) => node.title)).toEqual(["Chapter 1", "Chapter 2"]);
  expect(exported.nodes[0]?.children.map((node) => node.title)).toEqual(["Scene 2"]);
  expect(exported.nodes[1]?.children.map((node) => node.title)).toEqual(["Scene 1"]);

  await service.moveContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    nodeId: chapter2.id,
    newParentId: rootId,
  });

  expect(
    (await service.exportContentSubtree(workspace.projectId, workspace.id)).nodes.map(
      (node) => node.title,
    ),
  ).toEqual(["Chapter 2", "Chapter 1"]);
});

test("content node move can lift a nested child to the top level and remain reloadable", async () => {
  const workspace = await seedProject("project_content_move_child_to_top");

  const parent = await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    title: "Parent",
  });
  const child = await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: parent.id,
    title: "Child",
    body: "hello",
  });

  expect(
    async () =>
      await service.moveContentNode({
        projectId: workspace.projectId,
        workspaceId: workspace.id,
        nodeId: child.id,
        newParentId: null,
        afterSiblingId: parent.id,
      }),
  ).not.toThrow();

  const exported = await service.exportContentSubtree(workspace.projectId, workspace.id);
  expect(exported.nodes.map((node) => node.title)).toEqual(["Parent", "Child"]);
  expect(exported.nodes[0]?.children).toEqual([]);
  expect(exported.nodes[1]).toMatchObject({
    id: child.id,
    title: "Child",
    body: "hello",
    children: [],
  });
});

test("content node move rejects moving a node below its own descendant", async () => {
  const workspace = await seedProject("project_content_move_into_descendant");
  const rootId = null;

  const chapter = await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: rootId,
    title: "Chapter",
  });
  const scene = await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: chapter.id,
    title: "Scene",
  });

  expect(
    async () =>
      await service.moveContentNode({
        projectId: workspace.projectId,
        workspaceId: workspace.id,
        nodeId: chapter.id,
        newParentId: scene.id,
      }),
  ).toThrow("无法移动：不能把章节移动到自己的子章节下。");
});

test("content node move rejects invalid targets without corrupting persisted tree", async () => {
  const workspace = await seedProject("project_content_move_invalid_target_clean");

  const chapter1 = await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    title: "Chapter 1",
    body: "one",
  });
  const chapter2 = await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    afterSiblingId: chapter1.id,
    title: "Chapter 2",
    body: "two",
  });
  const scene = await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: chapter1.id,
    title: "Scene",
    body: "scene",
  });
  const before = await service.exportContentSubtree(workspace.projectId, workspace.id);
  expect(
    async () =>
      await service.moveContentNode({
        projectId: workspace.projectId,
        workspaceId: workspace.id,
        nodeId: scene.id,
        newParentId: chapter2.id,
        afterSiblingId: chapter1.id,
      }),
  ).toThrow("无法移动章节：目标位置不在同一个父级下。");

  expect(await service.exportContentSubtree(workspace.projectId, workspace.id)).toEqual(before);
  expectNoOrphanManuscriptFiles(workspace);
});

test("content node move rejects self-referential positions without detaching directories", async () => {
  const workspace = await seedProject("project_content_move_self_target_clean");

  const chapter = await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    title: "Chapter",
  });
  await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: chapter.id,
    title: "Scene",
  });
  const before = await service.exportContentSubtree(workspace.projectId, workspace.id);

  expect(
    async () =>
      await service.moveContentNode({
        projectId: workspace.projectId,
        workspaceId: workspace.id,
        nodeId: chapter.id,
        newParentId: chapter.id,
      }),
  ).toThrow("无法移动：不能把章节移动到自己的子章节下。");
  expect(
    async () =>
      await service.moveContentNode({
        projectId: workspace.projectId,
        workspaceId: workspace.id,
        nodeId: chapter.id,
        newParentId: null,
        afterSiblingId: chapter.id,
      }),
  ).toThrow("无法移动：目标位置不能是章节自身。");

  expect(await service.exportContentSubtree(workspace.projectId, workspace.id)).toEqual(before);
  expectNoOrphanManuscriptFiles(workspace);
});

test("content node creation rejects foreign after-sibling without writing partial nodes", async () => {
  const workspace = await seedProject("project_content_create_invalid_sibling_clean");

  const chapter = await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    title: "Chapter",
  });
  const scene = await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: chapter.id,
    title: "Scene",
  });
  const before = await service.exportContentSubtree(workspace.projectId, workspace.id);

  expect(
    async () =>
      await service.createContentNode({
        projectId: workspace.projectId,
        workspaceId: workspace.id,
        parentId: null,
        afterSiblingId: scene.id,
        title: "Should not persist",
        body: "partial",
      }),
  ).toThrow("无法创建章节：目标位置不在同一个父级下。");

  expect(await service.exportContentSubtree(workspace.projectId, workspace.id)).toEqual(before);
  expectNoOrphanManuscriptFiles(workspace);
});

test("content body updates preserve front matter delimiters and normalize newlines", async () => {
  const workspace = await seedProject("project_content_body_roundtrip");
  const point = await service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "Draft",
  });
  const body = "---\nnot front matter inside body\n---\r\nLine 1\r\nLine 2\n";

  const chapter = await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: null,
    title: "Original",
    body,
  });

  await service.updateContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    nodeId: chapter.id,
    title: "",
    anchorPointId: point.id,
    body,
  });

  const exported = (await service.exportContentSubtree(workspace.projectId, workspace.id)).nodes[0];
  expect(exported).toMatchObject({
    id: chapter.id,
    title: null,
    anchorTimelinePointId: point.id,
    body: "---\nnot front matter inside body\n---\nLine 1\nLine 2\n",
  });
  expect(
    (await service.readManuscriptNode(workspace.projectId, workspace.id, chapter.id)).body,
  ).toBe("---\nnot front matter inside body\n---\nLine 1\nLine 2\n");
});

test("content node anchor point can be updated", async () => {
  const workspace = await seedProject("project_anchor_update");
  const contentRootId = null;

  const pointA = await service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "Point A",
  });
  const pointB = await service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: pointA.id,
    label: "Point B",
  });
  const scene = await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: contentRootId,
    anchorPointId: pointA.id,
    title: "Scene",
  });

  await service.updateContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    nodeId: scene.id,
    anchorPointId: pointB.id,
  });

  const exported = await service.exportContentSubtree(workspace.projectId, workspace.id);
  expect(exported.nodes[0]?.anchorTimelinePointId).toBe(pointB.id);
});

test("timeline point deletion is blocked when content still anchors to it", async () => {
  const workspace = await seedProject("project_guard");
  const contentRootId = null;
  const point = await service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "Occupied point",
  });

  await service.createContentNode({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    parentId: contentRootId,
    anchorPointId: point.id,
    title: "Guarded",
  });

  expect(
    async () => await service.deleteTimelinePoint(workspace.projectId, workspace.id, point.id),
  ).toThrow("无法删除：仍有章节锚定到该时间点。");
});

test("listAuxChangesAt only returns layer changes at the requested timeline point", async () => {
  const workspace = await seedProject("project_aux_changes");

  await service.mkdirAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state",
  });
  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state/location.md",
    content: "home",
  });
  const point = await service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "Overlay point",
  });
  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/state/location.md",
    content: "park",
  });
  await service.mkdirAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/delta-only",
  });

  expect(await service.listAuxChangesAt(workspace.projectId, workspace.id, point.id)).toEqual([
    { path: "/delta-only", isDeleted: false },
    { path: "/state/location.md", isDeleted: false },
  ]);
});

test("listAuxTimelineChangesAt compares a timeline point against its predecessor", async () => {
  const workspace = await seedProject("project_aux_timeline_diff");

  await service.mkdirAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state",
  });
  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state/location.md",
    content: "home",
  });
  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state/backup.md",
    content: "backup",
  });
  await service.linkAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/current_location",
    targetPath: "/state/location.md",
  });
  const pointA = await service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "离家后",
  });
  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: pointA.id,
    path: "/delta-only.md",
    content: "delta",
  });
  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: pointA.id,
    path: "/state/location.md",
    content: "park",
  });
  const pointB = await service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: pointA.id,
    label: "折返前",
  });
  await service.deleteAuxNodeAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: pointB.id,
    path: "/delta-only.md",
  });
  await service.retargetAuxSymlinkAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: pointB.id,
    path: "/current_location",
    targetPath: "/state/backup.md",
  });

  expect(
    await service.summarizeAuxTimelineChangesAt(workspace.projectId, workspace.id, pointA.id),
  ).toEqual({
    hasChanges: true,
    added: 1,
    modified: 1,
    deleted: 0,
    total: 2,
  });
  expect(
    await service.listAuxTimelineChangesAt(workspace.projectId, workspace.id, pointB.id),
  ).toEqual([
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

test("timeline point deletion is blocked when auxiliary layers exist without purge", async () => {
  const workspace = await seedProject("project_aux_guard");
  const point = await service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "Aux point",
  });

  await service.mkdirAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/notes",
  });

  expect(
    async () => await service.deleteTimelinePoint(workspace.projectId, workspace.id, point.id),
  ).toThrow("无法删除：该时间点仍有辅助信息变更。");
});

test("timeline point deletion purges auxiliary overlay directory when requested", async () => {
  const workspace = await seedProject("project_aux_purge");
  const point = await service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "Purge point",
  });

  await service.mkdirAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/notes",
  });

  await service.deleteTimelinePoint(workspace.projectId, workspace.id, point.id, {
    purgeAuxLayers: true,
  });

  expect(
    (await service.listTimelinePoints(workspace.projectId, workspace.id)).some(
      (item) => item.id === point.id,
    ),
  ).toBe(false);
  expect(wdFor(workspace)?.exists(`aux/timeline/${point.id}`) ?? false).toBe(false);
});

test("timeline point insertion at origin rewires the previous head", async () => {
  const workspace = await seedProject("project_timeline_insert_origin");
  const pointA = await service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "Point A",
  });

  const pointB = await service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "Point B",
  });

  const ordered = await service.listTimelinePoints(workspace.projectId, workspace.id);
  expect(ordered.map((point) => point.id)).toEqual([
    service.ORIGIN_TIMELINE_POINT_ID,
    pointB.id,
    pointA.id,
  ]);
});

test("timeline point batch insertion preserves order without requiring intermediate ids", async () => {
  const workspace = await seedProject("project_timeline_insert_batch");
  const pointA = await service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "Point A",
  });

  const created = await service.createTimelinePoints({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    points: [{ label: "Point B" }, { label: "Point C" }, { label: "Point D" }],
  });

  const ordered = await service.listTimelinePoints(workspace.projectId, workspace.id);
  expect(created.map((point) => point.label)).toEqual(["Point B", "Point C", "Point D"]);
  expect(ordered.map((point) => point.id)).toEqual([
    service.ORIGIN_TIMELINE_POINT_ID,
    created[0]!.id,
    created[1]!.id,
    created[2]!.id,
    pointA.id,
  ]);
});

test("timeline point move rewires both source and target segments", async () => {
  const workspace = await seedProject("project_timeline_move");
  const pointA = await service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "Point A",
  });
  const pointB = await service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: pointA.id,
    label: "Point B",
  });
  const pointC = await service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: pointB.id,
    label: "Point C",
  });
  const pointD = await service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: pointC.id,
    label: "Point D",
  });

  await service.moveTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    pointId: pointC.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
  });

  let ordered = await service.listTimelinePoints(workspace.projectId, workspace.id);
  expect(ordered.map((point) => point.id)).toEqual([
    service.ORIGIN_TIMELINE_POINT_ID,
    pointC.id,
    pointA.id,
    pointB.id,
    pointD.id,
  ]);

  await service.moveTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    pointId: pointA.id,
    afterPointId: pointD.id,
  });

  ordered = await service.listTimelinePoints(workspace.projectId, workspace.id);
  expect(ordered.map((point) => point.id)).toEqual([
    service.ORIGIN_TIMELINE_POINT_ID,
    pointC.id,
    pointB.id,
    pointD.id,
    pointA.id,
  ]);
});

test("deleteAuxNodeAt physically removes origin aux nodes without whiteouts", async () => {
  const workspace = await seedProject("project_aux_gc_delete");

  await service.mkdirAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/notes",
  });
  const wd1655 = wdFor(workspace);
  wd1655?.mkdir("aux/origin", { recursive: true });
  wd1655?.writeFile("aux/origin/.wh.orphan", Buffer.from(""));

  await service.deleteAuxNodeAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/notes",
  });

  expect(
    await service.readAuxByPathAt(
      workspace.projectId,
      workspace.id,
      service.ORIGIN_TIMELINE_POINT_ID,
      "/notes",
    ),
  ).toBeNull();
  const wd1670 = wdFor(workspace);
  expect(wd1670?.exists("aux/origin/notes") ?? false).toBe(false);
  expect(wd1670?.exists("aux/origin/.wh.notes") ?? false).toBe(false);
});

test("deleteAuxNodeAt keeps timeline whiteouts only when hiding lower nodes", async () => {
  const workspace = await seedProject("project_aux_gc_timeline_whiteout");

  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/origin.md",
    content: "origin",
  });
  const point = await service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "Draft",
  });
  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/draft.md",
    content: "draft",
  });

  await service.deleteAuxNodeAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/draft.md",
  });
  await service.deleteAuxNodeAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/origin.md",
  });

  const wd1715 = wdFor(workspace);
  // draft.md was written at the timeline layer and then deleted
  // — should be removed (no file, no whiteout needed for own-layer files)
  expect(wd1715?.exists(`aux/timeline/${point.id}/draft.md`) ?? false).toBe(false);
  expect(wd1715?.exists(`aux/timeline/${point.id}/.wh.draft.md`) ?? false).toBe(false);
  // origin.md was written at origin layer, deletion at timeline layer requires whiteout
  expect(wd1715?.exists(`aux/timeline/${point.id}/.wh.origin.md`) ?? false).toBe(true);
});

test("deleting an aux parent hides its descendants", async () => {
  const workspace = await seedProject("project_aux_gc_parent_guard");

  await service.mkdirAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state",
  });
  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state/location.md",
    content: "home",
  });

  await service.deleteAuxNodeAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state",
  });

  expect(
    await service.readAuxByPathAt(
      workspace.projectId,
      workspace.id,
      service.ORIGIN_TIMELINE_POINT_ID,
      "/state",
    ),
  ).toBeNull();
  expect(
    await service.readAuxByPathAt(
      workspace.projectId,
      workspace.id,
      service.ORIGIN_TIMELINE_POINT_ID,
      "/state/location.md",
    ),
  ).toBeNull();
});

test("deleting an aux symlink leaves its target visible", async () => {
  const workspace = await seedProject("project_aux_gc_symlink_guard");

  await service.mkdirAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/places",
  });
  await service.linkAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/current",
    targetPath: "/places",
  });

  await service.deleteAuxNodeAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/current",
  });

  expect(
    await service.readAuxByPathAt(
      workspace.projectId,
      workspace.id,
      service.ORIGIN_TIMELINE_POINT_ID,
      "/places",
    ),
  ).not.toBeNull();
  expect(
    await service.readAuxByPathAt(
      workspace.projectId,
      workspace.id,
      service.ORIGIN_TIMELINE_POINT_ID,
      "/current",
    ),
  ).toBeNull();
});

test("deleted aux subtree nodes are hidden and whiteouts are path-based", async () => {
  const workspace = await seedProject("project_aux_gc_subtree");

  await service.mkdirAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state",
  });
  await service.writeFileAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state/location.md",
    content: "home",
  });

  await service.deleteAuxNodeAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state/location.md",
  });
  await service.deleteAuxNodeAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: service.ORIGIN_TIMELINE_POINT_ID,
    path: "/state",
  });

  expect(
    await service.readAuxByPathAt(
      workspace.projectId,
      workspace.id,
      service.ORIGIN_TIMELINE_POINT_ID,
      "/state/location.md",
    ),
  ).toBeNull();
  expect(
    await service.readAuxByPathAt(
      workspace.projectId,
      workspace.id,
      service.ORIGIN_TIMELINE_POINT_ID,
      "/state",
    ),
  ).toBeNull();
  const wd1850 = wdFor(workspace);
  expect(wd1850?.exists("aux/origin/state/.wh.location.md") ?? false).toBe(false);
  expect(wd1850?.exists("aux/origin/.wh.state") ?? false).toBe(false);
});

test("timeline point label can be updated", async () => {
  const workspace = await seedProject("project_timeline_update");
  const point = await service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "Before update",
  });

  await service.updateTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    pointId: point.id,
    label: "After update",
  });

  const points = await service.listTimelinePoints(workspace.projectId, workspace.id);
  const updated = points.find((entry) => entry.id === point.id);
  expect(updated?.label).toBe("After update");
});

test("creating a timeline point recovers when manuscript path was accidentally stored as a file", async () => {
  const workspace = await seedProject("project_timeline_recovers_manuscript_dir");
  const wd = wdFor(workspace);
  expect(wd).toBeDefined();

  wd!.delete("manuscript", { force: true });
  wd!.writeFile("manuscript", Buffer.from("broken", "utf8"));

  const point = await service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "Recovered",
  });

  expect(point.label).toBe("Recovered");
  expect(wd!.stat("manuscript")?.kind).toBe("tree");
  expect(await service.listTimelinePoints(workspace.projectId, workspace.id)).toContainEqual(
    expect.objectContaining({ id: point.id, label: "Recovered" }),
  );
});

test("implicit origin timeline point cannot be updated", async () => {
  const workspace = await seedProject("project_timeline_origin_guard");

  expect(
    async () =>
      await service.updateTimelinePoint({
        projectId: workspace.projectId,
        workspaceId: workspace.id,
        pointId: service.ORIGIN_TIMELINE_POINT_ID,
        label: "Forbidden",
      }),
  ).toThrow("无法修改原点时间点。");
});

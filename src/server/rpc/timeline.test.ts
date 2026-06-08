import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, expect, test } from "bun:test";

const tempDir = mkdtempSync(join(tmpdir(), "novel-evolver-rpc-"));
const dbPath = join(tempDir, "timeline-rpc-test.sqlite");
process.env.DATABASE_URL = dbPath;

const { db, schema } = await import("../../db");
const service = await import("../../domain");
const auxHandlers = await import("./aux");
const timelineHandlers = await import("./timeline");

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

test("aux snapshot tree watches the active point snapshot key instead of workspace timeline", async () => {
  const workspace = seedProject("rpc_aux_snapshot_watch");
  const point = service.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    key: "point_a",
    label: "Point A",
  });

  const result = await auxHandlers.snapshotTree.handler({
    workspaceId: workspace.id,
    pointId: point.id,
  });

  expect(result.watch).toEqual([`aux:${workspace.id}`, `aux-snapshot:${workspace.id}:${point.id}`]);
});

test("timeline label updates do not invalidate aux snapshots", async () => {
  const workspace = seedProject("rpc_timeline_update");
  const point = service.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    key: "point_a",
    label: "Point A",
  });

  const result = await timelineHandlers.update.handler({
    workspaceId: workspace.id,
    pointId: point.id,
    label: "Point A+",
  });

  expect(result.invalidate).toEqual([`timeline:${workspace.id}`]);
});

test("deleting an unrelated later point only invalidates that point snapshot", async () => {
  const workspace = seedProject("rpc_timeline_delete");
  const pointA = service.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    key: "point_a",
    label: "Point A",
  });
  const pointB = service.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: pointA.id,
    key: "point_b",
    label: "Point B",
  });

  const result = await timelineHandlers.deleteMutation.handler({
    workspaceId: workspace.id,
    pointId: pointB.id,
  });

  expect(result.invalidate).toEqual([
    `timeline:${workspace.id}`,
    `aux-snapshot:${workspace.id}:${pointB.id}`,
  ]);
});

test("creating a later point only invalidates the new snapshot chain", async () => {
  const workspace = seedProject("rpc_timeline_create");
  const pointA = service.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    key: "point_a",
    label: "Point A",
  });
  const pointB = service.createTimelinePoint({
    workspaceId: workspace.id,
    afterPointId: pointA.id,
    key: "point_b",
    label: "Point B",
  });

  const result = await timelineHandlers.create.handler({
    workspaceId: workspace.id,
    afterPointId: pointB.id,
    key: "point_c",
    label: "Point C",
  });

  expect(result.invalidate).toEqual([
    `timeline:${workspace.id}`,
    `aux-snapshot:${workspace.id}:${result.data.id}`,
  ]);
});

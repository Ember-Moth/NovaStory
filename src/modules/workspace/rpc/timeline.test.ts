import { expect, test } from "bun:test";

import { seedProjectRecord } from "@/test/project";
import * as service from "@/modules/workspace/domain";
import { rpcTags } from "@/rpc/tags";
import * as auxHandlers from "./aux";
import * as timelineHandlers from "./timeline";
const requestCtx = { req: new Request("http://localhost/api/rpc") } as unknown as Parameters<
  typeof auxHandlers.snapshotTree.handler
>[1];

async function seedProject(projectId: string) {
  await seedProjectRecord(projectId);
  if (!(await service.getDefaultWorkspace(projectId))) {
    await service.createDefaultWorkspace(projectId);
  }
  return (await service.getDefaultWorkspace(projectId))!;
}

test("aux snapshot tree watches the active point snapshot key instead of workspace timeline", async () => {
  const workspace = await seedProject("rpc_aux_snapshot_watch");
  const point = await service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "Point A",
  });

  const result = await auxHandlers.snapshotTree.handler(
    {
      projectId: workspace.projectId,
      workspaceId: workspace.id,
      pointId: point.id,
    },
    requestCtx,
  );

  expect(result.watch).toEqual([
    rpcTags.auxWorkspace(workspace.id),
    rpcTags.auxSnapshot(workspace.id, point.id),
  ]);
});

test("timeline label updates do not invalidate aux snapshots", async () => {
  const workspace = await seedProject("rpc_timeline_update");
  const point = await service.createTimelinePoint({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    afterPointId: service.ORIGIN_TIMELINE_POINT_ID,
    label: "Point A",
  });

  const result = await timelineHandlers.update.handler(
    {
      projectId: workspace.projectId,
      workspaceId: workspace.id,
      pointId: point.id,
      label: "Point A+",
    },
    requestCtx,
  );

  expect(result.invalidate).toEqual([rpcTags.timelineList(workspace.id)]);
});

test("deleting a point invalidates the aux workspace cache", async () => {
  const workspace = await seedProject("rpc_timeline_delete");
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

  const result = await timelineHandlers.deleteMutation.handler(
    {
      projectId: workspace.projectId,
      workspaceId: workspace.id,
      pointId: pointB.id,
    },
    requestCtx,
  );

  expect(result.invalidate).toEqual([
    rpcTags.timelineList(workspace.id),
    rpcTags.auxWorkspace(workspace.id),
  ]);
});

test("creating a point invalidates the aux workspace cache", async () => {
  const workspace = await seedProject("rpc_timeline_create");
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

  const result = await timelineHandlers.create.handler(
    {
      projectId: workspace.projectId,
      workspaceId: workspace.id,
      afterPointId: pointB.id,
      label: "Point C",
    },
    requestCtx,
  );

  expect(result.invalidate).toEqual([
    rpcTags.timelineList(workspace.id),
    rpcTags.auxWorkspace(workspace.id),
  ]);
});

test("restoring a deleted aux path invalidates the aux workspace cache", async () => {
  const workspace = await seedProject("rpc_aux_restore_deleted");
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
    label: "Point A",
  });
  await service.deleteAuxNodeAt({
    projectId: workspace.projectId,
    workspaceId: workspace.id,
    timelinePointId: point.id,
    path: "/notes.md",
  });

  const result = await auxHandlers.restoreDeleted.handler(
    {
      projectId: workspace.projectId,
      workspaceId: workspace.id,
      timelinePointId: point.id,
      path: "/notes.md",
    },
    requestCtx,
  );

  expect(result.invalidate).toEqual([rpcTags.auxWorkspace(workspace.id)]);
});

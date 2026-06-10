import { expect, test } from "bun:test";

import { ORIGIN_TIMELINE_POINT_ID } from "@/modules/workspace/domain/constants";

import {
  isQueryRefreshing,
  resolveProjectWorkspaceIdentity,
  selectVisibleAuxSnapshot,
} from "./useProjectWorkspace";

test("isQueryRefreshing only reports visible background refreshes", () => {
  expect(
    isQueryRefreshing(
      {
        isSkipped: false,
        isRefetching: true,
        isStale: false,
        error: null,
      },
      true,
    ),
  ).toBe(true);

  expect(
    isQueryRefreshing(
      {
        isSkipped: false,
        isRefetching: false,
        isStale: true,
        error: null,
      },
      true,
    ),
  ).toBe(true);

  expect(
    isQueryRefreshing(
      {
        isSkipped: true,
        isRefetching: true,
        isStale: true,
        error: null,
      },
      true,
    ),
  ).toBe(false);

  expect(
    isQueryRefreshing(
      {
        isSkipped: false,
        isRefetching: true,
        isStale: false,
        error: new Error("failed"),
      },
      true,
    ),
  ).toBe(false);

  expect(
    isQueryRefreshing(
      {
        isSkipped: false,
        isRefetching: true,
        isStale: false,
        error: null,
      },
      false,
    ),
  ).toBe(false);
});

test("selectVisibleAuxSnapshot only returns snapshots for the current aux root", () => {
  const snapshot = {
    rootNodeId: "aux-root",
    timelinePointId: ORIGIN_TIMELINE_POINT_ID,
    nodes: [],
  };

  expect(selectVisibleAuxSnapshot("aux-root", snapshot)).toBe(snapshot);
  expect(selectVisibleAuxSnapshot("other-root", snapshot)).toBeUndefined();
  expect(selectVisibleAuxSnapshot(null, snapshot)).toBeUndefined();
  expect(selectVisibleAuxSnapshot("aux-root", undefined)).toBeUndefined();
});

test("resolveProjectWorkspaceIdentity rejects workspaces from another project", () => {
  expect(
    resolveProjectWorkspaceIdentity({
      projectId: "project_a",
      requestedWorkspaceId: "workspace_a",
      workspace: {
        id: "workspace_a",
        projectId: "project_b",
        name: "Main",
        isDefault: true,
        contentRootId: "content_root",
        auxRootId: "aux_root",
        createdAt: 1,
        updatedAt: 2,
      },
      isInitialLoading: false,
      queryErrorMessage: null,
    }),
  ).toMatchObject({
    workspaceId: undefined,
    contentRootId: null,
    workspaceAuxRootId: null,
    routeMismatch: "当前工作区不属于这个项目。",
    error: "当前工作区不属于这个项目。",
  });
});

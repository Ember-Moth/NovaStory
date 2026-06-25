import { expect, test } from "bun:test";

import { ORIGIN_TIMELINE_POINT_ID } from "@/modules/workspace/domain/constants";

import {
  isAuxBusy,
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

test("selectVisibleAuxSnapshot only returns root path snapshots", () => {
  const snapshot = {
    rootPath: "/",
    timelinePointId: ORIGIN_TIMELINE_POINT_ID,
    nodes: [],
  };

  expect(selectVisibleAuxSnapshot(snapshot)).toBe(snapshot);
  expect(selectVisibleAuxSnapshot({ ...snapshot, rootPath: "/other" })).toBeUndefined();
  expect(selectVisibleAuxSnapshot(null)).toBeUndefined();
  expect(selectVisibleAuxSnapshot(undefined)).toBeUndefined();
});

test("isAuxBusy treats link mutations as part of aux busy state", () => {
  expect(isAuxBusy([{ isPending: false }, { isPending: false }, { isPending: true }])).toBe(true);

  expect(isAuxBusy([{ isPending: false }, { isPending: false }, { isPending: false }])).toBe(false);
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
        branchName: "branch_a",
      },
      isInitialLoading: false,
      queryErrorMessage: null,
    }),
  ).toMatchObject({
    workspaceId: undefined,
    routeMismatch: "当前工作区不属于这个项目。",
    error: "当前工作区不属于这个项目。",
  });
});

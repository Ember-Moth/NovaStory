import { expect, test } from "bun:test";

import { ORIGIN_TIMELINE_POINT_ID } from "@/modules/workspace/domain/constants";

import { isQueryRefreshing, selectVisibleAuxSnapshot } from "./useProjectWorkspace";

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

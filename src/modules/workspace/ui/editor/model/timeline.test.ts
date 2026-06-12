import { expect, test } from "bun:test";

import { ORIGIN_TIMELINE_POINT_ID } from "@/modules/workspace/domain/constants";

import type { TimelinePointVM } from "./types";
import { resolveTimelineMoveAfterPointId } from "./timeline";

function createTimelinePoint(
  overrides: Partial<TimelinePointVM> & Pick<TimelinePointVM, "id" | "label">,
) {
  const { id, label, ...rest } = overrides;
  return {
    id,
    label,
    description: "",
    isImplicitOrigin: false,
    ...rest,
  } satisfies TimelinePointVM;
}

function createTimelinePoints() {
  return [
    createTimelinePoint({
      id: ORIGIN_TIMELINE_POINT_ID,
      label: "原点",
      isImplicitOrigin: true,
    }),
    createTimelinePoint({ id: "point_a", label: "A" }),
    createTimelinePoint({ id: "point_b", label: "B" }),
    createTimelinePoint({ id: "point_c", label: "C" }),
  ];
}

test("resolveTimelineMoveAfterPointId maps upper-half drops to before the target", () => {
  const points = createTimelinePoints();

  expect(
    resolveTimelineMoveAfterPointId({
      points,
      pointId: "point_c",
      targetId: "point_a",
      position: "before",
    }),
  ).toBe(ORIGIN_TIMELINE_POINT_ID);
});

test("resolveTimelineMoveAfterPointId maps lower-half drops to after the target", () => {
  const points = createTimelinePoints();

  expect(
    resolveTimelineMoveAfterPointId({
      points,
      pointId: "point_a",
      targetId: "point_b",
      position: "after",
    }),
  ).toBe("point_b");
});

test("resolveTimelineMoveAfterPointId always inserts after origin when targeting origin", () => {
  const points = createTimelinePoints();

  expect(
    resolveTimelineMoveAfterPointId({
      points,
      pointId: "point_c",
      targetId: ORIGIN_TIMELINE_POINT_ID,
      position: "before",
    }),
  ).toBe(ORIGIN_TIMELINE_POINT_ID);
});

test("resolveTimelineMoveAfterPointId appends when dropped below the last row", () => {
  const points = createTimelinePoints();

  expect(
    resolveTimelineMoveAfterPointId({
      points,
      pointId: "point_a",
      targetId: null,
      position: "after",
    }),
  ).toBe("point_c");
});

test("resolveTimelineMoveAfterPointId ignores self-drops and no-op placements", () => {
  const points = createTimelinePoints();

  expect(
    resolveTimelineMoveAfterPointId({
      points,
      pointId: "point_b",
      targetId: "point_b",
      position: "before",
    }),
  ).toBeNull();
  expect(
    resolveTimelineMoveAfterPointId({
      points,
      pointId: "point_b",
      targetId: "point_a",
      position: "after",
    }),
  ).toBeNull();
  expect(
    resolveTimelineMoveAfterPointId({
      points,
      pointId: "point_b",
      targetId: "missing",
      position: "after",
    }),
  ).toBeNull();
});

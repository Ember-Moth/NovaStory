import { expect, test } from "vitest";

import { moveArrayItem } from "./array";

test("moveArrayItem reorders items without mutating the source", () => {
  const items = ["origin", "point-a", "point-b", "point-c"];

  expect(moveArrayItem(items, 2, 1)).toEqual(["origin", "point-b", "point-a", "point-c"]);
  expect(items).toEqual(["origin", "point-a", "point-b", "point-c"]);
});

test("moveArrayItem ignores invalid moves", () => {
  const items = ["a", "b"];

  expect(moveArrayItem(items, -1, 1)).toEqual(items);
  expect(moveArrayItem(items, 1, -1)).toEqual(items);
  expect(moveArrayItem(items, 3, 1)).toEqual(items);
});

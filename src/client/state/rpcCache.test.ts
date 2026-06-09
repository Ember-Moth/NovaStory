import { expect, test } from "bun:test";

import {
  insertProjectOptimistically,
  moveArrayItem,
  removeProjectOptimistically,
} from "./rpcCache";

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

test("project list optimistic helpers insert, replace, and remove by id", () => {
  const projects = [
    { id: "old", name: "Old" },
    { id: "replace", name: "Before" },
  ];

  expect(insertProjectOptimistically(projects, { id: "new", name: "New" })).toEqual([
    { id: "new", name: "New" },
    { id: "old", name: "Old" },
    { id: "replace", name: "Before" },
  ]);

  expect(insertProjectOptimistically(projects, { id: "replace", name: "After" })).toEqual([
    { id: "replace", name: "After" },
    { id: "old", name: "Old" },
  ]);

  expect(removeProjectOptimistically(projects, "old")).toEqual([{ id: "replace", name: "Before" }]);
});

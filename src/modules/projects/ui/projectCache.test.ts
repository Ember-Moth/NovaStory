import { expect, test } from "bun:test";

import {
  insertProjectOptimistically,
  removeProjectOptimistically,
  updateProjectOptimistically,
} from "./projectCache";

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

test("project list optimistic helpers update project metadata in place", () => {
  const projects = [
    { id: "one", name: "One", description: null, updatedAt: 1 },
    { id: "two", name: "Two", description: "Before", updatedAt: 2 },
  ];

  expect(
    updateProjectOptimistically(projects, { id: "two", name: "Two+", description: "After" }, 99),
  ).toEqual([
    { id: "one", name: "One", description: null, updatedAt: 1 },
    { id: "two", name: "Two+", description: "After", updatedAt: 99 },
  ]);
});

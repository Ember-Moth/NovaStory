import { expect, test } from "vitest";

import { createId, createProjectId } from "./domain";

test("createId returns a bare nanoid (prefix parameter is kept for compat but ignored)", () => {
  const id = createId("workspace");

  expect(id).not.toContain("_");
  expect(id).not.toHaveLength(0);
  expect(id.includes("-")).toBe(false);
});

test("createProjectId returns a bare nanoid", () => {
  const id = createProjectId();

  expect(id).not.toContain("_");
  expect(id).not.toHaveLength(0);
  expect(id.includes("-")).toBe(false);
});

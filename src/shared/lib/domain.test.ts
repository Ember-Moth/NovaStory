import { expect, test } from "bun:test";

import { createId, createProjectId } from "./domain";

test("createId keeps the prefix and separator", () => {
  const id = createId("workspace");

  expect(id).toStartWith("workspace_");
  expect(id.slice("workspace_".length)).not.toHaveLength(0);
  expect(id.includes("-")).toBe(false);
});

test("createProjectId returns a bare nanoid", () => {
  const id = createProjectId();

  expect(id).not.toContain("_");
  expect(id).not.toHaveLength(0);
  expect(id.includes("-")).toBe(false);
});

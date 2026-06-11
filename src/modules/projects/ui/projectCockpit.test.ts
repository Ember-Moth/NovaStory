import { expect, test } from "bun:test";

import {
  resolveNewBranchSourceCommitId,
  resolveSelectedBranchId,
  sortProjectBranches,
} from "./projectCockpit";

const branches = [
  { id: "branch_old", updatedAt: 10, headCommitId: "commit_old" },
  { id: "branch_default", updatedAt: 20, headCommitId: "commit_default" },
  { id: "branch_new", updatedAt: 30, headCommitId: "commit_new" },
];

test("sortProjectBranches keeps the default branch first, then sorts by updatedAt", () => {
  expect(sortProjectBranches(branches, "branch_default").map((branch) => branch.id)).toEqual([
    "branch_default",
    "branch_new",
    "branch_old",
  ]);
});

test("resolveSelectedBranchId prefers remembered branch, then default branch, then most recent branch", () => {
  expect(resolveSelectedBranchId(branches, null, "branch_default")).toBe("branch_default");
  expect(resolveSelectedBranchId(branches, "branch_new", "branch_default")).toBe("branch_new");
  expect(resolveSelectedBranchId(branches, "missing", null)).toBe("branch_new");
  expect(resolveSelectedBranchId([], null, "branch_default")).toBeNull();
});

test("resolveNewBranchSourceCommitId uses the default branch head when present", () => {
  expect(resolveNewBranchSourceCommitId(branches, "branch_default")).toBe("commit_default");
  expect(
    resolveNewBranchSourceCommitId(
      [{ id: "branch_empty", updatedAt: 1, headCommitId: null }],
      "branch_empty",
    ),
  ).toBeNull();
});

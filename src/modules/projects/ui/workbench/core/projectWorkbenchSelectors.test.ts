import { expect, test } from "bun:test";

import {
  resolveNewBranchSourceCommitId,
  resolveSelectedBranchIdAfterDelete,
  resolveSelectedBranchId,
  resolveWorkspaceRouteAfterBranchDelete,
  sortProjectBranches,
} from "./projectWorkbenchSelectors";

const branches = [{ name: "branch_old" }, { name: "branch_default" }, { name: "branch_new" }];

const branchHeads = [
  { branchName: "branch_old", headCommitId: "commit_old" },
  { branchName: "branch_default", headCommitId: "commit_default" },
  { branchName: "branch_new", headCommitId: "commit_new" },
];

const branchRecency = new Map<string, number>([
  ["branch_old", 100],
  ["branch_default", 200],
  ["branch_new", 300],
]);

test("sortProjectBranches keeps the default branch first, then sorts by recency", () => {
  expect(
    sortProjectBranches(branches, "branch_default", branchRecency).map((branch) => branch.name),
  ).toEqual(["branch_default", "branch_new", "branch_old"]);
});

test("sortProjectBranches falls back to insertion order when recency is missing", () => {
  expect(sortProjectBranches(branches, "branch_default").map((branch) => branch.name)).toEqual([
    "branch_default",
    "branch_old",
    "branch_new",
  ]);
});

test("resolveSelectedBranchId prefers remembered branch, then default branch, then most recent branch", () => {
  expect(resolveSelectedBranchId(branches, null, "branch_default", branchRecency)).toBe(
    "branch_default",
  );
  expect(resolveSelectedBranchId(branches, "branch_new", "branch_default", branchRecency)).toBe(
    "branch_new",
  );
  expect(resolveSelectedBranchId(branches, "missing", null, branchRecency)).toBe("branch_new");
  expect(resolveSelectedBranchId([], null, "branch_default", branchRecency)).toBeNull();
});

test("resolveNewBranchSourceCommitId uses the default branch head when present", () => {
  expect(resolveNewBranchSourceCommitId(branchHeads, "branch_default")).toBe("commit_default");
  expect(
    resolveNewBranchSourceCommitId(
      [{ branchName: "branch_empty", headCommitId: null }],
      "branch_empty",
    ),
  ).toBeNull();
});

test("resolveWorkspaceRouteAfterBranchDelete closes only the deleted workspace", () => {
  const currentRoute = { projectId: "project_1", workspaceId: "workspace_1" };

  expect(
    resolveWorkspaceRouteAfterBranchDelete(currentRoute, {
      id: "workspace_1",
      projectId: "project_1",
    }),
  ).toBeNull();
  expect(
    resolveWorkspaceRouteAfterBranchDelete(currentRoute, {
      id: "workspace_2",
      projectId: "project_1",
    }),
  ).toEqual(currentRoute);
  expect(
    resolveWorkspaceRouteAfterBranchDelete(currentRoute, {
      id: "workspace_1",
      projectId: "project_2",
    }),
  ).toEqual(currentRoute);
  expect(resolveWorkspaceRouteAfterBranchDelete(currentRoute, null)).toEqual(currentRoute);
});

test("resolveSelectedBranchIdAfterDelete falls back from the deleted selected branch", () => {
  expect(
    resolveSelectedBranchIdAfterDelete(branches, "branch_new", "branch_new", "branch_default"),
  ).toBe("branch_default");
  expect(
    resolveSelectedBranchIdAfterDelete(branches, "branch_old", "branch_new", "branch_default"),
  ).toBe("branch_new");
  expect(
    resolveSelectedBranchIdAfterDelete(branches, "branch_default", "branch_default", null),
  ).toBe("branch_old");
});

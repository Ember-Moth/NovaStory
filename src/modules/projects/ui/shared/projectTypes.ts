import type { rpc } from "@/rpc/client";

export type ProjectList = NonNullable<ReturnType<typeof rpc.useQuery<"projects.list">>["data"]>;
export type ProjectRow = NonNullable<ReturnType<typeof rpc.useQuery<"projects.get">>["data"]>;
export type BranchList = NonNullable<ReturnType<typeof rpc.useQuery<"branches.list">>["data"]>;
export type BranchRow = BranchList[number];
export type BranchHeadList = NonNullable<ReturnType<typeof rpc.useQuery<"branches.heads">>["data"]>;
export type BranchHeadRow = BranchHeadList[number];
export type WorkspaceList = NonNullable<ReturnType<typeof rpc.useQuery<"workspaces.list">>["data"]>;
export type WorkspaceRow = WorkspaceList[number];
export type CommitHistory = NonNullable<ReturnType<typeof rpc.useQuery<"commits.history">>["data"]>;
export type CommitRow = CommitHistory[number];
export type WorkingTreeStatus = NonNullable<
  ReturnType<typeof rpc.useQuery<"commits.workingTreeStatus">>["data"]
>;
export type CommitDiff = NonNullable<ReturnType<typeof rpc.useQuery<"commits.diff">>["data"]>;
export type ChangeAreas = WorkingTreeStatus["areas"];

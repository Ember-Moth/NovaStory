import type * as projectsRpc from "@/modules/projects/rpc";
import type * as branchesRpc from "@/modules/workspace/rpc/branches";
import type * as commitsRpc from "@/modules/workspace/rpc/commits";
import type * as workspacesRpc from "@/modules/workspace/rpc/workspaces";

type Unwrap<T> = T extends Promise<{ data: infer D }> ? D : never;

export type ProjectList = Unwrap<ReturnType<typeof projectsRpc.list>>;
export type ProjectRow = ProjectList extends (infer R)[]
  ? R
  : Unwrap<ReturnType<typeof projectsRpc.get>>;
export type BranchList = Unwrap<ReturnType<typeof branchesRpc.list>>;
export type BranchRow = BranchList[number];
export type BranchHeadList = Unwrap<ReturnType<typeof branchesRpc.heads>>;
export type BranchHeadRow = BranchHeadList[number];
export type WorkspaceList = Unwrap<ReturnType<typeof workspacesRpc.list>>;
export type WorkspaceRow = WorkspaceList[number];
export type CommitHistory = Unwrap<ReturnType<typeof commitsRpc.history>>;
export type CommitRow = CommitHistory[number];
export type WorkingTreeStatus = Unwrap<ReturnType<typeof commitsRpc.workingTreeStatus>>;
export type CommitDiff = Unwrap<ReturnType<typeof commitsRpc.diff>>;
export type ChangeAreas = WorkingTreeStatus["areas"];

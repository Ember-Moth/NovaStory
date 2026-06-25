import { skipToken } from "@codehz/rpc/react";

import { rpc } from "@/rpc/client";

import { resolveSelectedBranchId, sortProjectBranches } from "./projectWorkbenchSelectors";
import type {
  BranchHeadList,
  BranchList,
  CommitHistory,
  ProjectRow,
  WorkingTreeStatus,
  WorkspaceList,
  WorkspaceRow,
} from "../../shared/projectTypes";

export type ProjectWorkbenchModel = {
  project: ProjectRow | null;
  projectInitialLoading: boolean;
  projectErrorMessage: string | null;
  branches: BranchList;
  branchHeads: BranchHeadList;
  workspaces: WorkspaceList;
  branchHeadCommitIdById: ReadonlyMap<string, string | null>;
  sortedBranches: BranchList;
  selectedBranchId: string | null;
  selectedBranch: BranchList[number] | null;
  selectedBranchHeadCommitId: string | null;
  workspaceMap: ReadonlyMap<string, WorkspaceRow>;
  selectedWorkspace: WorkspaceRow | null;
  commitHistory: CommitHistory;
  commitHistoryLoading: boolean;
  commitHistoryErrorMessage: string | null;
  workingTreeStatus: WorkingTreeStatus | null;
  workingTreeStatusLoading: boolean;
  workingTreeStatusErrorMessage: string | null;
  branchesLoading: boolean;
  branchesErrorMessage: string | null;
};

export function useProjectWorkbenchModel(
  projectId: string,
  branchIdFromRoute: string | null,
): ProjectWorkbenchModel {
  const projectQuery = rpc.useQuery("projects.get", { projectId }, { refetchOnWindowFocus: true });
  const branchesQuery = rpc.useQuery(
    "branches.list",
    { projectId },
    { refetchOnWindowFocus: true },
  );
  const workspacesQuery = rpc.useQuery(
    "workspaces.list",
    { projectId },
    { refetchOnWindowFocus: true },
  );
  const branchHeadsQuery = rpc.useQuery(
    "branches.heads",
    { projectId },
    { refetchOnWindowFocus: true },
  );

  const project = projectQuery.data ?? null;
  const branches = branchesQuery.data ?? [];
  const workspaces = workspacesQuery.data ?? [];
  const branchHeads = branchHeadsQuery.data ?? [];
  const branchHeadCommitIdById = new Map(
    branchHeads.map((branchHead) => [branchHead.branchName, branchHead.headCommitId] as const),
  );
  const branchRecency = new Map(
    branchHeads.map(
      (branchHead) => [branchHead.branchName, branchHead.headCommitTime ?? 0] as const,
    ),
  );
  const sortedBranches = sortProjectBranches(
    branches,
    project?.defaultBranchName ?? null,
    branchRecency,
  );
  const selectedBranchId = resolveSelectedBranchId(
    sortedBranches,
    branchIdFromRoute,
    project?.defaultBranchName ?? null,
  );
  const selectedBranch = sortedBranches.find((branch) => branch.name === selectedBranchId) ?? null;
  const selectedBranchHeadCommitId = selectedBranch
    ? (branchHeadCommitIdById.get(selectedBranch.name) ?? null)
    : null;

  const commitHistoryQuery = rpc.useQuery(
    "commits.history",
    selectedBranchId ? { projectId, branchId: selectedBranchId } : skipToken,
    { refetchOnWindowFocus: true },
  );
  const workingTreeStatusQuery = rpc.useQuery(
    "commits.workingTreeStatus",
    selectedBranchId ? { projectId, branchId: selectedBranchId } : skipToken,
    { refetchOnWindowFocus: true },
  );
  const commitHistory = commitHistoryQuery.data ?? [];
  const workingTreeStatus = workingTreeStatusQuery.data ?? null;

  const workspaceMap = new Map(
    workspaces.map((workspace) => [workspace.branchName, workspace] as const),
  );
  const selectedWorkspace = selectedBranch ? (workspaceMap.get(selectedBranch.name) ?? null) : null;

  return {
    project,
    projectInitialLoading: projectQuery.isInitialLoading && project == null,
    projectErrorMessage: projectQuery.error?.message ?? null,
    branches,
    branchHeads,
    workspaces,
    branchHeadCommitIdById,
    sortedBranches,
    selectedBranchId,
    selectedBranch,
    selectedBranchHeadCommitId,
    workspaceMap,
    selectedWorkspace,
    commitHistory,
    commitHistoryLoading: commitHistoryQuery.isInitialLoading && commitHistory.length === 0,
    commitHistoryErrorMessage: commitHistoryQuery.error?.message ?? null,
    workingTreeStatus,
    workingTreeStatusLoading: workingTreeStatusQuery.isInitialLoading && workingTreeStatus == null,
    workingTreeStatusErrorMessage: workingTreeStatusQuery.error?.message ?? null,
    branchesLoading: branchesQuery.isInitialLoading && sortedBranches.length === 0,
    branchesErrorMessage: branchesQuery.error?.message ?? null,
  };
}

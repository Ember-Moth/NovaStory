export interface BranchLike {
  name: string;
}

export interface BranchHeadLike {
  branchName: string;
  headCommitId: string | null;
}

export interface WorkspaceRouteLike {
  projectId: string;
  workspaceId: string;
}

export interface WorkspaceLike {
  id: string;
  projectId: string;
}

export function sortProjectBranches<TBranch extends BranchLike>(
  branches: readonly TBranch[],
  defaultBranchId: string | null,
  branchRecency?: ReadonlyMap<string, number>,
) {
  return [...branches].sort((a, b) => {
    const aDefault = a.name === defaultBranchId;
    const bDefault = b.name === defaultBranchId;
    if (aDefault !== bDefault) {
      return aDefault ? -1 : 1;
    }
    const aTime = branchRecency?.get(a.name) ?? 0;
    const bTime = branchRecency?.get(b.name) ?? 0;
    return bTime - aTime;
  });
}

export function resolveSelectedBranchId<TBranch extends BranchLike>(
  branches: readonly TBranch[],
  rememberedBranchId: string | null,
  defaultBranchId: string | null,
  branchRecency?: ReadonlyMap<string, number>,
) {
  if (rememberedBranchId && branches.some((branch) => branch.name === rememberedBranchId)) {
    return rememberedBranchId;
  }

  const sorted = sortProjectBranches(branches, defaultBranchId, branchRecency);
  return sorted[0]?.name ?? null;
}

export function resolveNewBranchSourceCommitId<TBranchHead extends BranchHeadLike>(
  branchHeads: readonly TBranchHead[],
  defaultBranchId: string | null,
) {
  const defaultBranch = branchHeads.find((branch) => branch.branchName === defaultBranchId);
  return defaultBranch?.headCommitId ?? null;
}

export function resolveWorkspaceRouteAfterBranchDelete<TWorkspace extends WorkspaceLike>(
  currentRoute: WorkspaceRouteLike | null,
  deletedWorkspace: TWorkspace | null,
) {
  if (
    currentRoute &&
    deletedWorkspace &&
    currentRoute.projectId === deletedWorkspace.projectId &&
    currentRoute.workspaceId === deletedWorkspace.id
  ) {
    return null;
  }

  return currentRoute;
}

export function resolveSelectedBranchIdAfterDelete<TBranch extends BranchLike>(
  branches: readonly TBranch[],
  deletedBranchId: string,
  selectedBranchId: string | null,
  defaultBranchId: string | null,
) {
  const remainingBranches = branches.filter((branch) => branch.name !== deletedBranchId);
  return resolveSelectedBranchId(
    remainingBranches,
    selectedBranchId === deletedBranchId ? null : selectedBranchId,
    defaultBranchId,
  );
}

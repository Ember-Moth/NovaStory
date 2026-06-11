export interface BranchLike {
  id: string;
  updatedAt: number;
  headCommitId: string | null;
}

export function sortProjectBranches<TBranch extends BranchLike>(
  branches: readonly TBranch[],
  defaultBranchId: string | null,
) {
  return [...branches].sort((a, b) => {
    const aDefault = a.id === defaultBranchId;
    const bDefault = b.id === defaultBranchId;
    if (aDefault !== bDefault) {
      return aDefault ? -1 : 1;
    }
    return b.updatedAt - a.updatedAt;
  });
}

export function resolveSelectedBranchId<TBranch extends BranchLike>(
  branches: readonly TBranch[],
  rememberedBranchId: string | null,
  defaultBranchId: string | null,
) {
  if (rememberedBranchId && branches.some((branch) => branch.id === rememberedBranchId)) {
    return rememberedBranchId;
  }

  const sorted = sortProjectBranches(branches, defaultBranchId);
  return sorted[0]?.id ?? null;
}

export function resolveNewBranchSourceCommitId<TBranch extends BranchLike>(
  branches: readonly TBranch[],
  defaultBranchId: string | null,
) {
  const defaultBranch = branches.find((branch) => branch.id === defaultBranchId);
  return defaultBranch?.headCommitId ?? null;
}

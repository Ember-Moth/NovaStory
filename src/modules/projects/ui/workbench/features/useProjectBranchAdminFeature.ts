import { useCallback } from "react";

import { useLastProjectStore } from "@/app/state/lastProject";
import { rpc } from "@/rpc/client";

import {
  resolveSelectedBranchIdAfterDelete,
  resolveWorkspaceRouteAfterBranchDelete,
} from "../core/projectWorkbenchSelectors";
import type { BranchRow } from "../../shared/projectTypes";
import {
  useProjectWorkbenchNavigation,
  useProjectWorkbenchProjectId,
  useProjectWorkbenchViewModel,
} from "../core/useProjectWorkbench";

export function useProjectBranchAdminFeature() {
  const projectId = useProjectWorkbenchProjectId();
  const model = useProjectWorkbenchViewModel();
  const { navigateToBranch } = useProjectWorkbenchNavigation();
  const setLastWorkspaceRoute = useLastProjectStore((state) => state.setLastWorkspaceRoute);
  const setDefaultBranch = rpc.useMutation("projects.setDefaultBranch");
  const deleteBranch = rpc.useMutation("branches.delete");

  const handleSetDefaultBranch = useCallback(
    async (branch: BranchRow) => {
      const project = model.project;
      if (!project || project.defaultBranchName === branch.name) {
        return;
      }

      await setDefaultBranch.mutate({
        projectId: project.id,
        branchId: branch.name,
      });
    },
    [model.project, setDefaultBranch],
  );

  const handleDeleteBranch = useCallback(
    async (branch: BranchRow) => {
      const project = model.project;
      if (!project) {
        return;
      }

      if (!confirm(`确认删除分支“${branch.name}”吗？这会连带删除它绑定的 workspace。`)) {
        return;
      }

      const nextSelectedBranchId = resolveSelectedBranchIdAfterDelete(
        model.sortedBranches,
        branch.name,
        model.selectedBranchId,
        project.defaultBranchName,
      );
      const deletedWorkspace = model.workspaceMap.get(branch.name) ?? null;

      await deleteBranch.mutate({
        projectId,
        branchId: branch.name,
      });

      setLastWorkspaceRoute((current) =>
        resolveWorkspaceRouteAfterBranchDelete(current, deletedWorkspace),
      );
      navigateToBranch(nextSelectedBranchId);
    },
    [
      deleteBranch,
      model.project,
      model.selectedBranchId,
      model.sortedBranches,
      model.workspaceMap,
      navigateToBranch,
      projectId,
      setLastWorkspaceRoute,
    ],
  );

  return {
    handleSetDefaultBranch,
    handleDeleteBranch,
    isSettingDefault: setDefaultBranch.isPending,
    isDeletingBranch: deleteBranch.isPending,
  };
}

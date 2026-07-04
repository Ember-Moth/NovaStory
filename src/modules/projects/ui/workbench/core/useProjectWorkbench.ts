import { molecule, useMolecule } from "bunshi/react";
import { useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import { useProjectWorkbenchStoreApi } from "../state/projectWorkbenchStore";
import {
  ProjectWorkbenchBranchRouteScope,
  ProjectWorkbenchProjectScope,
} from "./projectWorkbenchScopes";
import { useProjectWorkbenchModel } from "./useProjectWorkbenchModel";

const ProjectWorkbenchProjectIdMolecule = molecule((_, getScope) =>
  getScope(ProjectWorkbenchProjectScope),
);

const ProjectWorkbenchBranchRouteIdMolecule = molecule((_, getScope) =>
  getScope(ProjectWorkbenchBranchRouteScope),
);

export function useProjectWorkbenchProjectId() {
  return useMolecule(ProjectWorkbenchProjectIdMolecule);
}

export function useProjectWorkbenchBranchRouteId() {
  return useMolecule(ProjectWorkbenchBranchRouteIdMolecule);
}

export function useProjectWorkbenchViewModel() {
  const projectId = useProjectWorkbenchProjectId();
  const branchRouteId = useProjectWorkbenchBranchRouteId();

  return useProjectWorkbenchModel(projectId, branchRouteId);
}

export function useProjectWorkbenchNavigation() {
  const projectId = useProjectWorkbenchProjectId();
  const [, navigate] = useLocation();

  const navigateToBranch = useCallback(
    (nextBranchId: string | null) => {
      if (nextBranchId) {
        navigate(`/project/${projectId}/branch/${nextBranchId}`);
        return;
      }

      navigate(`/project/${projectId}`);
    },
    [navigate, projectId],
  );

  return {
    navigate,
    navigateToBranch,
  };
}

export function useProjectWorkbenchSync() {
  const model = useProjectWorkbenchViewModel();
  const branchRouteId = useProjectWorkbenchBranchRouteId();
  const { navigateToBranch } = useProjectWorkbenchNavigation();
  const workbenchStore = useProjectWorkbenchStoreApi();

  useEffect(() => {
    workbenchStore.getState().syncProjectDetail(model.project);
  }, [model.project, workbenchStore]);

  useEffect(() => {
    workbenchStore.getState().resetCommitDraft();
  }, [workbenchStore]);

  useEffect(() => {
    if (
      !model.projectInitialLoading &&
      !model.projectErrorMessage &&
      model.selectedBranchId !== branchRouteId
    ) {
      navigateToBranch(model.selectedBranchId);
    }
  }, [
    branchRouteId,
    model.projectErrorMessage,
    model.projectInitialLoading,
    model.selectedBranchId,
    navigateToBranch,
  ]);
}

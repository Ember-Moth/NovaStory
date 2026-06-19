import { type FormEvent, useCallback } from "react";

import { rpc } from "@/rpc/client";

import { resolveNewBranchSourceCommitId } from "../core/projectWorkbenchSelectors";
import {
  useProjectWorkbenchNavigation,
  useProjectWorkbenchProjectId,
  useProjectWorkbenchViewModel,
} from "../core/useProjectWorkbench";
import {
  useProjectCreateBranchDialogState,
  useProjectWorkbenchStoreApi,
} from "../state/projectWorkbenchStore";

export function useCreateBranchDialogControls() {
  const workbenchStore = useProjectWorkbenchStoreApi();
  const { isDialogOpen, setDialogOpen } = useProjectCreateBranchDialogState();

  const openDialog = useCallback(() => {
    workbenchStore.getState().resetCreateBranchDialog();
    setDialogOpen(true);
  }, [setDialogOpen, workbenchStore]);

  const closeDialog = useCallback(() => {
    workbenchStore.getState().resetCreateBranchDialog();
  }, [workbenchStore]);

  return {
    isOpen: isDialogOpen,
    openDialog,
    closeDialog,
  };
}

export function useCreateBranchFeature() {
  const projectId = useProjectWorkbenchProjectId();
  const model = useProjectWorkbenchViewModel();
  const { navigateToBranch } = useProjectWorkbenchNavigation();
  const workbenchStore = useProjectWorkbenchStoreApi();
  const dialogControls = useCreateBranchDialogControls();
  const createBranch = rpc.useMutation("branches.create");

  const submit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!model.project) {
        return;
      }

      const { newBranchName, setNewBranchError } = workbenchStore.getState();
      const trimmedName = newBranchName.trim();
      if (!trimmedName) {
        setNewBranchError("分支名称不能为空。");
        return;
      }

      try {
        const sourceCommitId = resolveNewBranchSourceCommitId(
          model.branchHeads,
          model.project.defaultBranchId,
        );
        const workspace = await createBranch.mutate({
          projectId,
          name: trimmedName,
          fromCommitId: sourceCommitId,
        });
        dialogControls.closeDialog();
        navigateToBranch(workspace.id);
      } catch (mutationError) {
        setNewBranchError(
          mutationError instanceof Error ? mutationError.message : "创建分支失败，请稍后重试。",
        );
      }
    },
    [
      createBranch,
      dialogControls,
      model.branchHeads,
      model.project,
      navigateToBranch,
      projectId,
      workbenchStore,
    ],
  );

  return {
    ...dialogControls,
    submit,
    errorMessage: createBranch.error?.message ?? null,
    isPending: createBranch.isPending,
  };
}

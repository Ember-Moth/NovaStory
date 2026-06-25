import { type FormEvent, useCallback } from "react";

import { rpc } from "@/rpc/client";

import {
  useProjectWorkbenchProjectId,
  useProjectWorkbenchViewModel,
} from "../core/useProjectWorkbench";
import { useProjectWorkbenchStoreApi } from "../state/projectWorkbenchStore";

export function useProjectCommitFeature() {
  const projectId = useProjectWorkbenchProjectId();
  const model = useProjectWorkbenchViewModel();
  const workbenchStore = useProjectWorkbenchStoreApi();
  const createCommit = rpc.useMutation("commits.create");
  const checkoutCommit = rpc.useMutation("commits.checkout");

  const handleDiscardChanges = useCallback(async () => {
    if (
      !model.selectedBranch ||
      !model.selectedWorkspace ||
      !model.workingTreeStatus?.headCommitId
    ) {
      return;
    }

    if (!confirm("确认撤回全部未提交修改吗？工作区将恢复到当前 HEAD 状态，此操作不可撤销。")) {
      return;
    }

    try {
      workbenchStore.getState().setDiscardError(null);
      await checkoutCommit.mutate({
        projectId,
        workspaceId: model.selectedWorkspace.id,
        commitId: model.workingTreeStatus.headCommitId,
      });
    } catch (mutationError) {
      workbenchStore
        .getState()
        .setDiscardError(
          mutationError instanceof Error ? mutationError.message : "撤回修改失败，请稍后重试。",
        );
    }
  }, [
    checkoutCommit,
    model.selectedBranch,
    model.selectedWorkspace,
    model.workingTreeStatus,
    projectId,
    workbenchStore,
  ]);

  const handleCommit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!model.selectedBranch || !model.selectedWorkspace) {
        return;
      }

      const commitBlockedByCleanTree =
        model.workingTreeStatus?.headCommitId != null &&
        model.workingTreeStatus.hasChanges === false;
      if (commitBlockedByCleanTree) {
        return;
      }

      const { commitMessage, setCommitError, setCommitMessage } = workbenchStore.getState();
      const trimmedMessage = commitMessage.trim();
      if (!trimmedMessage) {
        setCommitError("提交信息不能为空。");
        return;
      }

      try {
        setCommitError(null);
        await createCommit.mutate({
          projectId,
          branchId: model.selectedBranch.name,
          message: trimmedMessage,
        });
        setCommitMessage("");
      } catch (mutationError) {
        setCommitError(
          mutationError instanceof Error ? mutationError.message : "提交失败，请稍后重试。",
        );
      }
    },
    [
      createCommit,
      model.selectedBranch,
      model.selectedWorkspace,
      model.workingTreeStatus,
      projectId,
      workbenchStore,
    ],
  );

  return {
    handleDiscardChanges,
    handleCommit,
    discardErrorMessage: checkoutCommit.error?.message ?? null,
    commitErrorMessage: createCommit.error?.message ?? null,
    isCommitting: createCommit.isPending,
    isDiscardingChanges: checkoutCommit.isPending,
  };
}

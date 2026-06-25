import { useCallback } from "react";

import { rpc } from "@/rpc/client";

import {
  useProjectWorkbenchProjectId,
  useProjectWorkbenchViewModel,
} from "../core/useProjectWorkbench";

export function useRevertContentChangeFeature() {
  const projectId = useProjectWorkbenchProjectId();
  const model = useProjectWorkbenchViewModel();
  const revertContentChange = rpc.useMutation("content.revert");

  const handleRevertContentChange = useCallback(
    async (nodeId: string, kind: "added" | "deleted" | "modified") => {
      if (!model.selectedBranch) {
        return;
      }

      const confirmMessages: Record<string, string> = {
        added: "确认撤回该新增节点？节点及其所有子节点将被永久删除。",
        deleted: "确认恢复该已删除节点？将从 HEAD 中恢复该节点及其完整子树。",
        modified: "确认恢复该节点的所有修改？节点的标题、正文、锚点、位置将恢复至 HEAD 状态。",
      };

      if (!confirm(confirmMessages[kind])) {
        return;
      }

      await revertContentChange.mutate({
        projectId,
        branchId: model.selectedBranch.name,
        nodeId,
        kind,
      });
    },
    [model.selectedBranch, projectId, revertContentChange],
  );

  return {
    handleRevertContentChange,
    isReverting: revertContentChange.isPending,
    revertError: revertContentChange.error?.message ?? null,
  };
}

import { useCallback } from "react";

import {
  actionAnchorId,
  clearActionError,
  setActionError,
} from "@/modules/workspace/ui/editor/model/action-error";
import { buildContentNodePath, omitRecordKey } from "@/modules/workspace/ui/editor/model/tree";
import type { ContentTreeNodeVM, TimelinePointVM } from "@/modules/workspace/ui/editor/model/types";
import { ORIGIN_TIMELINE_POINT_ID } from "@/modules/workspace/domain/constants";
import { rpc } from "@/rpc/client";
import type { WorkspaceStore } from "@/modules/workspace/ui/editor/state/molecules/workspaceStore";

export type TimelineDeleteDialogState = {
  pointId: string;
  pointLabel: string;
  auxPaths: string[];
  anchorId: string;
};

function formatTimelineContentAnchorError(
  anchors: ContentTreeNodeVM[],
  contentParentMap: ReadonlyMap<string, string | null>,
  contentNodeMap: ReadonlyMap<string, ContentTreeNodeVM>,
) {
  const paths = anchors.map((node) =>
    buildContentNodePath(node.id, new Map(contentParentMap), new Map(contentNodeMap)),
  );

  if (paths.length === 1) {
    return `无法删除：章节「${paths[0]}」仍锚定在此时间点。`;
  }

  return `无法删除：以下章节仍锚定在此时间点：${paths.map((path) => `「${path}」`).join("、")}。`;
}

type TimelineActionDependencies = {
  projectId: string;
  workspaceId: string | undefined;
  timelinePoints: TimelinePointVM[];
  flatContentNodes: ContentTreeNodeVM[];
  contentNodeMap: ReadonlyMap<string, ContentTreeNodeVM>;
  contentParentMap: ReadonlyMap<string, string | null>;
  createTimeline: {
    mutate: (input: {
      projectId: string;
      workspaceId: string;
      afterPointId: string;
      label: string;
      description: string;
    }) => Promise<{ id: string }>;
  };
  moveTimeline: {
    mutate: (input: {
      projectId: string;
      workspaceId: string;
      pointId: string;
      afterPointId: string;
    }) => Promise<unknown>;
  };
  deleteTimeline: {
    isPending: boolean;
    mutate: (input: {
      projectId: string;
      workspaceId: string;
      pointId: string;
      purgeAuxLayers?: true;
    }) => Promise<void>;
  };
  updateTimeline: {
    mutate: (input: {
      projectId: string;
      workspaceId: string;
      pointId: string;
      label: string;
    }) => Promise<unknown>;
  };
  store: WorkspaceStore;
  timelineDeleteDialog: TimelineDeleteDialogState | null;
  setTimelineDeleteDialog: (next: TimelineDeleteDialogState | null) => void;
  flushDirtyAux: (timelinePointId?: string) => void;
  finishTimelineDelete: (pointId: string) => void;
};

export function useProjectTimelineActions({
  projectId,
  workspaceId,
  timelinePoints,
  flatContentNodes,
  contentNodeMap,
  contentParentMap,
  createTimeline,
  moveTimeline,
  deleteTimeline,
  updateTimeline,
  store,
  timelineDeleteDialog,
  setTimelineDeleteDialog,
  flushDirtyAux,
  finishTimelineDelete,
}: TimelineActionDependencies) {
  const handleTimelineSelect = useCallback(
    (pointId: string) => {
      const { activeTimelinePointId, activeAuxPath } = store.getState();
      if (pointId === activeTimelinePointId) {
        return;
      }

      flushDirtyAux(activeTimelinePointId ?? undefined);

      if (activeAuxPath) {
        const state = store.getState();
        state.setDrafts((previous) => omitRecordKey(previous, activeAuxPath));
        state.setCommittedBodies((previous) => omitRecordKey(previous, activeAuxPath));
        state.setPendingSaveCounts((previous) => omitRecordKey(previous, activeAuxPath));
        state.setSaveErrors((previous) => omitRecordKey(previous, activeAuxPath));
      }

      store.getState().setActiveTimelinePointId(pointId);
    },
    [flushDirtyAux, store],
  );

  const handleTimelineRename = useCallback(
    async (pointId: string, label: string) => {
      if (!workspaceId || pointId === ORIGIN_TIMELINE_POINT_ID) {
        return false;
      }

      const normalizedLabel = label.trim();
      if (!normalizedLabel) {
        return false;
      }

      clearActionError(store.getState().setTimelineError);

      try {
        await updateTimeline.mutate({
          projectId,
          workspaceId,
          pointId,
          label: normalizedLabel,
        });
        return true;
      } catch (error) {
        setActionError(
          store.getState().setTimelineError,
          error instanceof Error ? error.message : "重命名时间点失败，请稍后重试。",
          actionAnchorId("timeline", "row", pointId),
        );
        return false;
      }
    },
    [projectId, store, updateTimeline, workspaceId],
  );

  const handleTimelineAdd = useCallback(
    async (anchorId: string) => {
      const { activeTimelinePointId, setTimelineError } = store.getState();
      if (!workspaceId || !activeTimelinePointId) {
        return;
      }

      const newIndex = timelinePoints.filter((point) => !point.isImplicitOrigin).length + 1;
      clearActionError(setTimelineError);

      try {
        const point = await createTimeline.mutate({
          projectId,
          workspaceId,
          afterPointId: activeTimelinePointId,
          label: `新时间点 ${newIndex}`,
          description: "",
        });
        store.getState().setActiveTimelinePointId(point.id);
      } catch (error) {
        setActionError(
          store.getState().setTimelineError,
          error instanceof Error ? error.message : "创建时间点失败，请稍后重试。",
          anchorId,
        );
      }
    },
    [createTimeline, projectId, store, timelinePoints, workspaceId],
  );

  const handleTimelineMove = useCallback(
    async (pointId: string, afterPointId: string) => {
      if (!workspaceId) {
        return;
      }

      const movedPoint = timelinePoints.find((point) => point.id === pointId);
      if (!movedPoint || movedPoint.isImplicitOrigin) {
        return;
      }

      clearActionError(store.getState().setTimelineError);

      try {
        await moveTimeline.mutate({
          projectId,
          workspaceId,
          pointId,
          afterPointId,
        });
      } catch (error) {
        setActionError(
          store.getState().setTimelineError,
          error instanceof Error ? error.message : "调整时间轴顺序失败，请稍后重试。",
          actionAnchorId("timeline", "row", movedPoint.id),
        );
      }
    },
    [moveTimeline, projectId, store, timelinePoints, workspaceId],
  );

  const handleTimelineDelete = useCallback(
    async (pointId: string, anchorId: string) => {
      if (!workspaceId || pointId === ORIGIN_TIMELINE_POINT_ID) {
        return;
      }

      clearActionError(store.getState().setTimelineError);

      const anchoredNodes = flatContentNodes.filter(
        (node) => node.anchorTimelinePointId === pointId,
      );
      if (anchoredNodes.length > 0) {
        setActionError(
          store.getState().setTimelineError,
          formatTimelineContentAnchorError(anchoredNodes, contentParentMap, contentNodeMap),
          anchorId,
        );
        return;
      }

      try {
        const { data: auxChanges } = await rpc.callQuery("aux.listChangesAt", {
          projectId,
          workspaceId,
          pointId,
        });
        const pointLabel = timelinePoints.find((point) => point.id === pointId)?.label ?? pointId;

        if ((auxChanges?.length ?? 0) > 0) {
          setTimelineDeleteDialog({
            pointId,
            pointLabel,
            auxPaths: (auxChanges ?? []).map((change: { path: string; isDeleted: boolean }) =>
              change.isDeleted ? `${change.path}（已删除）` : change.path,
            ),
            anchorId,
          });
          return;
        }

        await deleteTimeline.mutate({
          projectId,
          workspaceId,
          pointId,
        });
        finishTimelineDelete(pointId);
      } catch (error) {
        setActionError(
          store.getState().setTimelineError,
          error instanceof Error ? error.message : "删除时间点失败，请稍后重试。",
          anchorId,
        );
      }
    },
    [
      contentNodeMap,
      contentParentMap,
      deleteTimeline,
      finishTimelineDelete,
      flatContentNodes,
      projectId,
      setTimelineDeleteDialog,
      store,
      timelinePoints,
      workspaceId,
    ],
  );

  const handleTimelineDeleteCancel = useCallback(() => {
    if (deleteTimeline.isPending) {
      return;
    }
    setTimelineDeleteDialog(null);
  }, [deleteTimeline.isPending, setTimelineDeleteDialog]);

  const handleTimelineDeleteConfirm = useCallback(async () => {
    if (!workspaceId || !timelineDeleteDialog) {
      return;
    }

    const { pointId, anchorId } = timelineDeleteDialog;
    clearActionError(store.getState().setTimelineError);

    try {
      await deleteTimeline.mutate({
        projectId,
        workspaceId,
        pointId,
        purgeAuxLayers: true,
      });
      finishTimelineDelete(pointId);
      setTimelineDeleteDialog(null);
    } catch (error) {
      setTimelineDeleteDialog(null);
      setActionError(
        store.getState().setTimelineError,
        error instanceof Error ? error.message : "删除时间点失败，请稍后重试。",
        anchorId,
      );
    }
  }, [
    deleteTimeline,
    finishTimelineDelete,
    projectId,
    setTimelineDeleteDialog,
    store,
    timelineDeleteDialog,
    workspaceId,
  ]);

  return {
    handleTimelineSelect,
    handleTimelineAdd,
    handleTimelineRename,
    handleTimelineMove,
    handleTimelineDelete,
    handleTimelineDeleteCancel,
    handleTimelineDeleteConfirm,
  };
}

import { useCallback, useState } from "react";
import { ORIGIN_TIMELINE_POINT_ID } from "@/modules/workspace/domain/constants";
import { omitRecordKey } from "@/modules/workspace/ui/editor/model/tree";

import { mergeProjectActionGroups } from "../actions/actionGroups";
import { useWorkspaceStoreApi } from "../molecules/workspaceStore";
import {
  clearContentNodeLocalState as clearContentNodeLocalStateRecords,
  clearNodeLocalState,
  clearSaveError,
  decrementPendingSaveCount,
  incrementPendingSaveCount,
  selectContentNode,
  setNodeSaveError,
} from "./projectActionShared";
import { useProjectAuxActions } from "./projectAuxActions";
import { useProjectContentActions } from "./projectContentActions";
import {
  type TimelineDeleteDialogState,
  useProjectTimelineActions,
} from "./projectTimelineActions";
import type { ProjectWorkspaceState } from "./useProjectWorkspace";

export function useProjectActions(workspace: ProjectWorkspaceState) {
  const store = useWorkspaceStoreApi();

  const {
    identity: { projectId, workspaceId },
    content: {
      tree: contentTree,
      flatNodes: flatContentNodes,
      nodeMap: contentNodeMap,
      parentMap: contentParentMap,
      createContent,
      deleteContent,
      moveContent,
      updateContent,
    },
    timeline: {
      points: timelinePoints,
      createTimeline,
      moveTimeline,
      deleteTimeline,
      updateTimeline,
    },
    aux: {
      tree: auxTree,
      rootId: auxRootPath,
      nodeMap: auxNodeMap,
      parentMap: auxParentMap,
      mkdirAux,
      writeFileAux,
      linkAux,
      moveAux,
      retargetSymlinkAux,
      deleteAux,
      restoreDeletedAux,
    },
    selection: { activeContentNode },
  } = workspace;

  const [timelineDeleteDialog, setTimelineDeleteDialog] =
    useState<TimelineDeleteDialogState | null>(null);

  const finishTimelineDelete = useCallback(
    (pointId: string) => {
      const state = store.getState();
      if (state.activeTimelinePointId === pointId) {
        state.setActiveTimelinePointId(ORIGIN_TIMELINE_POINT_ID);
        state.setPendingAuxPath(null);
        state.setActiveAuxPath(null);
      }
    },
    [store],
  );

  const flushBodySave = useCallback(
    async (nodeId: string, body: string) => {
      if (!workspaceId) {
        return;
      }

      const state = store.getState();
      incrementPendingSaveCount(state, nodeId);
      clearSaveError(state, nodeId);

      try {
        await updateContent.mutate({
          projectId,
          workspaceId,
          nodeId,
          body,
        });
        store.getState().setCommittedBodies((previous) => ({
          ...previous,
          [nodeId]: body,
        }));
      } catch (error) {
        setNodeSaveError(store.getState(), nodeId, error, "保存失败，请稍后重试。");
      } finally {
        decrementPendingSaveCount(store.getState(), nodeId);
      }
    },
    [projectId, store, updateContent, workspaceId],
  );

  const flushAuxSave = useCallback(
    async (
      nodeId: string,
      content: string,
      timelinePointId = store.getState().activeTimelinePointId,
    ) => {
      if (!workspaceId || !timelinePointId) {
        return;
      }

      const state = store.getState();
      incrementPendingSaveCount(state, nodeId);
      clearSaveError(state, nodeId);

      try {
        await writeFileAux.mutate({
          projectId,
          workspaceId,
          timelinePointId,
          path: nodeId,
          content,
        });
        store.getState().setCommittedBodies((previous) => ({
          ...previous,
          [nodeId]: content,
        }));
      } catch (error) {
        setNodeSaveError(store.getState(), nodeId, error, "保存失败，请稍后重试。");
      } finally {
        decrementPendingSaveCount(store.getState(), nodeId);
      }
    },
    [projectId, store, workspaceId, writeFileAux],
  );

  const flushDirtyContent = useCallback(() => {
    if (!activeContentNode) {
      return;
    }

    const { drafts, committedBodies } = store.getState();
    const currentBody = drafts[activeContentNode.id] ?? activeContentNode.body;
    const baseline = committedBodies[activeContentNode.id] ?? activeContentNode.body;
    if (currentBody !== baseline) {
      void flushBodySave(activeContentNode.id, currentBody);
    }
  }, [activeContentNode, flushBodySave, store]);

  const flushDirtyAux = useCallback(
    (timelinePointId = store.getState().activeTimelinePointId) => {
      const { activeAuxPath, drafts, committedBodies } = store.getState();
      if (!activeAuxPath || !timelinePointId) {
        return;
      }

      const auxNode = auxNodeMap.get(activeAuxPath) ?? null;
      if (auxNode?.nodeType !== "file") {
        return;
      }

      const currentContent = drafts[auxNode.id] ?? auxNode.content;
      const baseline = committedBodies[auxNode.id] ?? auxNode.content;
      if (currentContent !== baseline) {
        void flushAuxSave(auxNode.id, currentContent, timelinePointId);
      }
    },
    [auxNodeMap, flushAuxSave, store],
  );

  const expandContentParent = useCallback(
    (parentId: string) => {
      store.getState().setExpandedContentIds((previous) => {
        if (previous.has(parentId)) {
          return previous;
        }

        const next = new Set(previous);
        next.add(parentId);
        return next;
      });
    },
    [store],
  );

  const expandAuxParent = useCallback(
    (parentId: string) => {
      store.getState().setExpandedAuxPaths((previous) => {
        if (previous.has(parentId)) {
          return previous;
        }

        const next = new Set(previous);
        next.add(parentId);
        return next;
      });
    },
    [store],
  );

  const activateContentNode = useCallback(
    (nodeId: string, anchorTimelinePointId: string) => {
      selectContentNode(store.getState(), contentNodeMap, nodeId, anchorTimelinePointId);
    },
    [contentNodeMap, store],
  );

  const flushDirtyContentBeforeSwitch = useCallback(() => {
    flushDirtyAux();

    if (!activeContentNode) {
      return;
    }

    const { drafts, committedBodies } = store.getState();
    const currentBody = drafts[activeContentNode.id] ?? activeContentNode.body;
    const currentBaseline = committedBodies[activeContentNode.id] ?? activeContentNode.body;
    if (currentBody !== currentBaseline) {
      void flushBodySave(activeContentNode.id, currentBody);
    }
  }, [activeContentNode, flushBodySave, flushDirtyAux, store]);

  const handleAuxContentChange = useCallback(
    (nextContent: string) => {
      const { activeAuxPath } = store.getState();
      if (!activeAuxPath) {
        return;
      }

      const auxNode = auxNodeMap.get(activeAuxPath) ?? null;
      if (auxNode?.nodeType !== "file") {
        return;
      }

      const state = store.getState();
      state.setDrafts((previous) => ({
        ...previous,
        [auxNode.id]: nextContent,
      }));
      state.setSaveErrors((previous) => omitRecordKey(previous, auxNode.id));
    },
    [auxNodeMap, store],
  );

  const handleBodyChange = useCallback(
    (nextBody: string) => {
      if (!activeContentNode) {
        return;
      }

      const state = store.getState();
      state.setDrafts((previous) => ({
        ...previous,
        [activeContentNode.id]: nextBody,
      }));
      state.setSaveErrors((previous) => omitRecordKey(previous, activeContentNode.id));
    },
    [activeContentNode, store],
  );

  const clearAuxNodeLocalState = useCallback(
    (nodeIds: Set<string>) => {
      clearNodeLocalState(store, nodeIds);
    },
    [store],
  );

  const clearContentNodeLocalState = useCallback(
    (nodeIds: Set<string>) => {
      clearContentNodeLocalStateRecords(store, nodeIds);
    },
    [store],
  );

  const contentActions = useProjectContentActions({
    projectId,
    workspaceId,
    activeContentNode,
    contentTree,
    flatContentNodes,
    contentNodeMap,
    contentParentMap,
    createContent,
    deleteContent,
    moveContent,
    updateContent,
    store,
    expandContentParent,
    activateContentNode,
    clearContentNodeLocalState,
    flushDirtyContentBeforeSwitch,
  });

  const auxActions = useProjectAuxActions({
    projectId,
    workspaceId,
    auxTree,
    auxRootPath,
    auxNodeMap,
    auxParentMap,
    mkdirAux,
    writeFileAux,
    linkAux,
    moveAux,
    retargetSymlinkAux,
    deleteAux,
    restoreDeletedAux,
    store,
    flushDirtyContent,
    flushAuxSave,
    clearAuxNodeLocalState,
    expandAuxParent,
  });

  const timelineActions = useProjectTimelineActions({
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
  });

  return mergeProjectActionGroups({
    editor: {
      flushBodySave,
      flushAuxSave,
      handleBodyChange,
      handleAuxContentChange,
    },
    content: {
      ...contentActions,
    },
    timeline: {
      ...timelineActions,
      timelineDeleteDialog,
      setActiveTimelinePointId: store.getState().setActiveTimelinePointId,
    },
    aux: {
      ...auxActions,
      setActiveAuxPath: store.getState().setActiveAuxPath,
    },
    misc: {},
  });
}

import { useCallback, useState } from "react";

import {
  actionAnchorId,
  clearActionError,
  setActionError,
} from "@/modules/workspace/ui/editor/model/action-error";
import {
  buildContentNodePath,
  collectAncestorIds,
  collectInvalidAuxSymlinkTargetIds,
  collectContentSubtreeIds,
  findContentDeleteFallback,
  getAuxRenameValidationError,
  listAuxSiblings,
  nextAuxDirName,
  nextAuxFileName,
  nextAuxSymlinkName,
  omitRecordKey,
  resolveAuxHierarchyMove,
  resolveContentCreateSiblingPlacement,
  resolveContentMove,
  type AuxHierarchyMoveIntent,
  type ContentMoveIntent,
} from "@/modules/workspace/ui/editor/model/tree";
import type { AuxTreeNodeVM, ContentTreeNodeVM } from "@/modules/workspace/ui/editor/model/types";
import { ORIGIN_TIMELINE_POINT_ID } from "@/modules/workspace/domain/constants";
import { rpc } from "@/rpc/client";

import { mergeProjectActionGroups } from "../actions/actionGroups";
import { useWorkspaceStoreApi } from "../molecules/workspaceStore";
import type { ProjectWorkspaceState } from "./useProjectWorkspace";

type TimelineDeleteDialogState = {
  pointId: string;
  pointLabel: string;
  auxPaths: string[];
  anchorId: string;
};

function formatTimelineContentAnchorError(
  anchors: ContentTreeNodeVM[],
  contentParentMap: Map<string, string | null>,
  contentNodeMap: Map<string, ContentTreeNodeVM>,
  contentRootId: string | null,
) {
  const paths = anchors.map((node) =>
    buildContentNodePath(node.id, contentParentMap, contentNodeMap, contentRootId),
  );

  if (paths.length === 1) {
    return `无法删除：章节「${paths[0]}」仍锚定在此时间点。`;
  }

  return `无法删除：以下章节仍锚定在此时间点：${paths.map((path) => `「${path}」`).join("、")}。`;
}

export function useProjectActions(workspace: ProjectWorkspaceState) {
  const store = useWorkspaceStoreApi();

  const {
    identity: { workspaceId, contentRootId },
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
      rootId: auxRootId,
      nodeMap: auxNodeMap,
      parentMap: auxParentMap,
      mkdirAux,
      writeFileAux,
      linkAux,
      moveAux,
      retargetSymlinkAux,
      deleteAux,
      restoreAux,
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
        state.setPendingAuxNodeId(null);
        state.setActiveAuxNodeId(null);
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
      state.setPendingSaveCounts((previous) => ({
        ...previous,
        [nodeId]: (previous[nodeId] ?? 0) + 1,
      }));
      state.setSaveErrors((previous) => omitRecordKey(previous, nodeId));

      try {
        await updateContent.mutate({
          workspaceId,
          nodeId,
          body,
        });
        store.getState().setCommittedBodies((previous) => ({
          ...previous,
          [nodeId]: body,
        }));
      } catch (error) {
        store.getState().setSaveErrors((previous) => ({
          ...previous,
          [nodeId]: error instanceof Error ? error.message : "保存失败，请稍后重试。",
        }));
      } finally {
        store.getState().setPendingSaveCounts((previous) => {
          const nextCount = (previous[nodeId] ?? 1) - 1;
          if (nextCount <= 0) {
            return omitRecordKey(previous, nodeId);
          }

          return {
            ...previous,
            [nodeId]: nextCount,
          };
        });
      }
    },
    [store, updateContent, workspaceId],
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
      state.setPendingSaveCounts((previous) => ({
        ...previous,
        [nodeId]: (previous[nodeId] ?? 0) + 1,
      }));
      state.setSaveErrors((previous) => omitRecordKey(previous, nodeId));

      try {
        await writeFileAux.mutate({
          workspaceId,
          timelinePointId,
          nodeId,
          content,
        });
        store.getState().setCommittedBodies((previous) => ({
          ...previous,
          [nodeId]: content,
        }));
      } catch (error) {
        store.getState().setSaveErrors((previous) => ({
          ...previous,
          [nodeId]: error instanceof Error ? error.message : "保存失败，请稍后重试。",
        }));
      } finally {
        store.getState().setPendingSaveCounts((previous) => {
          const nextCount = (previous[nodeId] ?? 1) - 1;
          if (nextCount <= 0) {
            return omitRecordKey(previous, nodeId);
          }

          return {
            ...previous,
            [nodeId]: nextCount,
          };
        });
      }
    },
    [store, workspaceId, writeFileAux],
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
      const { activeAuxNodeId, drafts, committedBodies } = store.getState();
      if (!activeAuxNodeId || !timelinePointId) {
        return;
      }

      const auxNode = auxNodeMap.get(activeAuxNodeId) ?? null;
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

  const toggleContentExpanded = useCallback(
    (nodeId: string) => {
      store.getState().setExpandedContentIds((previous) => {
        const next = new Set(previous);
        if (next.has(nodeId)) {
          next.delete(nodeId);
        } else {
          next.add(nodeId);
        }
        return next;
      });
    },
    [store],
  );

  const toggleAuxExpanded = useCallback(
    (nodeId: string) => {
      store.getState().setExpandedAuxIds((previous) => {
        const next = new Set(previous);
        if (next.has(nodeId)) {
          next.delete(nodeId);
        } else {
          next.add(nodeId);
        }
        return next;
      });
    },
    [store],
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
      store.getState().setExpandedAuxIds((previous) => {
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

  const resolveAuxParentForSibling = useCallback(
    (activeId: string | null): string | null => {
      if (!auxRootId) {
        return null;
      }

      if (!activeId) {
        return auxRootId;
      }

      return auxParentMap.get(activeId) ?? auxRootId;
    },
    [auxParentMap, auxRootId],
  );

  const createAuxDir = useCallback(
    async (parentDirId: string, anchorId: string) => {
      const { activeTimelinePointId, setAuxError } = store.getState();
      if (!workspaceId || !activeTimelinePointId) {
        return;
      }

      const siblings = listAuxSiblings(auxTree, auxNodeMap, parentDirId, auxRootId);
      const name = nextAuxDirName(siblings);

      clearActionError(setAuxError);

      try {
        const node = await mkdirAux.mutate({
          workspaceId,
          timelinePointId: activeTimelinePointId,
          parentDirId,
          name,
        });
        const state = store.getState();
        state.setShouldAutoSelectContent(false);
        state.setPendingContentNodeId(null);
        state.setPendingAuxNodeId(auxNodeMap.has(node.id) ? null : node.id);
        state.setActiveAuxNodeId(node.id);
        expandAuxParent(parentDirId);
      } catch (error) {
        setActionError(
          store.getState().setAuxError,
          error instanceof Error ? error.message : "创建辅助文件夹失败，请稍后重试。",
          anchorId,
        );
      }
    },
    [auxNodeMap, auxRootId, auxTree, expandAuxParent, mkdirAux, store, workspaceId],
  );

  const createAuxFile = useCallback(
    async (parentDirId: string, anchorId: string) => {
      const { activeTimelinePointId, setAuxError } = store.getState();
      if (!workspaceId || !activeTimelinePointId) {
        return;
      }

      const siblings = listAuxSiblings(auxTree, auxNodeMap, parentDirId, auxRootId);
      const name = nextAuxFileName(siblings);

      clearActionError(setAuxError);

      try {
        const node = await writeFileAux.mutate({
          workspaceId,
          timelinePointId: activeTimelinePointId,
          parentDirId,
          name,
          content: "",
        });
        const state = store.getState();
        state.setShouldAutoSelectContent(false);
        state.setPendingContentNodeId(null);
        state.setPendingAuxNodeId(auxNodeMap.has(node.id) ? null : node.id);
        state.setActiveAuxNodeId(node.id);
        expandAuxParent(parentDirId);
      } catch (error) {
        setActionError(
          store.getState().setAuxError,
          error instanceof Error ? error.message : "创建辅助文件失败，请稍后重试。",
          anchorId,
        );
      }
    },
    [auxNodeMap, auxRootId, auxTree, expandAuxParent, store, workspaceId, writeFileAux],
  );

  const createAuxSymlink = useCallback(
    async (parentDirId: string, targetNodeId: string, targetName: string, anchorId: string) => {
      const { activeTimelinePointId, setAuxError } = store.getState();
      if (!workspaceId || !activeTimelinePointId) {
        return;
      }

      const siblings = listAuxSiblings(auxTree, auxNodeMap, parentDirId, auxRootId);
      const name = nextAuxSymlinkName(siblings, targetName);

      clearActionError(setAuxError);

      try {
        const node = await linkAux.mutate({
          workspaceId,
          timelinePointId: activeTimelinePointId,
          parentDirId,
          name,
          targetNodeId,
        });
        const state = store.getState();
        state.setShouldAutoSelectContent(false);
        state.setPendingContentNodeId(null);
        state.setPendingAuxNodeId(auxNodeMap.has(node.id) ? null : node.id);
        state.setActiveAuxNodeId(node.id);
        expandAuxParent(parentDirId);
      } catch (error) {
        setActionError(
          store.getState().setAuxError,
          error instanceof Error ? error.message : "创建辅助符号链接失败，请稍后重试。",
          anchorId,
        );
      }
    },
    [auxNodeMap, auxRootId, auxTree, expandAuxParent, linkAux, store, workspaceId],
  );

  const exitAuxSymlinkTargetPicker = useCallback(() => {
    const state = store.getState();
    state.setIsAuxSymlinkTargetPickerActive(false);
    state.setAuxSymlinkTargetPickerSourceId(null);
  }, [store]);

  const enterAuxSymlinkTargetPicker = useCallback(
    (nodeId: string) => {
      const node = auxNodeMap.get(nodeId) ?? null;
      if (node?.nodeType !== "symlink" || node.isDeleted) {
        return;
      }

      clearActionError(store.getState().setAuxError);
      store.getState().setExpandedAuxIds((previous) => {
        const targetId = node.symlinkTargetAuxNodeId;
        if (!targetId) {
          return previous;
        }

        const next = new Set(previous);
        let changed = false;
        for (const ancestorId of collectAncestorIds(auxParentMap, targetId)) {
          if (!next.has(ancestorId)) {
            next.add(ancestorId);
            changed = true;
          }
        }
        return changed ? next : previous;
      });

      const state = store.getState();
      state.setShouldAutoSelectContent(false);
      state.setPendingContentNodeId(null);
      state.setActiveContentNodeId(null);
      state.setPendingAuxNodeId(null);
      state.setActiveAuxNodeId(node.id);
      state.setAuxSymlinkTargetPickerSourceId(node.id);
      state.setIsAuxSymlinkTargetPickerActive(true);
    },
    [auxNodeMap, auxParentMap, store],
  );

  const cancelAuxSymlinkTargetPicker = useCallback(() => {
    exitAuxSymlinkTargetPicker();
  }, [exitAuxSymlinkTargetPicker]);

  const submitAuxSymlinkTargetRetarget = useCallback(
    async (targetNodeId: string) => {
      const state = store.getState();
      const {
        activeTimelinePointId,
        auxSymlinkTargetPickerSourceId,
        setAuxError,
        isAuxSymlinkTargetPickerActive,
      } = state;
      if (
        !workspaceId ||
        !activeTimelinePointId ||
        !isAuxSymlinkTargetPickerActive ||
        !auxSymlinkTargetPickerSourceId
      ) {
        return;
      }

      const source = auxNodeMap.get(auxSymlinkTargetPickerSourceId) ?? null;
      if (source?.nodeType !== "symlink" || source.isDeleted) {
        exitAuxSymlinkTargetPicker();
        return;
      }

      if (source.symlinkTargetAuxNodeId === targetNodeId) {
        return;
      }

      const invalidTargetIds = collectInvalidAuxSymlinkTargetIds(auxNodeMap, source.id);
      if (invalidTargetIds.has(targetNodeId)) {
        return;
      }

      clearActionError(setAuxError);

      try {
        await retargetSymlinkAux.mutate({
          workspaceId,
          timelinePointId: activeTimelinePointId,
          symlinkNodeId: source.id,
          targetNodeId,
        });
        const nextState = store.getState();
        nextState.setShouldAutoSelectContent(false);
        nextState.setPendingContentNodeId(null);
        nextState.setActiveContentNodeId(null);
        nextState.setPendingAuxNodeId(null);
        nextState.setActiveAuxNodeId(source.id);
        exitAuxSymlinkTargetPicker();
      } catch (error) {
        setActionError(
          store.getState().setAuxError,
          error instanceof Error ? error.message : "更新符号链接目标失败，请稍后重试。",
          actionAnchorId("aux", "row", source.id),
        );
      }
    },
    [auxNodeMap, exitAuxSymlinkTargetPicker, retargetSymlinkAux, store, workspaceId],
  );

  const activateContentNode = useCallback(
    (nodeId: string, anchorTimelinePointId: string) => {
      const state = store.getState();
      state.setShouldAutoSelectContent(true);
      state.setPendingAuxNodeId(null);
      state.setActiveAuxNodeId(null);
      state.setPendingContentNodeId(contentNodeMap.has(nodeId) ? null : nodeId);
      state.setActiveContentNodeId(nodeId);
      state.setActiveTimelinePointId(anchorTimelinePointId);
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

  const handleContentSelect = useCallback(
    (node: ContentTreeNodeVM) => {
      if (activeContentNode?.id !== node.id) {
        flushDirtyContentBeforeSwitch();
      }

      activateContentNode(node.id, node.anchorTimelinePointId);
    },
    [activateContentNode, activeContentNode, flushDirtyContentBeforeSwitch],
  );

  const handleAuxSelect = useCallback(
    (node: AuxTreeNodeVM) => {
      flushDirtyContent();

      const { activeAuxNodeId, drafts, committedBodies } = store.getState();
      if (activeAuxNodeId && activeAuxNodeId !== node.id) {
        const previousNode = auxNodeMap.get(activeAuxNodeId) ?? null;
        if (previousNode?.nodeType === "file") {
          const currentContent = drafts[previousNode.id] ?? previousNode.content;
          const baseline = committedBodies[previousNode.id] ?? previousNode.content;
          if (currentContent !== baseline) {
            void flushAuxSave(previousNode.id, currentContent);
          }
        }
      }

      const state = store.getState();
      state.setShouldAutoSelectContent(false);
      state.setPendingContentNodeId(null);
      state.setActiveContentNodeId(null);
      state.setPendingAuxNodeId(auxNodeMap.has(node.id) ? null : node.id);
      state.setActiveAuxNodeId(node.id);
    },
    [auxNodeMap, flushAuxSave, flushDirtyContent, store],
  );

  const handleAuxContentChange = useCallback(
    (nextContent: string) => {
      const { activeAuxNodeId } = store.getState();
      if (!activeAuxNodeId) {
        return;
      }

      const auxNode = auxNodeMap.get(activeAuxNodeId) ?? null;
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

  const handleTimelineSelect = useCallback(
    (pointId: string) => {
      const { activeTimelinePointId, activeAuxNodeId } = store.getState();
      if (pointId === activeTimelinePointId) {
        return;
      }

      flushDirtyAux(activeTimelinePointId ?? undefined);

      if (activeAuxNodeId) {
        const state = store.getState();
        state.setDrafts((previous) => omitRecordKey(previous, activeAuxNodeId));
        state.setCommittedBodies((previous) => omitRecordKey(previous, activeAuxNodeId));
        state.setPendingSaveCounts((previous) => omitRecordKey(previous, activeAuxNodeId));
        state.setSaveErrors((previous) => omitRecordKey(previous, activeAuxNodeId));
      }

      store.getState().setActiveTimelinePointId(pointId);
    },
    [flushDirtyAux, store],
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
      const omitMany = <TValue>(record: Record<string, TValue>) => {
        let changed = false;
        const next = { ...record };

        for (const nodeId of nodeIds) {
          if (nodeId in next) {
            delete next[nodeId];
            changed = true;
          }
        }

        return changed ? next : record;
      };

      const state = store.getState();
      state.setDrafts((previous) => omitMany(previous));
      state.setCommittedBodies((previous) => omitMany(previous));
      state.setPendingSaveCounts((previous) => omitMany(previous));
      state.setSaveErrors((previous) => omitMany(previous));
    },
    [store],
  );

  const clearContentNodeLocalState = useCallback(
    (nodeIds: Set<string>) => {
      const omitMany = <TValue>(record: Record<string, TValue>) => {
        let changed = false;
        const next = { ...record };

        for (const nodeId of nodeIds) {
          if (nodeId in next) {
            delete next[nodeId];
            changed = true;
          }
        }

        return changed ? next : record;
      };

      const state = store.getState();
      state.setDrafts((previous) => omitMany(previous));
      state.setCommittedBodies((previous) => omitMany(previous));
      state.setPendingSaveCounts((previous) => omitMany(previous));
      state.setSaveErrors((previous) => omitMany(previous));
      state.setExpandedContentIds((previous) => {
        let changed = false;
        const next = new Set(previous);

        for (const nodeId of nodeIds) {
          if (next.delete(nodeId)) {
            changed = true;
          }
        }

        return changed ? next : previous;
      });
    },
    [store],
  );

  const handleContentCreateSibling = useCallback(
    async (anchorId: string) => {
      const { activeTimelinePointId, setContentError } = store.getState();
      if (!workspaceId || !contentRootId || !activeTimelinePointId) {
        return;
      }

      const anchorPointId = activeTimelinePointId;
      const { parentId, afterSiblingId } = resolveContentCreateSiblingPlacement({
        activeNode: activeContentNode,
        tree: contentTree,
        parentMap: contentParentMap,
        contentRootId,
      });
      const title = `新节点 ${flatContentNodes.length + 1}`;

      clearActionError(setContentError);

      try {
        const node = await createContent.mutate({
          workspaceId,
          parentId,
          afterSiblingId,
          anchorPointId,
          title,
        });
        flushDirtyContentBeforeSwitch();
        activateContentNode(node.id, node.anchorTimelinePointId ?? ORIGIN_TIMELINE_POINT_ID);
        expandContentParent(parentId);
      } catch (error) {
        setActionError(
          store.getState().setContentError,
          error instanceof Error ? error.message : "创建正文节点失败，请稍后重试。",
          anchorId,
        );
      }
    },
    [
      activateContentNode,
      activeContentNode,
      contentTree,
      contentParentMap,
      contentRootId,
      createContent,
      expandContentParent,
      flatContentNodes.length,
      flushDirtyContentBeforeSwitch,
      store,
      workspaceId,
    ],
  );

  const handleContentCreateChild = useCallback(
    async (parentNode: ContentTreeNodeVM, anchorId: string) => {
      const { activeTimelinePointId, setContentError } = store.getState();
      if (!workspaceId || !activeTimelinePointId) {
        return;
      }

      const title = `新节点 ${flatContentNodes.length + 1}`;
      const lastChild = parentNode.children.at(-1);

      clearActionError(setContentError);

      try {
        const node = await createContent.mutate({
          workspaceId,
          parentId: parentNode.id,
          afterSiblingId: lastChild?.id,
          anchorPointId: activeTimelinePointId,
          title,
        });
        flushDirtyContentBeforeSwitch();
        activateContentNode(node.id, node.anchorTimelinePointId ?? ORIGIN_TIMELINE_POINT_ID);
        expandContentParent(parentNode.id);
      } catch (error) {
        setActionError(
          store.getState().setContentError,
          error instanceof Error ? error.message : "创建正文节点失败，请稍后重试。",
          anchorId,
        );
      }
    },
    [
      activateContentNode,
      createContent,
      expandContentParent,
      flatContentNodes.length,
      flushDirtyContentBeforeSwitch,
      store,
      workspaceId,
    ],
  );

  const handleContentDelete = useCallback(
    async (nodeId: string, anchorId: string) => {
      if (!workspaceId) {
        return;
      }

      const targetNode = contentNodeMap.get(nodeId) ?? null;
      if (!targetNode) {
        return;
      }

      const { activeContentNodeId, setContentError } = store.getState();
      const deletedIds = collectContentSubtreeIds(targetNode);
      const shouldReselect = Boolean(activeContentNodeId && deletedIds.has(activeContentNodeId));
      const fallbackNode = shouldReselect
        ? findContentDeleteFallback(
            contentTree,
            contentParentMap,
            contentRootId,
            nodeId,
            deletedIds,
          )
        : null;

      clearActionError(setContentError);

      try {
        await deleteContent.mutate({ workspaceId, nodeId });
        clearContentNodeLocalState(deletedIds);
        if (shouldReselect) {
          if (fallbackNode) {
            activateContentNode(fallbackNode.id, fallbackNode.anchorTimelinePointId);
          } else {
            const state = store.getState();
            state.setShouldAutoSelectContent(false);
            state.setPendingContentNodeId(null);
            state.setActiveContentNodeId(null);
          }
        }
      } catch (error) {
        setActionError(
          store.getState().setContentError,
          error instanceof Error ? error.message : "删除正文节点失败，请稍后重试。",
          anchorId,
        );
      }
    },
    [
      activateContentNode,
      clearContentNodeLocalState,
      contentNodeMap,
      contentParentMap,
      contentRootId,
      contentTree,
      deleteContent,
      store,
      workspaceId,
    ],
  );

  const handleContentAnchorSet = useCallback(
    async (pointId: string, anchorId: string) => {
      if (!workspaceId || !activeContentNode) {
        return;
      }

      if (pointId === activeContentNode.anchorTimelinePointId) {
        return;
      }

      clearActionError(store.getState().setContentError);

      try {
        await updateContent.mutate({
          workspaceId,
          nodeId: activeContentNode.id,
          anchorPointId: pointId,
        });
        store.getState().setActiveTimelinePointId(pointId);
      } catch (error) {
        setActionError(
          store.getState().setContentError,
          error instanceof Error ? error.message : "设置时间锚点失败，请稍后重试。",
          anchorId,
        );
      }
    },
    [activeContentNode, store, updateContent, workspaceId],
  );

  const handleContentRename = useCallback(
    async (nodeId: string, title: string | null) => {
      if (!workspaceId) {
        return false;
      }

      clearActionError(store.getState().setContentError);

      try {
        await updateContent.mutate({
          workspaceId,
          nodeId,
          title,
        });
        return true;
      } catch (error) {
        setActionError(
          store.getState().setContentError,
          error instanceof Error ? error.message : "重命名正文节点失败，请稍后重试。",
          actionAnchorId("content", "row", nodeId),
        );
        return false;
      }
    },
    [store, updateContent, workspaceId],
  );

  const handleContentMove = useCallback(
    async (intent: ContentMoveIntent) => {
      if (!workspaceId || !contentRootId) {
        return;
      }

      const move = resolveContentMove({
        tree: contentTree,
        parentMap: contentParentMap,
        nodeMap: contentNodeMap,
        contentRootId,
        ...intent,
      });

      if (!move) {
        return;
      }

      clearActionError(store.getState().setContentError);

      if (move.position === "inside") {
        expandContentParent(move.newParentId);
      }

      try {
        await moveContent.mutate({
          workspaceId,
          nodeId: move.nodeId,
          newParentId: move.newParentId,
          afterSiblingId: move.afterSiblingId,
        });
      } catch (error) {
        setActionError(
          store.getState().setContentError,
          error instanceof Error ? error.message : "调整正文顺序失败，请稍后重试。",
          actionAnchorId("content", "row", move.nodeId),
        );
      }
    },
    [
      contentNodeMap,
      contentParentMap,
      contentRootId,
      contentTree,
      expandContentParent,
      moveContent,
      store,
      workspaceId,
    ],
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
    [store, updateTimeline, workspaceId],
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
    [createTimeline, store, timelinePoints, workspaceId],
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
    [moveTimeline, store, timelinePoints, workspaceId],
  );

  const handleAuxCreateSiblingDir = useCallback(
    async (anchorId: string) => {
      const parentDirId = resolveAuxParentForSibling(store.getState().activeAuxNodeId);
      if (!parentDirId) {
        return;
      }

      await createAuxDir(parentDirId, anchorId);
    },
    [createAuxDir, resolveAuxParentForSibling, store],
  );

  const handleAuxCreateSiblingFile = useCallback(
    async (anchorId: string) => {
      const parentDirId = resolveAuxParentForSibling(store.getState().activeAuxNodeId);
      if (!parentDirId) {
        return;
      }

      await createAuxFile(parentDirId, anchorId);
    },
    [createAuxFile, resolveAuxParentForSibling, store],
  );

  const handleAuxCreateChildDir = useCallback(
    async (parentNode: AuxTreeNodeVM, anchorId: string) => {
      if (parentNode.nodeType !== "dir") {
        return;
      }

      await createAuxDir(parentNode.id, anchorId);
    },
    [createAuxDir],
  );

  const handleAuxCreateChildFile = useCallback(
    async (parentNode: AuxTreeNodeVM, anchorId: string) => {
      if (parentNode.nodeType !== "dir") {
        return;
      }

      await createAuxFile(parentNode.id, anchorId);
    },
    [createAuxFile],
  );

  const handleAuxCreateSymlink = useCallback(
    async (node: AuxTreeNodeVM, anchorId: string) => {
      const parentDirId = auxParentMap.get(node.id) ?? auxRootId;
      if (!parentDirId) {
        return;
      }

      await createAuxSymlink(parentDirId, node.id, node.name, anchorId);
    },
    [auxParentMap, auxRootId, createAuxSymlink],
  );

  const handleAuxRename = useCallback(
    async (nodeId: string, name: string) => {
      const { activeTimelinePointId, setAuxError } = store.getState();
      if (!workspaceId || !activeTimelinePointId) {
        return false;
      }

      const parentDirId = auxParentMap.get(nodeId) ?? auxRootId;
      if (!parentDirId) {
        return false;
      }

      const normalized = name.trim();
      const anchorId = actionAnchorId("aux", "row", nodeId);
      const validationError = getAuxRenameValidationError({
        tree: auxTree,
        nodeMap: auxNodeMap,
        parentMap: auxParentMap,
        auxRootId,
        nodeId,
        name,
      });
      if (validationError) {
        setActionError(setAuxError, validationError, anchorId);
        return false;
      }

      clearActionError(setAuxError);

      try {
        await moveAux.mutate({
          workspaceId,
          timelinePointId: activeTimelinePointId,
          nodeId,
          newParentDirId: parentDirId,
          newName: normalized,
        });
        return true;
      } catch (error) {
        setActionError(
          store.getState().setAuxError,
          error instanceof Error ? error.message : "重命名辅助节点失败，请稍后重试。",
          anchorId,
        );
        return false;
      }
    },
    [auxNodeMap, auxParentMap, auxRootId, auxTree, moveAux, store, workspaceId],
  );

  const handleAuxMove = useCallback(
    async (intent: AuxHierarchyMoveIntent) => {
      const { activeTimelinePointId, setAuxError } = store.getState();
      if (!workspaceId || !activeTimelinePointId || !auxRootId) {
        return;
      }

      const move = resolveAuxHierarchyMove({
        parentMap: auxParentMap,
        nodeMap: auxNodeMap,
        auxRootId,
        ...intent,
      });
      if (!move) {
        return;
      }

      const node = auxNodeMap.get(move.nodeId);
      if (!node) {
        return;
      }

      clearActionError(setAuxError);

      if (move.newParentId !== auxRootId) {
        expandAuxParent(move.newParentId);
      }

      try {
        await moveAux.mutate({
          workspaceId,
          timelinePointId: activeTimelinePointId,
          nodeId: move.nodeId,
          newParentDirId: move.newParentId,
          newName: node.name.trim() || node.name,
        });
      } catch (error) {
        setActionError(
          store.getState().setAuxError,
          error instanceof Error ? error.message : "调整辅助信息层级失败，请稍后重试。",
          actionAnchorId("aux", "row", move.nodeId),
        );
      }
    },
    [auxNodeMap, auxParentMap, auxRootId, expandAuxParent, moveAux, store, workspaceId],
  );

  const handleAuxDelete = useCallback(
    async (nodeId: string, anchorId: string) => {
      const { activeTimelinePointId, setAuxError } = store.getState();
      if (!workspaceId || !activeTimelinePointId) {
        return;
      }

      clearActionError(setAuxError);

      try {
        await deleteAux.mutate({
          workspaceId,
          timelinePointId: activeTimelinePointId,
          nodeId,
        });
        clearAuxNodeLocalState(new Set([nodeId]));
        const state = store.getState();
        if (state.activeAuxNodeId === nodeId) {
          state.setShouldAutoSelectContent(false);
          state.setPendingContentNodeId(null);
          state.setActiveContentNodeId(null);
          if (activeTimelinePointId === ORIGIN_TIMELINE_POINT_ID) {
            state.setPendingAuxNodeId(null);
            state.setActiveAuxNodeId(null);
          }
        }
      } catch (error) {
        setActionError(
          store.getState().setAuxError,
          error instanceof Error ? error.message : "删除辅助节点失败，请稍后重试。",
          anchorId,
        );
      }
    },
    [clearAuxNodeLocalState, deleteAux, store, workspaceId],
  );

  const handleAuxRestore = useCallback(
    async (nodeId: string, anchorId: string) => {
      const { activeTimelinePointId, setAuxError } = store.getState();
      if (!workspaceId || !activeTimelinePointId) {
        return;
      }

      clearActionError(setAuxError);

      try {
        await restoreAux.mutate({
          workspaceId,
          timelinePointId: activeTimelinePointId,
          nodeId,
        });
        clearAuxNodeLocalState(new Set([nodeId]));
      } catch (error) {
        setActionError(
          store.getState().setAuxError,
          error instanceof Error ? error.message : "恢复辅助节点失败，请稍后重试。",
          anchorId,
        );
      }
    },
    [clearAuxNodeLocalState, restoreAux, store, workspaceId],
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
          formatTimelineContentAnchorError(
            anchoredNodes,
            contentParentMap,
            contentNodeMap,
            contentRootId,
          ),
          anchorId,
        );
        return;
      }

      try {
        const { data: auxChanges } = await rpc.callQuery("aux.listChangesAt", {
          workspaceId,
          pointId,
        });
        const pointLabel = timelinePoints.find((point) => point.id === pointId)?.label ?? pointId;

        if ((auxChanges?.length ?? 0) > 0) {
          setTimelineDeleteDialog({
            pointId,
            pointLabel,
            auxPaths: (auxChanges ?? []).map((change: { path: string; isDeleted?: boolean }) =>
              change.isDeleted ? `${change.path}（已删除）` : change.path,
            ),
            anchorId,
          });
          return;
        }

        await deleteTimeline.mutate({
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
      contentRootId,
      deleteTimeline,
      finishTimelineDelete,
      flatContentNodes,
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
  }, [deleteTimeline.isPending]);

  const handleTimelineDeleteConfirm = useCallback(async () => {
    if (!workspaceId || !timelineDeleteDialog) {
      return;
    }

    const { pointId, anchorId } = timelineDeleteDialog;
    clearActionError(store.getState().setTimelineError);

    try {
      await deleteTimeline.mutate({
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
  }, [deleteTimeline, finishTimelineDelete, store, timelineDeleteDialog, workspaceId]);

  return mergeProjectActionGroups({
    editor: {
      flushBodySave,
      flushAuxSave,
      handleBodyChange,
      handleAuxContentChange,
    },
    content: {
      toggleContentExpanded,
      handleContentSelect,
      handleContentRename,
      handleContentAnchorSet,
      handleContentCreateSibling,
      handleContentCreateChild,
      handleContentDelete,
      handleContentMove,
    },
    timeline: {
      handleTimelineSelect,
      handleTimelineAdd,
      handleTimelineRename,
      handleTimelineMove,
      handleTimelineDelete,
      handleTimelineDeleteCancel,
      handleTimelineDeleteConfirm,
      timelineDeleteDialog,
      setActiveTimelinePointId: store.getState().setActiveTimelinePointId,
    },
    aux: {
      toggleAuxExpanded,
      handleAuxSelect,
      handleAuxCreateSiblingDir,
      handleAuxCreateSiblingFile,
      handleAuxCreateChildDir,
      handleAuxCreateChildFile,
      handleAuxCreateSymlink,
      enterAuxSymlinkTargetPicker,
      cancelAuxSymlinkTargetPicker,
      submitAuxSymlinkTargetRetarget,
      handleAuxRename,
      handleAuxMove,
      handleAuxDelete,
      handleAuxRestore,
      setActiveAuxNodeId: store.getState().setActiveAuxNodeId,
    },
    misc: {},
  });
}

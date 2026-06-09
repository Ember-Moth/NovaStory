import { useMolecule } from "bunshi/react";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useState } from "react";

import {
  actionAnchorId,
  clearActionError,
  setActionError,
} from "@/features/project/model/action-error";
import {
  buildContentNodePath,
  collectContentSubtreeIds,
  findContentDeleteFallback,
  getAuxRenameValidationError,
  listAuxSiblings,
  nextAuxDirName,
  nextAuxFileName,
  omitRecordKey,
  resolveContentCreateSiblingPlacement,
  resolveContentMove,
  type ContentMoveIntent,
} from "@/features/project/model/tree";
import type { AuxTreeNodeVM, ContentTreeNodeVM } from "@/features/project/model/types";
import { rpc } from "@/server/rpc/client";
import { ORIGIN_TIMELINE_POINT_ID } from "@/shared/constants";

import { EditorMolecule } from "../molecules/editor";
import { ErrorsMolecule } from "../molecules/errors";
import { SelectionMolecule } from "../molecules/selection";
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
  const selection = useMolecule(SelectionMolecule);
  const editor = useMolecule(EditorMolecule);
  const errors = useMolecule(ErrorsMolecule);

  const activeContentNodeId = useAtomValue(selection.activeContentNodeIdAtom);
  const setActiveContentNodeId = useSetAtom(selection.activeContentNodeIdAtom);
  const activeAuxNodeId = useAtomValue(selection.activeAuxNodeIdAtom);
  const setActiveAuxNodeId = useSetAtom(selection.activeAuxNodeIdAtom);
  const setPendingContentNodeId = useSetAtom(selection.pendingContentNodeIdAtom);
  const setPendingAuxNodeId = useSetAtom(selection.pendingAuxNodeIdAtom);
  const setShouldAutoSelectContent = useSetAtom(selection.shouldAutoSelectContentAtom);
  const activeTimelinePointId = useAtomValue(selection.activeTimelinePointIdAtom);
  const setActiveTimelinePointId = useSetAtom(selection.activeTimelinePointIdAtom);
  const setExpandedContentIds = useSetAtom(selection.expandedContentIdsAtom);
  const setExpandedAuxIds = useSetAtom(selection.expandedAuxIdsAtom);
  const drafts = useAtomValue(editor.draftsAtom);
  const setDrafts = useSetAtom(editor.draftsAtom);
  const committedBodies = useAtomValue(editor.committedBodiesAtom);
  const setCommittedBodies = useSetAtom(editor.committedBodiesAtom);
  const setPendingSaveCounts = useSetAtom(editor.pendingSaveCountsAtom);
  const setSaveErrors = useSetAtom(editor.saveErrorsAtom);
  const setContentError = useSetAtom(errors.contentErrorAtom);
  const setTimelineError = useSetAtom(errors.timelineErrorAtom);
  const setAuxError = useSetAtom(errors.auxErrorAtom);

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
      reorderTimelineOptimistically,
      clearOptimisticTimelineReorder,
    },
    aux: {
      tree: auxTree,
      rootId: auxRootId,
      nodeMap: auxNodeMap,
      parentMap: auxParentMap,
      mkdirAux,
      writeFileAux,
      moveAux,
      deleteAux,
      restoreAux,
    },
    selection: { activeContentNode },
  } = workspace;

  const [timelineDeleteDialog, setTimelineDeleteDialog] =
    useState<TimelineDeleteDialogState | null>(null);

  const finishTimelineDelete = useCallback(
    (pointId: string) => {
      if (activeTimelinePointId === pointId) {
        setActiveTimelinePointId(ORIGIN_TIMELINE_POINT_ID);
        setPendingAuxNodeId(null);
        setActiveAuxNodeId(null);
      }
    },
    [activeTimelinePointId, setActiveAuxNodeId, setActiveTimelinePointId, setPendingAuxNodeId],
  );

  const flushBodySave = useCallback(
    async (nodeId: string, body: string) => {
      if (!workspaceId) {
        return;
      }

      setPendingSaveCounts((previous) => ({
        ...previous,
        [nodeId]: (previous[nodeId] ?? 0) + 1,
      }));
      setSaveErrors((previous) => omitRecordKey(previous, nodeId));

      try {
        await updateContent.mutate({
          workspaceId,
          nodeId,
          body,
        });
        setCommittedBodies((previous) => ({
          ...previous,
          [nodeId]: body,
        }));
      } catch (error) {
        setSaveErrors((previous) => ({
          ...previous,
          [nodeId]: error instanceof Error ? error.message : "保存失败，请稍后重试。",
        }));
      } finally {
        setPendingSaveCounts((previous) => {
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
    [setCommittedBodies, setPendingSaveCounts, setSaveErrors, updateContent, workspaceId],
  );

  const flushAuxSave = useCallback(
    async (nodeId: string, content: string, timelinePointId = activeTimelinePointId) => {
      if (!workspaceId || !timelinePointId) {
        return;
      }

      setPendingSaveCounts((previous) => ({
        ...previous,
        [nodeId]: (previous[nodeId] ?? 0) + 1,
      }));
      setSaveErrors((previous) => omitRecordKey(previous, nodeId));

      try {
        await writeFileAux.mutate({
          workspaceId,
          timelinePointId,
          nodeId,
          content,
        });
        setCommittedBodies((previous) => ({
          ...previous,
          [nodeId]: content,
        }));
      } catch (error) {
        setSaveErrors((previous) => ({
          ...previous,
          [nodeId]: error instanceof Error ? error.message : "保存失败，请稍后重试。",
        }));
      } finally {
        setPendingSaveCounts((previous) => {
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
    [
      activeTimelinePointId,
      setCommittedBodies,
      setPendingSaveCounts,
      setSaveErrors,
      workspaceId,
      writeFileAux,
    ],
  );

  const flushDirtyContent = useCallback(() => {
    if (!activeContentNode) {
      return;
    }

    const currentBody = drafts[activeContentNode.id] ?? activeContentNode.body;
    const baseline = committedBodies[activeContentNode.id] ?? activeContentNode.body;
    if (currentBody !== baseline) {
      void flushBodySave(activeContentNode.id, currentBody);
    }
  }, [activeContentNode, committedBodies, drafts, flushBodySave]);

  const flushDirtyAux = useCallback(
    (timelinePointId = activeTimelinePointId) => {
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
    [activeAuxNodeId, activeTimelinePointId, auxNodeMap, committedBodies, drafts, flushAuxSave],
  );

  const toggleContentExpanded = useCallback(
    (nodeId: string) => {
      setExpandedContentIds((previous) => {
        const next = new Set(previous);
        if (next.has(nodeId)) {
          next.delete(nodeId);
        } else {
          next.add(nodeId);
        }
        return next;
      });
    },
    [setExpandedContentIds],
  );

  const toggleAuxExpanded = useCallback(
    (nodeId: string) => {
      setExpandedAuxIds((previous) => {
        const next = new Set(previous);
        if (next.has(nodeId)) {
          next.delete(nodeId);
        } else {
          next.add(nodeId);
        }
        return next;
      });
    },
    [setExpandedAuxIds],
  );

  const expandContentParent = useCallback(
    (parentId: string) => {
      setExpandedContentIds((previous) => {
        if (previous.has(parentId)) {
          return previous;
        }

        const next = new Set(previous);
        next.add(parentId);
        return next;
      });
    },
    [setExpandedContentIds],
  );

  const expandAuxParent = useCallback(
    (parentId: string) => {
      setExpandedAuxIds((previous) => {
        if (previous.has(parentId)) {
          return previous;
        }

        const next = new Set(previous);
        next.add(parentId);
        return next;
      });
    },
    [setExpandedAuxIds],
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
        setShouldAutoSelectContent(false);
        setPendingContentNodeId(null);
        setPendingAuxNodeId(auxNodeMap.has(node.id) ? null : node.id);
        setActiveAuxNodeId(node.id);
        expandAuxParent(parentDirId);
      } catch (error) {
        setActionError(
          setAuxError,
          error instanceof Error ? error.message : "创建辅助文件夹失败，请稍后重试。",
          anchorId,
        );
      }
    },
    [
      activeTimelinePointId,
      auxNodeMap,
      auxRootId,
      auxTree,
      expandAuxParent,
      mkdirAux,
      setActiveAuxNodeId,
      setAuxError,
      setPendingAuxNodeId,
      setPendingContentNodeId,
      setShouldAutoSelectContent,
      workspaceId,
    ],
  );

  const createAuxFile = useCallback(
    async (parentDirId: string, anchorId: string) => {
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
        setShouldAutoSelectContent(false);
        setPendingContentNodeId(null);
        setPendingAuxNodeId(auxNodeMap.has(node.id) ? null : node.id);
        setActiveAuxNodeId(node.id);
        expandAuxParent(parentDirId);
      } catch (error) {
        setActionError(
          setAuxError,
          error instanceof Error ? error.message : "创建辅助文件失败，请稍后重试。",
          anchorId,
        );
      }
    },
    [
      activeTimelinePointId,
      auxNodeMap,
      auxRootId,
      auxTree,
      expandAuxParent,
      setActiveAuxNodeId,
      setAuxError,
      setPendingAuxNodeId,
      setPendingContentNodeId,
      setShouldAutoSelectContent,
      workspaceId,
      writeFileAux,
    ],
  );

  const activateContentNode = useCallback(
    (nodeId: string, anchorTimelinePointId: string) => {
      setShouldAutoSelectContent(true);
      setPendingAuxNodeId(null);
      setActiveAuxNodeId(null);
      setPendingContentNodeId(contentNodeMap.has(nodeId) ? null : nodeId);
      setActiveContentNodeId(nodeId);
      setActiveTimelinePointId(anchorTimelinePointId);
    },
    [
      contentNodeMap,
      setActiveAuxNodeId,
      setActiveContentNodeId,
      setActiveTimelinePointId,
      setPendingAuxNodeId,
      setPendingContentNodeId,
      setShouldAutoSelectContent,
    ],
  );

  const flushDirtyContentBeforeSwitch = useCallback(() => {
    flushDirtyAux();

    if (!activeContentNode) {
      return;
    }

    const currentBody = drafts[activeContentNode.id] ?? activeContentNode.body;
    const currentBaseline = committedBodies[activeContentNode.id] ?? activeContentNode.body;
    if (currentBody !== currentBaseline) {
      void flushBodySave(activeContentNode.id, currentBody);
    }
  }, [activeContentNode, committedBodies, drafts, flushBodySave, flushDirtyAux]);

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

      setShouldAutoSelectContent(false);
      setPendingContentNodeId(null);
      setActiveContentNodeId(null);
      setPendingAuxNodeId(auxNodeMap.has(node.id) ? null : node.id);
      setActiveAuxNodeId(node.id);
    },
    [
      activeAuxNodeId,
      auxNodeMap,
      committedBodies,
      drafts,
      flushAuxSave,
      flushDirtyContent,
      setActiveAuxNodeId,
      setActiveContentNodeId,
      setPendingAuxNodeId,
      setPendingContentNodeId,
      setShouldAutoSelectContent,
    ],
  );

  const handleAuxContentChange = useCallback(
    (nextContent: string) => {
      if (!activeAuxNodeId) {
        return;
      }

      const auxNode = auxNodeMap.get(activeAuxNodeId) ?? null;
      if (auxNode?.nodeType !== "file") {
        return;
      }

      setDrafts((previous) => ({
        ...previous,
        [auxNode.id]: nextContent,
      }));
      setSaveErrors((previous) => omitRecordKey(previous, auxNode.id));
    },
    [activeAuxNodeId, auxNodeMap, setDrafts, setSaveErrors],
  );

  const handleTimelineSelect = useCallback(
    (pointId: string) => {
      if (pointId === activeTimelinePointId) {
        return;
      }

      flushDirtyAux(activeTimelinePointId ?? undefined);

      if (activeAuxNodeId) {
        setDrafts((previous) => omitRecordKey(previous, activeAuxNodeId));
        setCommittedBodies((previous) => omitRecordKey(previous, activeAuxNodeId));
        setPendingSaveCounts((previous) => omitRecordKey(previous, activeAuxNodeId));
        setSaveErrors((previous) => omitRecordKey(previous, activeAuxNodeId));
      }

      setActiveTimelinePointId(pointId);
    },
    [
      activeAuxNodeId,
      activeTimelinePointId,
      flushDirtyAux,
      setActiveTimelinePointId,
      setCommittedBodies,
      setDrafts,
      setPendingSaveCounts,
      setSaveErrors,
    ],
  );

  const handleBodyChange = useCallback(
    (nextBody: string) => {
      if (!activeContentNode) {
        return;
      }

      setDrafts((previous) => ({
        ...previous,
        [activeContentNode.id]: nextBody,
      }));
      setSaveErrors((previous) => omitRecordKey(previous, activeContentNode.id));
    },
    [activeContentNode, setDrafts, setSaveErrors],
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

      setDrafts((previous) => omitMany(previous));
      setCommittedBodies((previous) => omitMany(previous));
      setPendingSaveCounts((previous) => omitMany(previous));
      setSaveErrors((previous) => omitMany(previous));
    },
    [setCommittedBodies, setDrafts, setPendingSaveCounts, setSaveErrors],
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

      setDrafts((previous) => omitMany(previous));
      setCommittedBodies((previous) => omitMany(previous));
      setPendingSaveCounts((previous) => omitMany(previous));
      setSaveErrors((previous) => omitMany(previous));
      setExpandedContentIds((previous) => {
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
    [setCommittedBodies, setDrafts, setExpandedContentIds, setPendingSaveCounts, setSaveErrors],
  );

  const handleContentCreateSibling = useCallback(
    async (anchorId: string) => {
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
          setContentError,
          error instanceof Error ? error.message : "创建正文节点失败，请稍后重试。",
          anchorId,
        );
      }
    },
    [
      activateContentNode,
      activeContentNode,
      activeTimelinePointId,
      contentTree,
      contentParentMap,
      contentRootId,
      createContent,
      expandContentParent,
      flatContentNodes.length,
      flushDirtyContentBeforeSwitch,
      setContentError,
      workspaceId,
    ],
  );

  const handleContentCreateChild = useCallback(
    async (parentNode: ContentTreeNodeVM, anchorId: string) => {
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
          setContentError,
          error instanceof Error ? error.message : "创建正文节点失败，请稍后重试。",
          anchorId,
        );
      }
    },
    [
      activateContentNode,
      activeTimelinePointId,
      createContent,
      expandContentParent,
      flatContentNodes.length,
      flushDirtyContentBeforeSwitch,
      setContentError,
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
            setShouldAutoSelectContent(false);
            setPendingContentNodeId(null);
            setActiveContentNodeId(null);
          }
        }
      } catch (error) {
        setActionError(
          setContentError,
          error instanceof Error ? error.message : "删除正文节点失败，请稍后重试。",
          anchorId,
        );
      }
    },
    [
      activateContentNode,
      activeContentNodeId,
      clearContentNodeLocalState,
      contentNodeMap,
      contentParentMap,
      contentRootId,
      contentTree,
      deleteContent,
      setActiveContentNodeId,
      setContentError,
      setPendingContentNodeId,
      setShouldAutoSelectContent,
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

      clearActionError(setContentError);

      try {
        await updateContent.mutate({
          workspaceId,
          nodeId: activeContentNode.id,
          anchorPointId: pointId,
        });
        setActiveTimelinePointId(pointId);
      } catch (error) {
        setActionError(
          setContentError,
          error instanceof Error ? error.message : "设置时间锚点失败，请稍后重试。",
          anchorId,
        );
      }
    },
    [activeContentNode, setActiveTimelinePointId, setContentError, updateContent, workspaceId],
  );

  const handleContentRename = useCallback(
    async (nodeId: string, title: string | null) => {
      if (!workspaceId) {
        return false;
      }

      clearActionError(setContentError);

      try {
        await updateContent.mutate({
          workspaceId,
          nodeId,
          title,
        });
        return true;
      } catch (error) {
        setActionError(
          setContentError,
          error instanceof Error ? error.message : "重命名正文节点失败，请稍后重试。",
          actionAnchorId("content", "row", nodeId),
        );
        return false;
      }
    },
    [setContentError, updateContent, workspaceId],
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

      clearActionError(setContentError);

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
          setContentError,
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
      setContentError,
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

      clearActionError(setTimelineError);

      try {
        await updateTimeline.mutate({
          workspaceId,
          pointId,
          label: normalizedLabel,
        });
        return true;
      } catch (error) {
        setActionError(
          setTimelineError,
          error instanceof Error ? error.message : "重命名时间点失败，请稍后重试。",
          actionAnchorId("timeline", "row", pointId),
        );
        return false;
      }
    },
    [setTimelineError, updateTimeline, workspaceId],
  );

  const handleTimelineAdd = useCallback(
    async (anchorId: string) => {
      if (!workspaceId || !activeTimelinePointId) {
        return;
      }

      const newIndex = timelinePoints.filter((point) => !point.isImplicitOrigin).length + 1;
      clearActionError(setTimelineError);

      try {
        const point = await createTimeline.mutate({
          workspaceId,
          afterPointId: activeTimelinePointId,
          key: `timeline_${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`,
          label: `新时间点 ${newIndex}`,
          description: "",
        });
        setActiveTimelinePointId(point.id);
      } catch (error) {
        setActionError(
          setTimelineError,
          error instanceof Error ? error.message : "创建时间点失败，请稍后重试。",
          anchorId,
        );
      }
    },
    [
      activeTimelinePointId,
      createTimeline,
      setActiveTimelinePointId,
      setTimelineError,
      timelinePoints,
      workspaceId,
    ],
  );

  const handleTimelineReorder = useCallback(
    async (fromIndex: number, toIndex: number) => {
      if (!workspaceId) {
        return;
      }

      const movedPoint = timelinePoints[fromIndex];
      if (!movedPoint || movedPoint.isImplicitOrigin) {
        return;
      }

      const reorderedPoints = [...timelinePoints];
      reorderedPoints.splice(fromIndex, 1);
      reorderedPoints.splice(toIndex, 0, movedPoint);

      const orderedMovablePoints = reorderedPoints.filter((point) => !point.isImplicitOrigin);
      const newIndex = orderedMovablePoints.findIndex((point) => point.id === movedPoint.id);
      const afterPointId =
        newIndex <= 0
          ? ORIGIN_TIMELINE_POINT_ID
          : (orderedMovablePoints[newIndex - 1]?.id ?? ORIGIN_TIMELINE_POINT_ID);

      clearActionError(setTimelineError);
      reorderTimelineOptimistically(fromIndex, toIndex);

      try {
        await moveTimeline.mutate({
          workspaceId,
          pointId: movedPoint.id,
          afterPointId,
        });
      } catch (error) {
        clearOptimisticTimelineReorder();
        setActionError(
          setTimelineError,
          error instanceof Error ? error.message : "调整时间轴顺序失败，请稍后重试。",
          actionAnchorId("timeline", "row", movedPoint.id),
        );
      }
    },
    [
      clearOptimisticTimelineReorder,
      moveTimeline,
      reorderTimelineOptimistically,
      setTimelineError,
      timelinePoints,
      workspaceId,
    ],
  );

  const handleAuxCreateSiblingDir = useCallback(
    async (anchorId: string) => {
      const parentDirId = resolveAuxParentForSibling(activeAuxNodeId);
      if (!parentDirId) {
        return;
      }

      await createAuxDir(parentDirId, anchorId);
    },
    [activeAuxNodeId, createAuxDir, resolveAuxParentForSibling],
  );

  const handleAuxCreateSiblingFile = useCallback(
    async (anchorId: string) => {
      const parentDirId = resolveAuxParentForSibling(activeAuxNodeId);
      if (!parentDirId) {
        return;
      }

      await createAuxFile(parentDirId, anchorId);
    },
    [activeAuxNodeId, createAuxFile, resolveAuxParentForSibling],
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

  const handleAuxRename = useCallback(
    async (nodeId: string, name: string) => {
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
          setAuxError,
          error instanceof Error ? error.message : "重命名辅助节点失败，请稍后重试。",
          anchorId,
        );
        return false;
      }
    },
    [
      activeTimelinePointId,
      auxNodeMap,
      auxParentMap,
      auxRootId,
      auxTree,
      moveAux,
      setAuxError,
      workspaceId,
    ],
  );

  const handleAuxDelete = useCallback(
    async (nodeId: string, anchorId: string) => {
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
        if (activeAuxNodeId === nodeId) {
          setShouldAutoSelectContent(false);
          setPendingContentNodeId(null);
          setActiveContentNodeId(null);
          if (activeTimelinePointId === ORIGIN_TIMELINE_POINT_ID) {
            setPendingAuxNodeId(null);
            setActiveAuxNodeId(null);
          }
        }
      } catch (error) {
        setActionError(
          setAuxError,
          error instanceof Error ? error.message : "删除辅助节点失败，请稍后重试。",
          anchorId,
        );
      }
    },
    [
      activeAuxNodeId,
      activeTimelinePointId,
      clearAuxNodeLocalState,
      deleteAux,
      setActiveContentNodeId,
      setActiveAuxNodeId,
      setAuxError,
      setPendingAuxNodeId,
      setPendingContentNodeId,
      setShouldAutoSelectContent,
      workspaceId,
    ],
  );

  const handleAuxRestore = useCallback(
    async (nodeId: string, anchorId: string) => {
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
          setAuxError,
          error instanceof Error ? error.message : "恢复辅助节点失败，请稍后重试。",
          anchorId,
        );
      }
    },
    [activeTimelinePointId, clearAuxNodeLocalState, restoreAux, setAuxError, workspaceId],
  );

  const handleTimelineDelete = useCallback(
    async (pointId: string, anchorId: string) => {
      if (!workspaceId || pointId === ORIGIN_TIMELINE_POINT_ID) {
        return;
      }

      clearActionError(setTimelineError);

      const anchoredNodes = flatContentNodes.filter(
        (node) => node.anchorTimelinePointId === pointId,
      );
      if (anchoredNodes.length > 0) {
        setActionError(
          setTimelineError,
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
            auxPaths: (auxChanges ?? []).map((change) =>
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
          setTimelineError,
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
      setTimelineError,
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
    clearActionError(setTimelineError);

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
        setTimelineError,
        error instanceof Error ? error.message : "删除时间点失败，请稍后重试。",
        anchorId,
      );
    }
  }, [deleteTimeline, finishTimelineDelete, setTimelineError, timelineDeleteDialog, workspaceId]);

  return {
    flushBodySave,
    flushAuxSave,
    toggleContentExpanded,
    toggleAuxExpanded,
    handleContentSelect,
    handleAuxSelect,
    handleBodyChange,
    handleAuxContentChange,
    handleTimelineSelect,
    handleContentRename,
    handleContentAnchorSet,
    handleContentCreateSibling,
    handleContentCreateChild,
    handleContentDelete,
    handleContentMove,
    handleTimelineAdd,
    handleTimelineRename,
    handleTimelineReorder,
    handleTimelineDelete,
    handleTimelineDeleteCancel,
    handleTimelineDeleteConfirm,
    timelineDeleteDialog,
    handleAuxCreateSiblingDir,
    handleAuxCreateSiblingFile,
    handleAuxCreateChildDir,
    handleAuxCreateChildFile,
    handleAuxRename,
    handleAuxDelete,
    handleAuxRestore,
    setActiveAuxNodeId,
    setActiveTimelinePointId,
  };
}

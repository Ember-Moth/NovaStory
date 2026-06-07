import { useMolecule } from "bunshi/react";
import { useAtom, useSetAtom } from "jotai";
import { useCallback } from "react";

import type { ContentTreeNodeVM } from "@/components/ProjectLayout/types";
import {
  collectContentSubtreeIds,
  findContentNode,
  omitRecordKey,
} from "@/components/ProjectLayout/utils";
import { ORIGIN_TIMELINE_POINT_ID } from "@/state/project/constants";
import { EditorMolecule } from "@/state/project/editorMolecule";
import { ErrorsMolecule } from "@/state/project/errorsMolecule";
import { SelectionMolecule } from "@/state/project/selectionMolecule";

import type { ProjectWorkspace } from "./useProjectWorkspace";

export function useProjectActions(workspace: ProjectWorkspace) {
  const selection = useMolecule(SelectionMolecule);
  const editor = useMolecule(EditorMolecule);
  const errors = useMolecule(ErrorsMolecule);

  const [, setActiveContentNodeId] = useAtom(selection.activeContentNodeIdAtom);
  const [, setActiveAuxNodeId] = useAtom(selection.activeAuxNodeIdAtom);
  const [, setActiveTimelinePointId] = useAtom(selection.activeTimelinePointIdAtom);
  const [, setExpandedContentIds] = useAtom(selection.expandedContentIdsAtom);
  const [, setExpandedAuxIds] = useAtom(selection.expandedAuxIdsAtom);
  const [drafts] = useAtom(editor.draftsAtom);
  const setDrafts = useSetAtom(editor.draftsAtom);
  const [committedBodies] = useAtom(editor.committedBodiesAtom);
  const setCommittedBodies = useSetAtom(editor.committedBodiesAtom);
  const setPendingSaveCounts = useSetAtom(editor.pendingSaveCountsAtom);
  const setSaveErrors = useSetAtom(editor.saveErrorsAtom);
  const setContentError = useSetAtom(errors.contentErrorAtom);
  const setTimelineError = useSetAtom(errors.timelineErrorAtom);

  const {
    workspaceId,
    contentRootId,
    contentTree,
    flatContentNodes,
    contentParentMap,
    timelinePoints,
    activeContentNode,
    activeContentNodeId,
    activeTimelinePointId,
    createContent,
    deleteContent,
    updateContent,
    createTimeline,
    moveTimeline,
    deleteTimeline,
    updateTimeline,
  } = workspace;

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

  const handleContentSelect = useCallback(
    (node: ContentTreeNodeVM) => {
      if (activeContentNode && activeContentNode.id !== node.id) {
        const currentBody = drafts[activeContentNode.id] ?? activeContentNode.body;
        const currentBaseline = committedBodies[activeContentNode.id] ?? activeContentNode.body;
        if (currentBody !== currentBaseline) {
          void flushBodySave(activeContentNode.id, currentBody);
        }
      }

      setActiveContentNodeId(node.id);
      setActiveTimelinePointId(node.anchorTimelinePointId);
    },
    [
      activeContentNode,
      committedBodies,
      drafts,
      flushBodySave,
      setActiveContentNodeId,
      setActiveTimelinePointId,
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

  const handleContentCreateSibling = useCallback(async () => {
    if (!workspaceId || !contentRootId) {
      return;
    }

    const anchorPointId =
      activeContentNode?.anchorTimelinePointId ?? activeTimelinePointId ?? ORIGIN_TIMELINE_POINT_ID;
    const parentId = activeContentNode
      ? (contentParentMap.get(activeContentNode.id) ?? contentRootId)
      : contentRootId;
    const title = `新节点 ${flatContentNodes.length + 1}`;

    setContentError(null);

    try {
      const node = await createContent.mutate({
        workspaceId,
        parentId,
        afterSiblingId: activeContentNode?.id,
        anchorPointId,
        title,
      });
      setActiveContentNodeId(node.id);
      setActiveTimelinePointId(node.anchorTimelinePointId ?? ORIGIN_TIMELINE_POINT_ID);
      expandContentParent(parentId);
    } catch (error) {
      setContentError(error instanceof Error ? error.message : "创建正文节点失败，请稍后重试。");
    }
  }, [
    activeContentNode,
    activeTimelinePointId,
    contentParentMap,
    contentRootId,
    createContent,
    expandContentParent,
    flatContentNodes.length,
    setActiveContentNodeId,
    setActiveTimelinePointId,
    setContentError,
    workspaceId,
  ]);

  const handleContentCreateChild = useCallback(
    async (parentNode: ContentTreeNodeVM) => {
      if (!workspaceId) {
        return;
      }

      const title = `新节点 ${flatContentNodes.length + 1}`;

      setContentError(null);

      try {
        const node = await createContent.mutate({
          workspaceId,
          parentId: parentNode.id,
          anchorPointId: parentNode.anchorTimelinePointId,
          title,
        });
        setActiveContentNodeId(node.id);
        setActiveTimelinePointId(node.anchorTimelinePointId ?? ORIGIN_TIMELINE_POINT_ID);
        expandContentParent(parentNode.id);
      } catch (error) {
        setContentError(error instanceof Error ? error.message : "创建正文节点失败，请稍后重试。");
      }
    },
    [
      createContent,
      expandContentParent,
      flatContentNodes.length,
      setActiveContentNodeId,
      setActiveTimelinePointId,
      setContentError,
      workspaceId,
    ],
  );

  const handleContentDelete = useCallback(
    async (nodeId: string) => {
      if (!workspaceId) {
        return;
      }

      const targetNode = findContentNode(contentTree, nodeId);
      if (!targetNode) {
        return;
      }

      const deletedIds = collectContentSubtreeIds(targetNode);

      setContentError(null);

      try {
        await deleteContent.mutate({ workspaceId, nodeId });
        clearContentNodeLocalState(deletedIds);
        if (activeContentNodeId && deletedIds.has(activeContentNodeId)) {
          setActiveContentNodeId(null);
        }
      } catch (error) {
        setContentError(error instanceof Error ? error.message : "删除正文节点失败，请稍后重试。");
      }
    },
    [
      activeContentNodeId,
      clearContentNodeLocalState,
      contentTree,
      deleteContent,
      setActiveContentNodeId,
      setContentError,
      workspaceId,
    ],
  );

  const handleContentRename = useCallback(
    async (nodeId: string, title: string | null) => {
      if (!workspaceId) {
        return false;
      }

      setContentError(null);

      try {
        await updateContent.mutate({
          workspaceId,
          nodeId,
          title,
        });
        return true;
      } catch (error) {
        setContentError(
          error instanceof Error ? error.message : "重命名正文节点失败，请稍后重试。",
        );
        return false;
      }
    },
    [setContentError, updateContent, workspaceId],
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

      setTimelineError(null);

      try {
        await updateTimeline.mutate({
          workspaceId,
          pointId,
          label: normalizedLabel,
        });
        return true;
      } catch (error) {
        setTimelineError(error instanceof Error ? error.message : "重命名时间点失败，请稍后重试。");
        return false;
      }
    },
    [setTimelineError, updateTimeline, workspaceId],
  );

  const handleTimelineAdd = useCallback(async () => {
    if (!workspaceId || !activeTimelinePointId) {
      return;
    }

    const newIndex = timelinePoints.filter((point) => !point.isImplicitOrigin).length + 1;
    setTimelineError(null);

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
      setTimelineError(error instanceof Error ? error.message : "创建时间点失败，请稍后重试。");
    }
  }, [
    activeTimelinePointId,
    createTimeline,
    setActiveTimelinePointId,
    setTimelineError,
    timelinePoints,
    workspaceId,
  ]);

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

      setTimelineError(null);

      try {
        await moveTimeline.mutate({
          workspaceId,
          pointId: movedPoint.id,
          afterPointId,
        });
      } catch (error) {
        setTimelineError(
          error instanceof Error ? error.message : "调整时间轴顺序失败，请稍后重试。",
        );
      }
    },
    [moveTimeline, setTimelineError, timelinePoints, workspaceId],
  );

  const handleTimelineDelete = useCallback(
    async (pointId: string) => {
      if (!workspaceId || pointId === ORIGIN_TIMELINE_POINT_ID) {
        return;
      }

      setTimelineError(null);

      try {
        await deleteTimeline.mutate({
          workspaceId,
          pointId,
        });
        if (activeTimelinePointId === pointId) {
          setActiveTimelinePointId(ORIGIN_TIMELINE_POINT_ID);
        }
      } catch (error) {
        setTimelineError(error instanceof Error ? error.message : "删除时间点失败，请稍后重试。");
      }
    },
    [
      activeTimelinePointId,
      deleteTimeline,
      setActiveTimelinePointId,
      setTimelineError,
      workspaceId,
    ],
  );

  return {
    flushBodySave,
    toggleContentExpanded,
    toggleAuxExpanded,
    handleContentSelect,
    handleBodyChange,
    handleContentRename,
    handleContentCreateSibling,
    handleContentCreateChild,
    handleContentDelete,
    handleTimelineAdd,
    handleTimelineRename,
    handleTimelineReorder,
    handleTimelineDelete,
    setActiveAuxNodeId,
    setActiveTimelinePointId,
  };
}

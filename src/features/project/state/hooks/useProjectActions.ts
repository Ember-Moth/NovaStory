import { useMolecule } from "bunshi/react";
import { useAtom, useSetAtom } from "jotai";
import { useCallback } from "react";

import {
  collectContentSubtreeIds,
  findAuxNode,
  findContentDeleteFallback,
  findContentNode,
  listAuxSiblings,
  nextAuxDirName,
  nextAuxFileName,
  omitRecordKey,
} from "@/features/project/model/tree";
import type { AuxTreeNodeVM, ContentTreeNodeVM } from "@/features/project/model/types";
import { ORIGIN_TIMELINE_POINT_ID } from "@/shared/constants";

import { EditorMolecule } from "../molecules/editor";
import { ErrorsMolecule } from "../molecules/errors";
import { SelectionMolecule } from "../molecules/selection";
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
  const setAuxError = useSetAtom(errors.auxErrorAtom);

  const {
    workspaceId,
    contentRootId,
    contentTree,
    auxTree,
    auxRootId,
    auxParentMap,
    flatContentNodes,
    contentParentMap,
    timelinePoints,
    activeContentNode,
    activeContentNodeId,
    activeAuxNodeId,
    activeTimelinePointId,
    createContent,
    deleteContent,
    updateContent,
    createTimeline,
    moveTimeline,
    deleteTimeline,
    updateTimeline,
    mkdirAux,
    writeFileAux,
    moveAux,
    deleteAux,
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

      const auxNode = findAuxNode(auxTree, activeAuxNodeId);
      if (auxNode?.nodeType !== "file") {
        return;
      }

      const currentContent = drafts[auxNode.id] ?? auxNode.content;
      const baseline = committedBodies[auxNode.id] ?? auxNode.content;
      if (currentContent !== baseline) {
        void flushAuxSave(auxNode.id, currentContent, timelinePointId);
      }
    },
    [activeAuxNodeId, activeTimelinePointId, auxTree, committedBodies, drafts, flushAuxSave],
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
    async (parentDirId: string) => {
      if (!workspaceId || !activeTimelinePointId) {
        return;
      }

      const siblings = listAuxSiblings(auxTree, parentDirId, auxRootId);
      const name = nextAuxDirName(siblings);

      setAuxError(null);

      try {
        const node = await mkdirAux.mutate({
          workspaceId,
          timelinePointId: activeTimelinePointId,
          parentDirId,
          name,
        });
        setActiveAuxNodeId(node.id);
        expandAuxParent(parentDirId);
      } catch (error) {
        setAuxError(error instanceof Error ? error.message : "创建辅助文件夹失败，请稍后重试。");
      }
    },
    [
      activeTimelinePointId,
      auxRootId,
      auxTree,
      expandAuxParent,
      mkdirAux,
      setActiveAuxNodeId,
      setAuxError,
      workspaceId,
    ],
  );

  const createAuxFile = useCallback(
    async (parentDirId: string) => {
      if (!workspaceId || !activeTimelinePointId) {
        return;
      }

      const siblings = listAuxSiblings(auxTree, parentDirId, auxRootId);
      const name = nextAuxFileName(siblings);

      setAuxError(null);

      try {
        const node = await writeFileAux.mutate({
          workspaceId,
          timelinePointId: activeTimelinePointId,
          parentDirId,
          name,
          content: "",
        });
        setActiveAuxNodeId(node.id);
        expandAuxParent(parentDirId);
      } catch (error) {
        setAuxError(error instanceof Error ? error.message : "创建辅助文件失败，请稍后重试。");
      }
    },
    [
      activeTimelinePointId,
      auxRootId,
      auxTree,
      expandAuxParent,
      setActiveAuxNodeId,
      setAuxError,
      workspaceId,
      writeFileAux,
    ],
  );

  const activateContentNode = useCallback(
    (nodeId: string, anchorTimelinePointId: string) => {
      setActiveAuxNodeId(null);
      setActiveContentNodeId(nodeId);
      setActiveTimelinePointId(anchorTimelinePointId);
    },
    [setActiveAuxNodeId, setActiveContentNodeId, setActiveTimelinePointId],
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
        const previousNode = findAuxNode(auxTree, activeAuxNodeId);
        if (previousNode?.nodeType === "file") {
          const currentContent = drafts[previousNode.id] ?? previousNode.content;
          const baseline = committedBodies[previousNode.id] ?? previousNode.content;
          if (currentContent !== baseline) {
            void flushAuxSave(previousNode.id, currentContent);
          }
        }
      }

      setActiveContentNodeId(null);
      setActiveAuxNodeId(node.id);
    },
    [
      activeAuxNodeId,
      auxTree,
      committedBodies,
      drafts,
      flushAuxSave,
      flushDirtyContent,
      setActiveAuxNodeId,
      setActiveContentNodeId,
    ],
  );

  const handleAuxContentChange = useCallback(
    (nextContent: string) => {
      if (!activeAuxNodeId) {
        return;
      }

      const auxNode = findAuxNode(auxTree, activeAuxNodeId);
      if (auxNode?.nodeType !== "file") {
        return;
      }

      setDrafts((previous) => ({
        ...previous,
        [auxNode.id]: nextContent,
      }));
      setSaveErrors((previous) => omitRecordKey(previous, auxNode.id));
    },
    [activeAuxNodeId, auxTree, setDrafts, setSaveErrors],
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

  const handleContentCreateSibling = useCallback(async () => {
    if (!workspaceId || !contentRootId || !activeTimelinePointId) {
      return;
    }

    const anchorPointId = activeTimelinePointId;
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
      flushDirtyContentBeforeSwitch();
      activateContentNode(node.id, node.anchorTimelinePointId ?? ORIGIN_TIMELINE_POINT_ID);
      expandContentParent(parentId);
    } catch (error) {
      setContentError(error instanceof Error ? error.message : "创建正文节点失败，请稍后重试。");
    }
  }, [
    activateContentNode,
    activeContentNode,
    activeTimelinePointId,
    contentParentMap,
    contentRootId,
    createContent,
    expandContentParent,
    flatContentNodes.length,
    flushDirtyContentBeforeSwitch,
    setContentError,
    workspaceId,
  ]);

  const handleContentCreateChild = useCallback(
    async (parentNode: ContentTreeNodeVM) => {
      if (!workspaceId || !activeTimelinePointId) {
        return;
      }

      const title = `新节点 ${flatContentNodes.length + 1}`;

      setContentError(null);

      try {
        const node = await createContent.mutate({
          workspaceId,
          parentId: parentNode.id,
          anchorPointId: activeTimelinePointId,
          title,
        });
        flushDirtyContentBeforeSwitch();
        activateContentNode(node.id, node.anchorTimelinePointId ?? ORIGIN_TIMELINE_POINT_ID);
        expandContentParent(parentNode.id);
      } catch (error) {
        setContentError(error instanceof Error ? error.message : "创建正文节点失败，请稍后重试。");
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
    async (nodeId: string) => {
      if (!workspaceId) {
        return;
      }

      const targetNode = findContentNode(contentTree, nodeId);
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

      setContentError(null);

      try {
        await deleteContent.mutate({ workspaceId, nodeId });
        clearContentNodeLocalState(deletedIds);
        if (shouldReselect) {
          if (fallbackNode) {
            activateContentNode(fallbackNode.id, fallbackNode.anchorTimelinePointId);
          } else {
            setActiveContentNodeId(null);
          }
        }
      } catch (error) {
        setContentError(error instanceof Error ? error.message : "删除正文节点失败，请稍后重试。");
      }
    },
    [
      activateContentNode,
      activeContentNodeId,
      clearContentNodeLocalState,
      contentParentMap,
      contentRootId,
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

  const handleAuxCreateSiblingDir = useCallback(async () => {
    const parentDirId = resolveAuxParentForSibling(activeAuxNodeId);
    if (!parentDirId) {
      return;
    }

    await createAuxDir(parentDirId);
  }, [activeAuxNodeId, createAuxDir, resolveAuxParentForSibling]);

  const handleAuxCreateSiblingFile = useCallback(async () => {
    const parentDirId = resolveAuxParentForSibling(activeAuxNodeId);
    if (!parentDirId) {
      return;
    }

    await createAuxFile(parentDirId);
  }, [activeAuxNodeId, createAuxFile, resolveAuxParentForSibling]);

  const handleAuxCreateChildDir = useCallback(
    async (parentNode: AuxTreeNodeVM) => {
      if (parentNode.nodeType !== "dir") {
        return;
      }

      await createAuxDir(parentNode.id);
    },
    [createAuxDir],
  );

  const handleAuxCreateChildFile = useCallback(
    async (parentNode: AuxTreeNodeVM) => {
      if (parentNode.nodeType !== "dir") {
        return;
      }

      await createAuxFile(parentNode.id);
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
      if (!normalized) {
        return false;
      }

      setAuxError(null);

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
        setAuxError(error instanceof Error ? error.message : "重命名辅助节点失败，请稍后重试。");
        return false;
      }
    },
    [activeTimelinePointId, auxParentMap, auxRootId, moveAux, setAuxError, workspaceId],
  );

  const handleAuxDelete = useCallback(
    async (nodeId: string) => {
      if (!workspaceId || !activeTimelinePointId) {
        return;
      }

      setAuxError(null);

      try {
        await deleteAux.mutate({
          workspaceId,
          timelinePointId: activeTimelinePointId,
          nodeId,
        });
        clearAuxNodeLocalState(new Set([nodeId]));
        if (activeAuxNodeId === nodeId) {
          setActiveAuxNodeId(null);
        }
      } catch (error) {
        setAuxError(error instanceof Error ? error.message : "删除辅助节点失败，请稍后重试。");
      }
    },
    [
      activeAuxNodeId,
      activeTimelinePointId,
      clearAuxNodeLocalState,
      deleteAux,
      setActiveAuxNodeId,
      setAuxError,
      workspaceId,
    ],
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
    flushAuxSave,
    toggleContentExpanded,
    toggleAuxExpanded,
    handleContentSelect,
    handleAuxSelect,
    handleBodyChange,
    handleAuxContentChange,
    handleTimelineSelect,
    handleContentRename,
    handleContentCreateSibling,
    handleContentCreateChild,
    handleContentDelete,
    handleTimelineAdd,
    handleTimelineRename,
    handleTimelineReorder,
    handleTimelineDelete,
    handleAuxCreateSiblingDir,
    handleAuxCreateSiblingFile,
    handleAuxCreateChildDir,
    handleAuxCreateChildFile,
    handleAuxRename,
    handleAuxDelete,
    setActiveAuxNodeId,
    setActiveTimelinePointId,
  };
}

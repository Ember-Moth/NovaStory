import { useCallback } from "react";

import {
  actionAnchorId,
  clearActionError,
  setActionError,
} from "@/modules/workspace/ui/editor/model/action-error";
import {
  collectAncestorIds,
  collectInvalidAuxSymlinkTargetIds,
  getAuxRenameValidationError,
  listAuxSiblings,
  nextAuxDirName,
  nextAuxFileName,
  nextAuxSymlinkName,
  resolveAuxHierarchyMove,
  type AuxHierarchyMoveIntent,
} from "@/modules/workspace/ui/editor/model/tree";
import type { AuxTreeNodeVM } from "@/modules/workspace/ui/editor/model/types";
import { ORIGIN_TIMELINE_POINT_ID } from "@/modules/workspace/domain/constants";
import type { WorkspaceStore } from "@/modules/workspace/ui/editor/state/molecules/workspaceStore";

import { selectAuxPath } from "./projectActionShared";

function joinAuxPath(parentPath: string, name: string) {
  return parentPath === "/" ? `/${name}` : `${parentPath}/${name}`;
}

type AuxActionDependencies = {
  projectId: string;
  workspaceId: string | undefined;
  auxTree: AuxTreeNodeVM[];
  auxRootPath: string | undefined;
  auxNodeMap: ReadonlyMap<string, AuxTreeNodeVM>;
  auxParentMap: ReadonlyMap<string, string | null>;
  mkdirAux: {
    mutate: (input: {
      projectId: string;
      workspaceId: string;
      timelinePointId: string;
      path: string;
    }) => Promise<{ path: string }>;
  };
  writeFileAux: {
    mutate: (input: {
      projectId: string;
      workspaceId: string;
      timelinePointId: string;
      path: string;
      content: string;
    }) => Promise<{ path: string }>;
  };
  linkAux: {
    mutate: (input: {
      projectId: string;
      workspaceId: string;
      timelinePointId: string;
      path: string;
      targetPath: string;
    }) => Promise<{ path: string }>;
  };
  moveAux: {
    mutate: (input: {
      projectId: string;
      workspaceId: string;
      timelinePointId: string;
      path: string;
      newPath: string;
    }) => Promise<{ path: string }>;
  };
  retargetSymlinkAux: {
    mutate: (input: {
      projectId: string;
      workspaceId: string;
      timelinePointId: string;
      path: string;
      targetPath: string;
    }) => Promise<{ path: string }>;
  };
  deleteAux: {
    mutate: (input: {
      projectId: string;
      workspaceId: string;
      timelinePointId: string;
      path: string;
    }) => Promise<void>;
  };
  restoreDeletedAux: {
    mutate: (input: {
      projectId: string;
      workspaceId: string;
      timelinePointId: string;
      path: string;
    }) => Promise<{ path: string }>;
  };
  store: WorkspaceStore;
  flushDirtyContent: () => void;
  flushAuxSave: (nodeId: string, content: string, timelinePointId?: string) => Promise<void>;
  clearAuxNodeLocalState: (nodeIds: Set<string>) => void;
  expandAuxParent: (parentId: string) => void;
};

export function useProjectAuxActions({
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
}: AuxActionDependencies) {
  const normalizedAuxRootPath = auxRootPath ?? null;

  const toggleAuxExpanded = useCallback(
    (nodeId: string) => {
      store.getState().setExpandedAuxPaths((previous) => {
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

  const resolveAuxParentForSibling = useCallback(
    (activeId: string | null): string | null => {
      if (!normalizedAuxRootPath) {
        return null;
      }

      if (!activeId) {
        return normalizedAuxRootPath;
      }

      return auxParentMap.get(activeId) ?? normalizedAuxRootPath;
    },
    [auxParentMap, normalizedAuxRootPath],
  );

  const createAuxDir = useCallback(
    async (parentDirId: string, anchorId: string) => {
      const { activeTimelinePointId, setAuxError } = store.getState();
      if (!workspaceId || !activeTimelinePointId) {
        return;
      }

      const siblings = listAuxSiblings(auxTree, auxNodeMap, parentDirId, normalizedAuxRootPath);
      const name = nextAuxDirName(siblings);

      clearActionError(setAuxError);

      try {
        const node = await mkdirAux.mutate({
          projectId,
          workspaceId,
          timelinePointId: activeTimelinePointId,
          path: joinAuxPath(parentDirId, name),
        });
        const state = store.getState();
        selectAuxPath(state, auxNodeMap, node.path);
        expandAuxParent(parentDirId);
      } catch (error) {
        setActionError(
          store.getState().setAuxError,
          error instanceof Error ? error.message : "创建辅助文件夹失败，请稍后重试。",
          anchorId,
        );
      }
    },
    [
      auxNodeMap,
      auxTree,
      expandAuxParent,
      mkdirAux,
      normalizedAuxRootPath,
      projectId,
      store,
      workspaceId,
    ],
  );

  const createAuxFile = useCallback(
    async (parentDirId: string, anchorId: string) => {
      const { activeTimelinePointId, setAuxError } = store.getState();
      if (!workspaceId || !activeTimelinePointId) {
        return;
      }

      const siblings = listAuxSiblings(auxTree, auxNodeMap, parentDirId, normalizedAuxRootPath);
      const name = nextAuxFileName(siblings);

      clearActionError(setAuxError);

      try {
        const node = await writeFileAux.mutate({
          projectId,
          workspaceId,
          timelinePointId: activeTimelinePointId,
          path: joinAuxPath(parentDirId, name),
          content: "",
        });
        const state = store.getState();
        selectAuxPath(state, auxNodeMap, node.path);
        expandAuxParent(parentDirId);
      } catch (error) {
        setActionError(
          store.getState().setAuxError,
          error instanceof Error ? error.message : "创建辅助文件失败，请稍后重试。",
          anchorId,
        );
      }
    },
    [
      auxNodeMap,
      auxTree,
      expandAuxParent,
      normalizedAuxRootPath,
      projectId,
      store,
      workspaceId,
      writeFileAux,
    ],
  );

  const createAuxSymlink = useCallback(
    async (parentDirId: string, targetPath: string, targetName: string, anchorId: string) => {
      const { activeTimelinePointId, setAuxError } = store.getState();
      if (!workspaceId || !activeTimelinePointId) {
        return;
      }

      const siblings = listAuxSiblings(auxTree, auxNodeMap, parentDirId, normalizedAuxRootPath);
      const name = nextAuxSymlinkName(siblings, targetName);

      clearActionError(setAuxError);

      try {
        const node = await linkAux.mutate({
          projectId,
          workspaceId,
          timelinePointId: activeTimelinePointId,
          path: joinAuxPath(parentDirId, name),
          targetPath,
        });
        const state = store.getState();
        selectAuxPath(state, auxNodeMap, node.path);
        expandAuxParent(parentDirId);
      } catch (error) {
        setActionError(
          store.getState().setAuxError,
          error instanceof Error ? error.message : "创建辅助符号链接失败，请稍后重试。",
          anchorId,
        );
      }
    },
    [
      auxNodeMap,
      auxTree,
      expandAuxParent,
      linkAux,
      normalizedAuxRootPath,
      projectId,
      store,
      workspaceId,
    ],
  );

  const exitAuxSymlinkTargetPicker = useCallback(() => {
    const state = store.getState();
    state.setIsAuxSymlinkTargetPickerActive(false);
    state.setAuxSymlinkTargetPickerSourceId(null);
  }, [store]);

  const enterAuxSymlinkTargetPicker = useCallback(
    (nodeId: string) => {
      const node = auxNodeMap.get(nodeId) ?? null;
      if (node?.nodeType !== "symlink") {
        return;
      }

      clearActionError(store.getState().setAuxError);
      store.getState().setExpandedAuxPaths((previous) => {
        const targetId = node.symlinkTargetPath;
        if (!targetId) {
          return previous;
        }

        const next = new Set(previous);
        let changed = false;
        for (const ancestorId of collectAncestorIds(new Map(auxParentMap), targetId)) {
          if (!next.has(ancestorId)) {
            next.add(ancestorId);
            changed = true;
          }
        }
        return changed ? next : previous;
      });

      const state = store.getState();
      selectAuxPath(state, auxNodeMap, node.id);
      state.setAuxSymlinkTargetPickerSourceId(node.id);
      state.setIsAuxSymlinkTargetPickerActive(true);
    },
    [auxNodeMap, auxParentMap, store],
  );

  const cancelAuxSymlinkTargetPicker = useCallback(() => {
    exitAuxSymlinkTargetPicker();
  }, [exitAuxSymlinkTargetPicker]);

  const submitAuxSymlinkTargetRetarget = useCallback(
    async (targetPath: string) => {
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
      if (source?.nodeType !== "symlink") {
        exitAuxSymlinkTargetPicker();
        return;
      }

      if (source.symlinkTargetPath === targetPath) {
        return;
      }

      const invalidTargetIds = collectInvalidAuxSymlinkTargetIds(auxNodeMap, source.id);
      if (invalidTargetIds.has(targetPath)) {
        return;
      }

      clearActionError(setAuxError);

      try {
        await retargetSymlinkAux.mutate({
          projectId,
          workspaceId,
          timelinePointId: activeTimelinePointId,
          path: source.id,
          targetPath,
        });
        const nextState = store.getState();
        selectAuxPath(nextState, auxNodeMap, source.id);
        exitAuxSymlinkTargetPicker();
      } catch (error) {
        setActionError(
          store.getState().setAuxError,
          error instanceof Error ? error.message : "更新符号链接目标失败，请稍后重试。",
          actionAnchorId("aux", "row", source.id),
        );
      }
    },
    [auxNodeMap, exitAuxSymlinkTargetPicker, projectId, retargetSymlinkAux, store, workspaceId],
  );

  const handleAuxSelect = useCallback(
    (node: AuxTreeNodeVM) => {
      flushDirtyContent();

      const { activeAuxPath, drafts, committedBodies } = store.getState();
      if (activeAuxPath && activeAuxPath !== node.id) {
        const previousNode = auxNodeMap.get(activeAuxPath) ?? null;
        if (previousNode?.nodeType === "file") {
          const currentContent = drafts[previousNode.id] ?? previousNode.content;
          const baseline = committedBodies[previousNode.id] ?? previousNode.content;
          if (currentContent !== baseline) {
            void flushAuxSave(previousNode.id, currentContent);
          }
        }
      }

      const state = store.getState();
      selectAuxPath(state, auxNodeMap, node.id);
    },
    [auxNodeMap, flushAuxSave, flushDirtyContent, store],
  );

  const handleAuxCreateSiblingDir = useCallback(
    async (anchorId: string) => {
      const parentDirId = resolveAuxParentForSibling(store.getState().activeAuxPath);
      if (!parentDirId) {
        return;
      }

      await createAuxDir(parentDirId, anchorId);
    },
    [createAuxDir, resolveAuxParentForSibling, store],
  );

  const handleAuxCreateSiblingFile = useCallback(
    async (anchorId: string) => {
      const parentDirId = resolveAuxParentForSibling(store.getState().activeAuxPath);
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
      const parentDirId = auxParentMap.get(node.id) ?? normalizedAuxRootPath;
      if (!parentDirId) {
        return;
      }

      await createAuxSymlink(parentDirId, node.id, node.name, anchorId);
    },
    [auxParentMap, createAuxSymlink, normalizedAuxRootPath],
  );

  const handleAuxRename = useCallback(
    async (nodeId: string, name: string) => {
      const { activeTimelinePointId, setAuxError } = store.getState();
      if (!workspaceId || !activeTimelinePointId) {
        return false;
      }

      const parentDirId = auxParentMap.get(nodeId) ?? normalizedAuxRootPath;
      if (!parentDirId) {
        return false;
      }

      const normalized = name.trim();
      const anchorId = actionAnchorId("aux", "row", nodeId);
      const validationError = getAuxRenameValidationError({
        tree: auxTree,
        nodeMap: auxNodeMap,
        parentMap: auxParentMap,
        auxRootPath: normalizedAuxRootPath,
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
          projectId,
          workspaceId,
          timelinePointId: activeTimelinePointId,
          path: nodeId,
          newPath: joinAuxPath(parentDirId, normalized),
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
    [
      auxNodeMap,
      auxParentMap,
      auxTree,
      moveAux,
      normalizedAuxRootPath,
      projectId,
      store,
      workspaceId,
    ],
  );

  const handleAuxMove = useCallback(
    async (intent: AuxHierarchyMoveIntent) => {
      const { activeTimelinePointId, setAuxError } = store.getState();
      if (!workspaceId || !activeTimelinePointId || !normalizedAuxRootPath) {
        return;
      }

      const move = resolveAuxHierarchyMove({
        parentMap: auxParentMap,
        nodeMap: auxNodeMap,
        auxRootPath: normalizedAuxRootPath,
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

      if (move.newParentId !== normalizedAuxRootPath) {
        expandAuxParent(move.newParentId);
      }

      try {
        await moveAux.mutate({
          projectId,
          workspaceId,
          timelinePointId: activeTimelinePointId,
          path: move.nodeId,
          newPath: joinAuxPath(move.newParentId, node.name.trim() || node.name),
        });
      } catch (error) {
        setActionError(
          store.getState().setAuxError,
          error instanceof Error ? error.message : "调整辅助信息层级失败，请稍后重试。",
          actionAnchorId("aux", "row", move.nodeId),
        );
      }
    },
    [
      auxNodeMap,
      auxParentMap,
      expandAuxParent,
      moveAux,
      normalizedAuxRootPath,
      projectId,
      store,
      workspaceId,
    ],
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
          projectId,
          workspaceId,
          timelinePointId: activeTimelinePointId,
          path: nodeId,
        });
        clearAuxNodeLocalState(new Set([nodeId]));
        const state = store.getState();
        if (state.activeAuxPath === nodeId) {
          selectAuxPath(state, auxNodeMap, null);
        }
      } catch (error) {
        setActionError(
          store.getState().setAuxError,
          error instanceof Error ? error.message : "删除辅助节点失败，请稍后重试。",
          anchorId,
        );
      }
    },
    [auxNodeMap, clearAuxNodeLocalState, deleteAux, projectId, store, workspaceId],
  );

  const handleAuxRestoreDeleted = useCallback(
    async (nodeId: string, anchorId: string) => {
      const { activeTimelinePointId, setAuxError } = store.getState();
      if (
        !workspaceId ||
        !activeTimelinePointId ||
        activeTimelinePointId === ORIGIN_TIMELINE_POINT_ID
      ) {
        return;
      }

      clearActionError(setAuxError);

      try {
        await restoreDeletedAux.mutate({
          projectId,
          workspaceId,
          timelinePointId: activeTimelinePointId,
          path: nodeId,
        });
        clearAuxNodeLocalState(new Set([nodeId]));
        const state = store.getState();
        if (state.activeAuxPath === nodeId) {
          state.setPendingAuxPath(null);
          state.setActiveAuxPath(null);
        }
      } catch (error) {
        setActionError(
          store.getState().setAuxError,
          error instanceof Error ? error.message : "恢复辅助节点失败，请稍后重试。",
          anchorId,
        );
      }
    },
    [clearAuxNodeLocalState, projectId, restoreDeletedAux, store, workspaceId],
  );

  return {
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
    handleAuxRestoreDeleted,
  };
}

import { useCallback } from "react";

import {
  actionAnchorId,
  clearActionError,
  setActionError,
} from "@/modules/workspace/ui/editor/model/action-error";
import {
  collectContentSubtreeIds,
  findContentDeleteFallback,
  resolveContentCreateSiblingPlacement,
  resolveContentMove,
  type ContentMoveIntent,
} from "@/modules/workspace/ui/editor/model/tree";
import type { ContentTreeNodeVM } from "@/modules/workspace/ui/editor/model/types";
import { ORIGIN_TIMELINE_POINT_ID } from "@/modules/workspace/domain/constants";
import type { WorkspaceStore } from "@/modules/workspace/ui/editor/state/molecules/workspaceStore";

import { clearActiveContentSelection } from "./projectActionShared";

type ContentActionDependencies = {
  projectId: string;
  workspaceId: string | undefined;
  activeContentNode: ContentTreeNodeVM | null;
  contentTree: ContentTreeNodeVM[];
  flatContentNodes: ContentTreeNodeVM[];
  contentNodeMap: ReadonlyMap<string, ContentTreeNodeVM>;
  contentParentMap: ReadonlyMap<string, string | null>;
  createContent: {
    mutate: (input: {
      projectId: string;
      workspaceId: string;
      parentId: string | null;
      afterSiblingId?: string;
      anchorPointId: string;
      title: string;
    }) => Promise<{ id: string; anchorTimelinePointId?: string | null }>;
  };
  deleteContent: {
    mutate: (input: { projectId: string; workspaceId: string; nodeId: string }) => Promise<void>;
  };
  moveContent: {
    mutate: (input: {
      projectId: string;
      workspaceId: string;
      nodeId: string;
      newParentId: string | null;
      afterSiblingId?: string;
    }) => Promise<unknown>;
  };
  updateContent: {
    mutate: (input: {
      projectId: string;
      workspaceId: string;
      nodeId: string;
      title?: string | null;
      anchorPointId?: string;
    }) => Promise<unknown>;
  };
  store: WorkspaceStore;
  expandContentParent: (parentId: string) => void;
  activateContentNode: (nodeId: string, anchorTimelinePointId: string) => void;
  clearContentNodeLocalState: (nodeIds: Set<string>) => void;
  flushDirtyContentBeforeSwitch: () => void;
};

export function useProjectContentActions({
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
}: ContentActionDependencies) {
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

  const handleContentSelect = useCallback(
    (node: ContentTreeNodeVM) => {
      if (activeContentNode?.id !== node.id) {
        flushDirtyContentBeforeSwitch();
      }

      activateContentNode(node.id, node.anchorTimelinePointId);
    },
    [activateContentNode, activeContentNode, flushDirtyContentBeforeSwitch],
  );

  const handleContentCreateSibling = useCallback(
    async (anchorId: string) => {
      const { activeTimelinePointId, setContentError } = store.getState();
      if (!workspaceId || !activeTimelinePointId) {
        return;
      }

      const anchorPointId = activeTimelinePointId;
      const placement = resolveContentCreateSiblingPlacement({
        activeNode: activeContentNode,
        tree: contentTree,
        parentMap: contentParentMap,
      });
      const parentId = placement.parentId ?? null;
      const afterSiblingId = placement.afterSiblingId ?? undefined;
      const title = `新节点 ${flatContentNodes.length + 1}`;

      clearActionError(setContentError);

      try {
        const node = await createContent.mutate({
          projectId,
          workspaceId,
          parentId,
          afterSiblingId,
          anchorPointId,
          title,
        });
        flushDirtyContentBeforeSwitch();
        activateContentNode(node.id, node.anchorTimelinePointId ?? ORIGIN_TIMELINE_POINT_ID);
        if (parentId) {
          expandContentParent(parentId);
        }
      } catch (error) {
        setActionError(
          store.getState().setContentError,
          error instanceof Error ? error.message : "创建正文节点失败，请稍后重试。",
          anchorId,
        );
      }
    },
    [
      activeContentNode,
      activateContentNode,
      contentParentMap,
      contentTree,
      createContent,
      expandContentParent,
      flatContentNodes.length,
      flushDirtyContentBeforeSwitch,
      projectId,
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
          projectId,
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
      projectId,
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
        ? findContentDeleteFallback(contentTree, new Map(contentParentMap), nodeId, deletedIds)
        : null;

      clearActionError(setContentError);

      try {
        await deleteContent.mutate({ projectId, workspaceId, nodeId });
        clearContentNodeLocalState(deletedIds);
        if (shouldReselect) {
          if (fallbackNode) {
            activateContentNode(fallbackNode.id, fallbackNode.anchorTimelinePointId);
          } else {
            clearActiveContentSelection(store.getState());
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
      contentTree,
      deleteContent,
      projectId,
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
          projectId,
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
    [activeContentNode, projectId, store, updateContent, workspaceId],
  );

  const handleContentRename = useCallback(
    async (nodeId: string, title: string | null) => {
      if (!workspaceId) {
        return false;
      }

      clearActionError(store.getState().setContentError);

      try {
        await updateContent.mutate({
          projectId,
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
    [projectId, store, updateContent, workspaceId],
  );

  const handleContentMove = useCallback(
    async (intent: ContentMoveIntent) => {
      if (!workspaceId) {
        return;
      }

      const move = resolveContentMove({
        tree: contentTree,
        parentMap: contentParentMap,
        nodeMap: contentNodeMap,
        ...intent,
      });

      if (!move) {
        return;
      }

      clearActionError(store.getState().setContentError);

      if (move.position === "inside" && move.newParentId) {
        expandContentParent(move.newParentId);
      }

      try {
        await moveContent.mutate({
          projectId,
          workspaceId,
          nodeId: move.nodeId,
          newParentId: move.newParentId,
          afterSiblingId: move.afterSiblingId ?? undefined,
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
      contentTree,
      expandContentParent,
      moveContent,
      store,
      projectId,
      workspaceId,
    ],
  );

  return {
    toggleContentExpanded,
    handleContentSelect,
    handleContentRename,
    handleContentAnchorSet,
    handleContentCreateSibling,
    handleContentCreateChild,
    handleContentDelete,
    handleContentMove,
  };
}

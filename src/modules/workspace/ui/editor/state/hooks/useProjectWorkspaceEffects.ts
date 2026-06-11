import { useEffect } from "react";

import {
  collectAncestorIds,
  findPreferredContentNode,
} from "@/modules/workspace/ui/editor/model/tree";

import { AUTOSAVE_DELAY_MS } from "../constants";
import { useWorkspaceState } from "../molecules/workspaceStore";
import type { ProjectWorkspaceState } from "./useProjectWorkspace";

export function useProjectWorkspaceEffects(
  workspace: ProjectWorkspaceState,
  flushBodySave: (_nodeId: string, _body: string) => Promise<void>,
  flushAuxSave: (_nodeId: string, _content: string) => Promise<void>,
) {
  const setActiveContentNodeId = useWorkspaceState((state) => state.setActiveContentNodeId);
  const setActiveAuxNodeId = useWorkspaceState((state) => state.setActiveAuxNodeId);
  const pendingContentNodeId = useWorkspaceState((state) => state.pendingContentNodeId);
  const setPendingContentNodeId = useWorkspaceState((state) => state.setPendingContentNodeId);
  const pendingAuxNodeId = useWorkspaceState((state) => state.pendingAuxNodeId);
  const setPendingAuxNodeId = useWorkspaceState((state) => state.setPendingAuxNodeId);
  const shouldAutoSelectContent = useWorkspaceState((state) => state.shouldAutoSelectContent);
  const setActiveTimelinePointId = useWorkspaceState((state) => state.setActiveTimelinePointId);
  const setExpandedContentIds = useWorkspaceState((state) => state.setExpandedContentIds);
  const setExpandedAuxIds = useWorkspaceState((state) => state.setExpandedAuxIds);
  const drafts = useWorkspaceState((state) => state.drafts);
  const committedBodies = useWorkspaceState((state) => state.committedBodies);
  const setCommittedBodies = useWorkspaceState((state) => state.setCommittedBodies);

  const {
    identity: { workspaceId },
    content: {
      flatNodes: flatContentNodes,
      nodeMap: contentNodeMap,
      tree: contentTree,
      parentMap: contentParentMap,
    },
    timeline: { points: timelinePoints, idSet: timelinePointIdSet },
    aux: { tree: auxTree, nodeMap: auxNodeMap, idSet: auxNodeIdSet },
    selection: {
      activeContentNodeId,
      activeAuxNodeId,
      expandedAuxIds,
      activeContentNode,
      activeAuxNode,
    },
  } = workspace;

  useEffect(() => {
    if (!activeContentNodeId) {
      if (pendingContentNodeId) {
        setPendingContentNodeId(null);
      }
      return;
    }

    if (contentNodeMap.has(activeContentNodeId)) {
      if (pendingContentNodeId === activeContentNodeId) {
        setPendingContentNodeId(null);
      }
      return;
    }

    if (pendingContentNodeId === activeContentNodeId) {
      return;
    }

    setActiveContentNodeId(null);
  }, [
    activeContentNodeId,
    contentNodeMap,
    pendingContentNodeId,
    setActiveContentNodeId,
    setPendingContentNodeId,
  ]);

  useEffect(() => {
    if (!shouldAutoSelectContent) {
      return;
    }

    if (pendingContentNodeId) {
      return;
    }

    if (activeAuxNodeId) {
      return;
    }

    if (activeContentNodeId) {
      return;
    }

    if (flatContentNodes.length === 0) {
      return;
    }

    const preferredNode = findPreferredContentNode(contentTree) ?? flatContentNodes[0] ?? null;
    if (preferredNode) {
      setActiveContentNodeId(preferredNode.id);
    }
  }, [
    activeAuxNodeId,
    activeContentNodeId,
    contentTree,
    flatContentNodes,
    pendingContentNodeId,
    setActiveContentNodeId,
    shouldAutoSelectContent,
  ]);

  useEffect(() => {
    if (!activeContentNodeId) {
      return;
    }

    setExpandedContentIds((previous) => {
      const next = new Set(previous);
      let changed = false;

      for (const ancestorId of collectAncestorIds(contentParentMap, activeContentNodeId)) {
        if (!next.has(ancestorId)) {
          next.add(ancestorId);
          changed = true;
        }
      }

      return changed ? next : previous;
    });
  }, [activeContentNodeId, contentParentMap, setExpandedContentIds]);

  useEffect(() => {
    if (timelinePoints.length === 0) {
      setActiveTimelinePointId(null);
      return;
    }

    setActiveTimelinePointId((previous) => {
      if (previous && timelinePointIdSet.has(previous)) {
        return previous;
      }

      const preferredId = activeContentNode?.anchorTimelinePointId;
      if (preferredId && timelinePointIdSet.has(preferredId)) {
        return preferredId;
      }

      return timelinePoints[0]?.id ?? null;
    });
  }, [activeContentNode, setActiveTimelinePointId, timelinePointIdSet, timelinePoints]);

  useEffect(() => {
    if (auxTree.length === 0) {
      if (pendingAuxNodeId) {
        setPendingAuxNodeId(null);
      }
      setActiveAuxNodeId(null);
      return;
    }

    if (activeAuxNodeId && auxNodeIdSet.has(activeAuxNodeId)) {
      if (pendingAuxNodeId === activeAuxNodeId) {
        setPendingAuxNodeId(null);
      }
      return;
    }

    if (activeAuxNodeId && pendingAuxNodeId === activeAuxNodeId) {
      return;
    }

    setActiveAuxNodeId(null);
  }, [
    activeAuxNodeId,
    auxNodeIdSet,
    auxTree,
    pendingAuxNodeId,
    setActiveAuxNodeId,
    setPendingAuxNodeId,
  ]);

  useEffect(() => {
    if (auxTree.length === 0) {
      return;
    }

    const hasVisibleExpandedNode = [...expandedAuxIds].some((id) => auxNodeIdSet.has(id));
    if (hasVisibleExpandedNode) {
      return;
    }

    const nextExpandedIds = auxTree
      .filter((node) => node.nodeType === "dir")
      .slice(0, 2)
      .map((node) => node.id);
    if (nextExpandedIds.length > 0) {
      setExpandedAuxIds(new Set(nextExpandedIds));
    }
  }, [auxNodeIdSet, auxTree, expandedAuxIds, setExpandedAuxIds]);

  useEffect(() => {
    setCommittedBodies((previous) => {
      let changed = false;
      const next = { ...previous };

      for (const [nodeId, committedBody] of Object.entries(previous)) {
        const node = contentNodeMap.get(nodeId);
        if (node?.body === committedBody) {
          delete next[nodeId];
          changed = true;
        }
      }

      return changed ? next : previous;
    });
  }, [contentNodeMap, setCommittedBodies]);

  useEffect(() => {
    if (!workspaceId || !activeContentNode) {
      return;
    }

    const draft = drafts[activeContentNode.id];
    if (draft === undefined) {
      return;
    }

    const baseline = committedBodies[activeContentNode.id] ?? activeContentNode.body;
    if (draft === baseline) {
      return;
    }

    const timeout = setTimeout(() => {
      void flushBodySave(activeContentNode.id, draft);
    }, AUTOSAVE_DELAY_MS);

    return () => clearTimeout(timeout);
  }, [activeContentNode, committedBodies, drafts, flushBodySave, workspaceId]);

  useEffect(() => {
    if (!workspaceId || activeAuxNode?.nodeType !== "file") {
      return;
    }

    const draft = drafts[activeAuxNode.id];
    if (draft === undefined) {
      return;
    }

    const baseline = committedBodies[activeAuxNode.id] ?? activeAuxNode.content;
    if (draft === baseline) {
      return;
    }

    const timeout = setTimeout(() => {
      void flushAuxSave(activeAuxNode.id, draft);
    }, AUTOSAVE_DELAY_MS);

    return () => clearTimeout(timeout);
  }, [activeAuxNode, committedBodies, drafts, flushAuxSave, workspaceId]);

  useEffect(() => {
    setCommittedBodies((previous) => {
      let changed = false;
      const next = { ...previous };

      for (const [nodeId, committedContent] of Object.entries(previous)) {
        const node = auxNodeMap.get(nodeId);
        if (node?.nodeType === "file" && node.content === committedContent) {
          delete next[nodeId];
          changed = true;
        }
      }

      return changed ? next : previous;
    });
  }, [auxNodeMap, setCommittedBodies]);
}

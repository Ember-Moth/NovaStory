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
  const setActiveAuxPath = useWorkspaceState((state) => state.setActiveAuxPath);
  const pendingContentNodeId = useWorkspaceState((state) => state.pendingContentNodeId);
  const setPendingContentNodeId = useWorkspaceState((state) => state.setPendingContentNodeId);
  const pendingAuxPath = useWorkspaceState((state) => state.pendingAuxPath);
  const setPendingAuxPath = useWorkspaceState((state) => state.setPendingAuxPath);
  const pendingAuxTimelinePointId = useWorkspaceState((state) => state.pendingAuxTimelinePointId);
  const setPendingAuxTimelinePointId = useWorkspaceState(
    (state) => state.setPendingAuxTimelinePointId,
  );
  const shouldAutoSelectContent = useWorkspaceState((state) => state.shouldAutoSelectContent);
  const setActiveTimelinePointId = useWorkspaceState((state) => state.setActiveTimelinePointId);
  const setExpandedContentIds = useWorkspaceState((state) => state.setExpandedContentIds);
  const setExpandedAuxPaths = useWorkspaceState((state) => state.setExpandedAuxPaths);
  const isAuxSymlinkTargetPickerActive = useWorkspaceState(
    (state) => state.isAuxSymlinkTargetPickerActive,
  );
  const auxSymlinkTargetPickerSourceId = useWorkspaceState(
    (state) => state.auxSymlinkTargetPickerSourceId,
  );
  const setIsAuxSymlinkTargetPickerActive = useWorkspaceState(
    (state) => state.setIsAuxSymlinkTargetPickerActive,
  );
  const setAuxSymlinkTargetPickerSourceId = useWorkspaceState(
    (state) => state.setAuxSymlinkTargetPickerSourceId,
  );
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
    aux: { tree: auxTree, nodeMap: auxNodeMap, idSet: auxPathSet },
    selection: {
      activeContentNodeId,
      activeAuxPath,
      expandedAuxPaths,
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

    if (activeAuxPath) {
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
    activeAuxPath,
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
      if (pendingAuxPath) {
        setPendingAuxPath(null);
      }
      if (pendingAuxTimelinePointId) {
        setPendingAuxTimelinePointId(null);
      }
      setActiveAuxPath(null);
      return;
    }

    if (
      pendingAuxPath &&
      pendingAuxTimelinePointId &&
      pendingAuxTimelinePointId !== workspace.selection.activeTimelinePointId
    ) {
      return;
    }

    if (activeAuxPath && auxPathSet.has(activeAuxPath)) {
      if (pendingAuxPath === activeAuxPath) {
        setPendingAuxPath(null);
        if (pendingAuxTimelinePointId) {
          setPendingAuxTimelinePointId(null);
        }
      }
      return;
    }

    if (activeAuxPath && pendingAuxPath === activeAuxPath) {
      return;
    }

    setActiveAuxPath(null);
  }, [
    activeAuxPath,
    auxPathSet,
    auxTree,
    pendingAuxPath,
    pendingAuxTimelinePointId,
    setActiveAuxPath,
    setPendingAuxPath,
    setPendingAuxTimelinePointId,
    workspace.selection.activeTimelinePointId,
  ]);

  useEffect(() => {
    if (!isAuxSymlinkTargetPickerActive) {
      if (auxSymlinkTargetPickerSourceId) {
        setAuxSymlinkTargetPickerSourceId(null);
      }
      return;
    }

    const sourceId = auxSymlinkTargetPickerSourceId;
    const sourceNode = sourceId ? (auxNodeMap.get(sourceId) ?? null) : null;
    if (!sourceId || activeAuxPath !== sourceId || sourceNode?.nodeType !== "symlink") {
      setIsAuxSymlinkTargetPickerActive(false);
      setAuxSymlinkTargetPickerSourceId(null);
    }
  }, [
    activeAuxPath,
    auxNodeMap,
    auxSymlinkTargetPickerSourceId,
    isAuxSymlinkTargetPickerActive,
    setAuxSymlinkTargetPickerSourceId,
    setIsAuxSymlinkTargetPickerActive,
  ]);

  useEffect(() => {
    if (auxTree.length === 0) {
      return;
    }

    const hasVisibleExpandedNode = [...expandedAuxPaths].some((id) => auxPathSet.has(id));
    if (hasVisibleExpandedNode) {
      return;
    }

    const nextExpandedIds = auxTree
      .filter((node) => node.nodeType === "dir")
      .slice(0, 2)
      .map((node) => node.id);
    if (nextExpandedIds.length > 0) {
      setExpandedAuxPaths(new Set(nextExpandedIds));
    }
  }, [auxPathSet, auxTree, expandedAuxPaths, setExpandedAuxPaths]);

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

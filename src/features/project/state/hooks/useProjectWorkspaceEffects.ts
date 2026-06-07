import { useMolecule } from "bunshi/react";
import { useAtom, useSetAtom } from "jotai";
import { useEffect } from "react";

import { collectAncestorIds, findPreferredContentNode } from "@/features/project/model/tree";

import { AUTOSAVE_DELAY_MS } from "../constants";
import { EditorMolecule } from "../molecules/editor";
import { SelectionMolecule } from "../molecules/selection";
import type { ProjectWorkspace } from "./useProjectWorkspace";

export function useProjectWorkspaceEffects(
  workspace: ProjectWorkspace,
  flushBodySave: (_nodeId: string, _body: string) => Promise<void>,
) {
  const selection = useMolecule(SelectionMolecule);
  const editor = useMolecule(EditorMolecule);

  const [activeContentNodeId, setActiveContentNodeId] = useAtom(selection.activeContentNodeIdAtom);
  const [activeAuxNodeId, setActiveAuxNodeId] = useAtom(selection.activeAuxNodeIdAtom);
  const [, setActiveTimelinePointId] = useAtom(selection.activeTimelinePointIdAtom);
  const [, setExpandedContentIds] = useAtom(selection.expandedContentIdsAtom);
  const [expandedAuxIds, setExpandedAuxIds] = useAtom(selection.expandedAuxIdsAtom);
  const [drafts] = useAtom(editor.draftsAtom);
  const [committedBodies] = useAtom(editor.committedBodiesAtom);
  const setCommittedBodies = useSetAtom(editor.committedBodiesAtom);

  const {
    workspaceId,
    flatContentNodes,
    contentNodeMap,
    contentTree,
    contentParentMap,
    timelinePoints,
    timelinePointIdSet,
    auxTree,
    auxNodeIdSet,
    activeContentNode,
  } = workspace;

  useEffect(() => {
    if (flatContentNodes.length === 0) {
      setActiveContentNodeId(null);
      return;
    }

    if (activeContentNodeId && contentNodeMap.has(activeContentNodeId)) {
      return;
    }

    const preferredNode = findPreferredContentNode(contentTree) ?? flatContentNodes[0] ?? null;
    if (preferredNode) {
      setActiveContentNodeId(preferredNode.id);
    }
  }, [activeContentNodeId, contentNodeMap, contentTree, flatContentNodes, setActiveContentNodeId]);

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
      setActiveAuxNodeId(null);
      return;
    }

    if (activeAuxNodeId && auxNodeIdSet.has(activeAuxNodeId)) {
      return;
    }

    setActiveAuxNodeId(null);
  }, [activeAuxNodeId, auxNodeIdSet, auxTree, setActiveAuxNodeId]);

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
}

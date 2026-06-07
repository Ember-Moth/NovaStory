import { skipToken } from "@codehz/rpc";
import { useMolecule } from "bunshi/react";
import { useAtom } from "jotai";
import { useMemo } from "react";

import { rpc } from "@/api/client";
import type { ContentTreeNodeVM, SaveState } from "@/components/ProjectLayout/types";
import {
  buildContentParentMap,
  flattenAuxNodes,
  flattenContentNodes,
  normalizeAuxNodes,
  normalizeContentNodes,
  normalizeTimelinePoints,
} from "@/components/ProjectLayout/utils";
import { EditorMolecule } from "@/state/project/editorMolecule";
import { ErrorsMolecule } from "@/state/project/errorsMolecule";
import { SelectionMolecule } from "@/state/project/selectionMolecule";

export function useProjectWorkspace(projectId: string) {
  const selection = useMolecule(SelectionMolecule);
  const editor = useMolecule(EditorMolecule);
  const errors = useMolecule(ErrorsMolecule);

  const [activeContentNodeId] = useAtom(selection.activeContentNodeIdAtom);
  const [activeAuxNodeId] = useAtom(selection.activeAuxNodeIdAtom);
  const [activeTimelinePointId] = useAtom(selection.activeTimelinePointIdAtom);
  const [expandedContentIds] = useAtom(selection.expandedContentIdsAtom);
  const [expandedAuxIds] = useAtom(selection.expandedAuxIdsAtom);
  const [drafts] = useAtom(editor.draftsAtom);
  const [committedBodies] = useAtom(editor.committedBodiesAtom);
  const [pendingSaveCounts] = useAtom(editor.pendingSaveCountsAtom);
  const [saveErrors] = useAtom(editor.saveErrorsAtom);
  const [contentError] = useAtom(errors.contentErrorAtom);
  const [timelineError] = useAtom(errors.timelineErrorAtom);

  const workspaceQuery = rpc.useQuery("workspaces.default", { projectId });
  const workspaceId = workspaceQuery.data?.id;
  const contentRootId = workspaceQuery.data?.contentRootId ?? null;

  const timelineQuery = rpc.useQuery("timeline.list", workspaceId ? { workspaceId } : skipToken);
  const contentQuery = rpc.useQuery(
    "content.exportSubtree",
    workspaceId ? { workspaceId } : skipToken,
  );
  const auxQuery = rpc.useQuery(
    "aux.snapshotTree",
    workspaceId && activeTimelinePointId
      ? { workspaceId, pointId: activeTimelinePointId }
      : skipToken,
  );

  const createContent = rpc.useMutation("content.create");
  const deleteContent = rpc.useMutation("content.delete");
  const updateContent = rpc.useMutation("content.update");
  const createTimeline = rpc.useMutation("timeline.create");
  const moveTimeline = rpc.useMutation("timeline.move");
  const deleteTimeline = rpc.useMutation("timeline.delete");
  const updateTimeline = rpc.useMutation("timeline.update");

  const contentTree = useMemo(
    () => normalizeContentNodes(contentQuery.data?.nodes ?? []),
    [contentQuery.data],
  );
  const timelinePoints = useMemo(
    () => normalizeTimelinePoints(timelineQuery.data ?? []),
    [timelineQuery.data],
  );
  const auxTree = useMemo(() => normalizeAuxNodes(auxQuery.data?.nodes ?? []), [auxQuery.data]);

  const flatContentNodes = useMemo(() => flattenContentNodes(contentTree), [contentTree]);
  const contentNodeMap = useMemo(
    () => new Map(flatContentNodes.map((node) => [node.id, node])),
    [flatContentNodes],
  );
  const contentParentMap = useMemo(() => buildContentParentMap(contentTree), [contentTree]);
  const timelineLabelMap = useMemo(
    () => new Map(timelinePoints.map((point) => [point.id, point.label])),
    [timelinePoints],
  );
  const timelinePointIdSet = useMemo(
    () => new Set(timelinePoints.map((point) => point.id)),
    [timelinePoints],
  );
  const auxNodeIdSet = useMemo(
    () => new Set(flattenAuxNodes(auxTree).map((node) => node.id)),
    [auxTree],
  );

  const activeContentNode: ContentTreeNodeVM | null = activeContentNodeId
    ? (contentNodeMap.get(activeContentNodeId) ?? null)
    : null;
  const editorBody = activeContentNode
    ? (drafts[activeContentNode.id] ?? activeContentNode.body)
    : "";
  const activeTimelineLabel =
    (activeContentNode && timelineLabelMap.get(activeContentNode.anchorTimelinePointId)) ||
    (activeTimelinePointId ? timelineLabelMap.get(activeTimelinePointId) : undefined) ||
    "原点";
  const activeSaveBaseline = activeContentNode
    ? (committedBodies[activeContentNode.id] ?? activeContentNode.body)
    : "";
  const activeSaveState: SaveState = {
    isSaving: activeContentNode ? (pendingSaveCounts[activeContentNode.id] ?? 0) > 0 : false,
    isDirty: activeContentNode ? editorBody !== activeSaveBaseline : false,
    error: activeContentNode ? (saveErrors[activeContentNode.id] ?? null) : null,
  };

  const contentBusy = createContent.isPending || deleteContent.isPending;
  const timelineBusy =
    createTimeline.isPending ||
    moveTimeline.isPending ||
    deleteTimeline.isPending ||
    updateTimeline.isPending;
  const pageError =
    workspaceQuery.error?.message ??
    contentQuery.error?.message ??
    timelineQuery.error?.message ??
    auxQuery.error?.message ??
    null;

  return {
    projectId,
    workspaceQuery,
    workspaceId,
    contentRootId,
    timelineQuery,
    contentQuery,
    auxQuery,
    createContent,
    deleteContent,
    updateContent,
    createTimeline,
    moveTimeline,
    deleteTimeline,
    updateTimeline,
    contentTree,
    timelinePoints,
    auxTree,
    flatContentNodes,
    contentNodeMap,
    contentParentMap,
    timelineLabelMap,
    timelinePointIdSet,
    auxNodeIdSet,
    activeContentNodeId,
    activeAuxNodeId,
    activeTimelinePointId,
    expandedContentIds,
    expandedAuxIds,
    drafts,
    committedBodies,
    activeContentNode,
    editorBody,
    activeTimelineLabel,
    activeSaveState,
    contentError,
    timelineError,
    contentBusy,
    timelineBusy,
    pageError,
  };
}

export type ProjectWorkspace = ReturnType<typeof useProjectWorkspace>;

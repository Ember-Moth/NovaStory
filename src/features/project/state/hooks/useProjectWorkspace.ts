import { skipToken } from "@codehz/rpc";
import { useMolecule } from "bunshi/react";
import { useAtom } from "jotai";
import { useEffect, useMemo } from "react";

import {
  buildContentParentMap,
  flattenAuxNodes,
  flattenContentNodes,
  normalizeAuxNodes,
  normalizeContentNodes,
  normalizeTimelinePoints,
} from "@/features/project/model/normalize";
import { buildAuxParentMap, findAuxNode } from "@/features/project/model/tree";
import type { AuxTreeNodeVM, ContentTreeNodeVM, SaveState } from "@/features/project/model/types";
import { rpc } from "@/server/rpc/client";

import { EditorMolecule } from "../molecules/editor";
import { ErrorsMolecule } from "../molecules/errors";
import { SelectionMolecule } from "../molecules/selection";

type AuxSnapshotData = NonNullable<ReturnType<typeof rpc.useQuery<"aux.snapshotTree">>["data"]>;

const lastAuxSnapshotByWorkspace = new Map<string, AuxSnapshotData>();

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
  const [auxError] = useAtom(errors.auxErrorAtom);
  const [pageErrorDismissed, setPageErrorDismissed] = useAtom(errors.pageErrorDismissedAtom);

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
  if (workspaceId && auxQuery.data) {
    lastAuxSnapshotByWorkspace.set(workspaceId, auxQuery.data);
  }

  const visibleAuxSnapshot =
    auxQuery.data ?? (workspaceId ? lastAuxSnapshotByWorkspace.get(workspaceId) : undefined);
  const createContent = rpc.useMutation("content.create");
  const deleteContent = rpc.useMutation("content.delete");
  const updateContent = rpc.useMutation("content.update");
  const createTimeline = rpc.useMutation("timeline.create");
  const moveTimeline = rpc.useMutation("timeline.move");
  const deleteTimeline = rpc.useMutation("timeline.delete");
  const updateTimeline = rpc.useMutation("timeline.update");
  const mkdirAux = rpc.useMutation("aux.mkdir");
  const writeFileAux = rpc.useMutation("aux.writeFile");
  const moveAux = rpc.useMutation("aux.move");
  const deleteAux = rpc.useMutation("aux.delete");

  const contentTree = useMemo(
    () => normalizeContentNodes(contentQuery.data?.nodes ?? []),
    [contentQuery.data],
  );
  const timelinePoints = useMemo(
    () => normalizeTimelinePoints(timelineQuery.data ?? []),
    [timelineQuery.data],
  );
  const auxTree = useMemo(
    () => normalizeAuxNodes(visibleAuxSnapshot?.nodes ?? []),
    [visibleAuxSnapshot],
  );
  const auxRootId = visibleAuxSnapshot?.rootNodeId ?? null;

  const flatContentNodes = useMemo(() => flattenContentNodes(contentTree), [contentTree]);
  const contentNodeMap = useMemo(
    () => new Map(flatContentNodes.map((node) => [node.id, node])),
    [flatContentNodes],
  );
  const contentParentMap = useMemo(() => buildContentParentMap(contentTree), [contentTree]);
  const auxParentMap = useMemo(() => buildAuxParentMap(auxTree), [auxTree]);
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
  const activeAuxNode: AuxTreeNodeVM | null = activeAuxNodeId
    ? (findAuxNode(auxTree, activeAuxNodeId) ?? null)
    : null;
  const editorBody = activeContentNode
    ? (drafts[activeContentNode.id] ?? activeContentNode.body)
    : "";
  const editorContent =
    activeAuxNode?.nodeType === "file" ? (drafts[activeAuxNode.id] ?? activeAuxNode.content) : "";
  const activeTimelineLabel =
    (activeContentNode && timelineLabelMap.get(activeContentNode.anchorTimelinePointId)) ||
    (activeTimelinePointId ? timelineLabelMap.get(activeTimelinePointId) : undefined) ||
    "原点";
  const browsingTimelineLabel =
    (activeTimelinePointId && timelineLabelMap.get(activeTimelinePointId)) || "原点";
  const activeSaveBaseline = activeContentNode
    ? (committedBodies[activeContentNode.id] ?? activeContentNode.body)
    : "";
  const activeSaveState: SaveState = {
    isSaving: activeContentNode ? (pendingSaveCounts[activeContentNode.id] ?? 0) > 0 : false,
    isDirty: activeContentNode ? editorBody !== activeSaveBaseline : false,
    error: activeContentNode ? (saveErrors[activeContentNode.id] ?? null) : null,
  };
  const auxSaveBaseline =
    activeAuxNode?.nodeType === "file"
      ? (committedBodies[activeAuxNode.id] ?? activeAuxNode.content)
      : "";
  const auxSaveState: SaveState = {
    isSaving:
      activeAuxNode?.nodeType === "file" ? (pendingSaveCounts[activeAuxNode.id] ?? 0) > 0 : false,
    isDirty: activeAuxNode?.nodeType === "file" ? editorContent !== auxSaveBaseline : false,
    error: activeAuxNode?.nodeType === "file" ? (saveErrors[activeAuxNode.id] ?? null) : null,
  };
  const editorTarget: "content" | "aux" | null = activeAuxNode
    ? "aux"
    : activeContentNode
      ? "content"
      : null;

  const contentBusy = createContent.isPending || deleteContent.isPending || updateContent.isPending;
  const timelineBusy =
    createTimeline.isPending ||
    moveTimeline.isPending ||
    deleteTimeline.isPending ||
    updateTimeline.isPending;
  const auxBusy =
    mkdirAux.isPending || writeFileAux.isPending || moveAux.isPending || deleteAux.isPending;
  const auxInitialLoading =
    !auxQuery.isSkipped && !visibleAuxSnapshot && auxQuery.isLoading && !auxQuery.error;
  const auxRefreshing =
    !auxQuery.isSkipped &&
    !!visibleAuxSnapshot &&
    (auxQuery.isLoading || auxQuery.isStale) &&
    !auxQuery.error;
  const pageError =
    workspaceQuery.error?.message ??
    contentQuery.error?.message ??
    timelineQuery.error?.message ??
    auxQuery.error?.message ??
    null;

  useEffect(() => {
    if (pageError) {
      setPageErrorDismissed(false);
    }
  }, [pageError, setPageErrorDismissed]);

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
    mkdirAux,
    writeFileAux,
    moveAux,
    deleteAux,
    contentTree,
    timelinePoints,
    auxTree,
    auxRootId,
    flatContentNodes,
    contentNodeMap,
    contentParentMap,
    auxParentMap,
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
    activeAuxNode,
    editorBody,
    editorContent,
    activeTimelineLabel,
    browsingTimelineLabel,
    activeSaveState,
    auxSaveState,
    editorTarget,
    contentError,
    timelineError,
    auxError,
    contentBusy,
    timelineBusy,
    auxBusy,
    auxInitialLoading,
    auxRefreshing,
    pageError,
    pageErrorDismissed,
    setPageErrorDismissed,
  };
}

export type ProjectWorkspace = ReturnType<typeof useProjectWorkspace>;

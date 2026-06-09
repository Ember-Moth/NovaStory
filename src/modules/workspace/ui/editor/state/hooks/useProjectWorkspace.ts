import { skipToken } from "@codehz/rpc/react";
import { useMolecule } from "bunshi/react";
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useMemo } from "react";

import {
  buildAuxTreeState,
  buildContentTreeState,
  buildTimelineState,
} from "@/modules/workspace/ui/editor/model/normalize";
import { rpc } from "@/rpc/client";

import { deriveProjectEditorState, deriveProjectSelectionState } from "../helpers/projectView";
import { EditorMolecule } from "../molecules/editor";
import { ErrorsMolecule } from "../molecules/errors";
import { SelectionMolecule } from "../molecules/selection";

type AuxSnapshotData = NonNullable<ReturnType<typeof rpc.useQuery<"aux.snapshotTree">>["data"]>;
type RefreshableQueryState = {
  isSkipped: boolean;
  isRefetching: boolean;
  isStale: boolean;
  error: unknown;
};

export function selectVisibleAuxSnapshot(
  workspaceAuxRootId: string | null,
  snapshot: AuxSnapshotData | undefined,
) {
  return snapshot?.rootNodeId === workspaceAuxRootId ? snapshot : undefined;
}

export function isQueryRefreshing(query: RefreshableQueryState, hasVisibleData: boolean) {
  return (
    !query.isSkipped && hasVisibleData && (query.isRefetching || query.isStale) && !query.error
  );
}

export function useProjectWorkspaceIdentity(projectId: string) {
  const workspaceQuery = rpc.useQuery("workspaces.default", { projectId });
  const workspace = workspaceQuery.data?.projectId === projectId ? workspaceQuery.data : undefined;
  const workspaceId = workspace?.id;
  const contentRootId = workspace?.contentRootId ?? null;
  const workspaceAuxRootId = workspace?.auxRootId ?? null;
  const workspaceInitialLoading = workspaceQuery.isInitialLoading && !workspaceId;
  const error = workspaceQuery.error?.message ?? null;

  return useMemo(
    () => ({
      projectId,
      workspaceQuery,
      workspaceId,
      contentRootId,
      workspaceAuxRootId,
      workspaceInitialLoading,
      error,
    }),
    [
      contentRootId,
      error,
      projectId,
      workspaceAuxRootId,
      workspaceId,
      workspaceInitialLoading,
      workspaceQuery,
    ],
  );
}

export function useProjectContentData(workspaceId: string | undefined) {
  const contentQuery = rpc.useQuery(
    "content.exportSubtree",
    workspaceId ? { workspaceId } : skipToken,
  );

  const createContent = rpc.useMutation("content.create");
  const deleteContent = rpc.useMutation("content.delete");
  const moveContent = rpc.useMutation("content.move");
  const updateContent = rpc.useMutation("content.update");

  const contentState = useMemo(
    () => buildContentTreeState(contentQuery.data?.nodes ?? []),
    [contentQuery.data],
  );

  const busy =
    createContent.isPending ||
    deleteContent.isPending ||
    moveContent.isPending ||
    updateContent.isPending;
  const refreshing = isQueryRefreshing(contentQuery, contentState.tree.length > 0);
  const pending = busy || refreshing;
  const error = contentQuery.error?.message ?? null;

  return useMemo(
    () => ({
      query: contentQuery,
      createContent,
      deleteContent,
      moveContent,
      updateContent,
      tree: contentState.tree,
      flatNodes: contentState.flatNodes,
      nodeMap: contentState.nodeMap,
      parentMap: contentState.parentMap,
      busy,
      pending,
      refreshing,
      error,
    }),
    [
      busy,
      contentQuery,
      contentState.flatNodes,
      contentState.nodeMap,
      contentState.parentMap,
      contentState.tree,
      createContent,
      deleteContent,
      error,
      moveContent,
      pending,
      refreshing,
      updateContent,
    ],
  );
}

export function useProjectTimelineData(workspaceId: string | undefined) {
  const timelineQuery = rpc.useQuery("timeline.list", workspaceId ? { workspaceId } : skipToken);

  const createTimeline = rpc.useMutation("timeline.create");
  const moveTimeline = rpc.useMutation("timeline.move");
  const deleteTimeline = rpc.useMutation("timeline.delete");
  const updateTimeline = rpc.useMutation("timeline.update");

  const timelineState = useMemo(
    () => buildTimelineState(timelineQuery.data ?? []),
    [timelineQuery.data],
  );

  const busy =
    createTimeline.isPending ||
    moveTimeline.isPending ||
    deleteTimeline.isPending ||
    updateTimeline.isPending;
  const refreshing = isQueryRefreshing(timelineQuery, timelineState.points.length > 0);
  const pending = busy || refreshing;
  const error = timelineQuery.error?.message ?? null;

  return useMemo(
    () => ({
      query: timelineQuery,
      createTimeline,
      moveTimeline,
      deleteTimeline,
      updateTimeline,
      points: timelineState.points,
      labelMap: timelineState.labelMap,
      idSet: timelineState.idSet,
      busy,
      refreshing,
      pending,
      error,
    }),
    [
      busy,
      createTimeline,
      deleteTimeline,
      error,
      moveTimeline,
      pending,
      refreshing,
      timelineQuery,
      timelineState.idSet,
      timelineState.labelMap,
      timelineState.points,
      updateTimeline,
    ],
  );
}

export function useProjectAuxData(
  workspaceId: string | undefined,
  workspaceAuxRootId: string | null,
  activeTimelinePointId: string | null,
) {
  const auxQuery = rpc.useQuery(
    "aux.snapshotTree",
    workspaceId && activeTimelinePointId
      ? { workspaceId, pointId: activeTimelinePointId }
      : skipToken,
  );
  const visibleAuxSnapshot = selectVisibleAuxSnapshot(workspaceAuxRootId, auxQuery.data);

  const mkdirAux = rpc.useMutation("aux.mkdir");
  const writeFileAux = rpc.useMutation("aux.writeFile");
  const moveAux = rpc.useMutation("aux.move");
  const deleteAux = rpc.useMutation("aux.delete");
  const restoreAux = rpc.useMutation("aux.restore");

  const auxState = useMemo(
    () => buildAuxTreeState(visibleAuxSnapshot?.nodes ?? []),
    [visibleAuxSnapshot],
  );
  const rootId = visibleAuxSnapshot?.rootNodeId ?? null;

  const busy =
    mkdirAux.isPending ||
    writeFileAux.isPending ||
    moveAux.isPending ||
    deleteAux.isPending ||
    restoreAux.isPending;
  const initialLoading =
    !auxQuery.isSkipped && !visibleAuxSnapshot && auxQuery.isInitialLoading && !auxQuery.error;
  const refreshing = isQueryRefreshing(auxQuery, !!visibleAuxSnapshot);
  const pending = busy || refreshing;
  const error = auxQuery.error?.message ?? null;

  return useMemo(
    () => ({
      query: auxQuery,
      mkdirAux,
      writeFileAux,
      moveAux,
      deleteAux,
      restoreAux,
      tree: auxState.tree,
      rootId,
      nodeMap: auxState.nodeMap,
      parentMap: auxState.parentMap,
      idSet: auxState.idSet,
      busy,
      pending,
      initialLoading,
      refreshing,
      error,
    }),
    [
      auxQuery,
      auxState.idSet,
      auxState.nodeMap,
      auxState.parentMap,
      auxState.tree,
      busy,
      deleteAux,
      error,
      initialLoading,
      mkdirAux,
      moveAux,
      pending,
      refreshing,
      restoreAux,
      rootId,
      writeFileAux,
    ],
  );
}

export function useProjectSelectionView(data: {
  contentNodeMap: ProjectContentData["nodeMap"];
  auxNodeMap: ProjectAuxData["nodeMap"];
  timelineLabelMap: ProjectTimelineData["labelMap"];
}) {
  const selection = useMolecule(SelectionMolecule);

  const activeContentNodeId = useAtomValue(selection.activeContentNodeIdAtom);
  const activeAuxNodeId = useAtomValue(selection.activeAuxNodeIdAtom);
  const shouldAutoSelectContent = useAtomValue(selection.shouldAutoSelectContentAtom);
  const activeTimelinePointId = useAtomValue(selection.activeTimelinePointIdAtom);
  const expandedContentIds = useAtomValue(selection.expandedContentIdsAtom);
  const expandedAuxIds = useAtomValue(selection.expandedAuxIdsAtom);

  const derivedSelection = useMemo(
    () =>
      deriveProjectSelectionState({
        activeContentNodeId,
        activeAuxNodeId,
        activeTimelinePointId,
        contentNodeMap: data.contentNodeMap,
        auxNodeMap: data.auxNodeMap,
        timelineLabelMap: data.timelineLabelMap,
      }),
    [
      activeAuxNodeId,
      activeContentNodeId,
      activeTimelinePointId,
      data.auxNodeMap,
      data.contentNodeMap,
      data.timelineLabelMap,
    ],
  );

  return {
    activeContentNodeId,
    activeAuxNodeId,
    shouldAutoSelectContent,
    activeTimelinePointId,
    expandedContentIds,
    expandedAuxIds,
    ...derivedSelection,
  };
}

export function useProjectEditorView(
  selection: Pick<
    ProjectSelectionView,
    "activeContentNode" | "activeAuxNode" | "shouldAutoSelectContent"
  >,
) {
  const editor = useMolecule(EditorMolecule);

  const drafts = useAtomValue(editor.draftsAtom);
  const committedBodies = useAtomValue(editor.committedBodiesAtom);
  const pendingSaveCounts = useAtomValue(editor.pendingSaveCountsAtom);
  const saveErrors = useAtomValue(editor.saveErrorsAtom);

  return useMemo(
    () =>
      deriveProjectEditorState({
        activeContentNode: selection.activeContentNode,
        activeAuxNode: selection.activeAuxNode,
        shouldShowContent: selection.shouldAutoSelectContent,
        drafts,
        committedBodies,
        pendingSaveCounts,
        saveErrors,
      }),
    [
      committedBodies,
      drafts,
      pendingSaveCounts,
      saveErrors,
      selection.activeAuxNode,
      selection.activeContentNode,
      selection.shouldAutoSelectContent,
    ],
  );
}

export function useProjectPageErrorState(pageError: string | null) {
  const errors = useMolecule(ErrorsMolecule);
  const pageErrorDismissed = useAtomValue(errors.pageErrorDismissedAtom);
  const setPageErrorDismissed = useSetAtom(errors.pageErrorDismissedAtom);

  useEffect(() => {
    if (pageError) {
      setPageErrorDismissed(false);
    }
  }, [pageError, setPageErrorDismissed]);

  return {
    pageErrorDismissed,
    setPageErrorDismissed,
  };
}

export type ProjectWorkspaceIdentity = ReturnType<typeof useProjectWorkspaceIdentity>;
export type ProjectContentData = ReturnType<typeof useProjectContentData>;
export type ProjectTimelineData = ReturnType<typeof useProjectTimelineData>;
export type ProjectAuxData = ReturnType<typeof useProjectAuxData>;
export type ProjectSelectionView = ReturnType<typeof useProjectSelectionView>;
export type ProjectEditorView = ReturnType<typeof useProjectEditorView>;
export type ProjectPageErrorState = ReturnType<typeof useProjectPageErrorState>;
export type ProjectWorkspaceState = {
  identity: ProjectWorkspaceIdentity;
  content: ProjectContentData;
  timeline: ProjectTimelineData;
  aux: ProjectAuxData;
  selection: ProjectSelectionView;
  editor: ProjectEditorView;
};

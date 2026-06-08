import { skipToken } from "@codehz/rpc";
import { useMolecule } from "bunshi/react";
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useMemo } from "react";

import {
  buildAuxTreeState,
  buildContentTreeState,
  buildTimelineState,
} from "@/features/project/model/normalize";
import { rpc } from "@/server/rpc/client";

import { deriveProjectEditorState, deriveProjectSelectionState } from "../helpers/projectView";
import { EditorMolecule } from "../molecules/editor";
import { ErrorsMolecule } from "../molecules/errors";
import { SelectionMolecule } from "../molecules/selection";

type AuxSnapshotData = NonNullable<ReturnType<typeof rpc.useQuery<"aux.snapshotTree">>["data"]>;

function useVisibleAuxSnapshot(
  workspaceAuxRootId: string | null,
  snapshot: AuxSnapshotData | undefined,
) {
  return snapshot?.rootNodeId === workspaceAuxRootId ? snapshot : undefined;
}

export function useProjectWorkspaceData(projectId: string) {
  const selection = useMolecule(SelectionMolecule);
  const activeTimelinePointId = useAtomValue(selection.activeTimelinePointIdAtom);

  const workspaceQuery = rpc.useQuery("workspaces.default", { projectId });
  const workspace = workspaceQuery.data?.projectId === projectId ? workspaceQuery.data : undefined;
  const workspaceId = workspace?.id;
  const contentRootId = workspace?.contentRootId ?? null;
  const workspaceAuxRootId = workspace?.auxRootId ?? null;
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
  const visibleAuxSnapshot = useVisibleAuxSnapshot(workspaceAuxRootId, auxQuery.data);

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
  const restoreAux = rpc.useMutation("aux.restore");

  const contentState = useMemo(
    () => buildContentTreeState(contentQuery.data?.nodes ?? []),
    [contentQuery.data],
  );
  const timelineState = useMemo(
    () => buildTimelineState(timelineQuery.data ?? []),
    [timelineQuery.data],
  );
  const auxState = useMemo(
    () => buildAuxTreeState(visibleAuxSnapshot?.nodes ?? []),
    [visibleAuxSnapshot],
  );
  const auxRootId = visibleAuxSnapshot?.rootNodeId ?? null;

  const contentBusy = createContent.isPending || deleteContent.isPending || updateContent.isPending;
  const timelineBusy =
    createTimeline.isPending ||
    moveTimeline.isPending ||
    deleteTimeline.isPending ||
    updateTimeline.isPending;
  const auxBusy =
    mkdirAux.isPending ||
    writeFileAux.isPending ||
    moveAux.isPending ||
    deleteAux.isPending ||
    restoreAux.isPending;
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
    restoreAux,
    contentTree: contentState.tree,
    flatContentNodes: contentState.flatNodes,
    contentNodeMap: contentState.nodeMap,
    contentParentMap: contentState.parentMap,
    timelinePoints: timelineState.points,
    timelineLabelMap: timelineState.labelMap,
    timelinePointIdSet: timelineState.idSet,
    auxTree: auxState.tree,
    auxRootId,
    auxNodeMap: auxState.nodeMap,
    auxParentMap: auxState.parentMap,
    auxNodeIdSet: auxState.idSet,
    contentBusy,
    timelineBusy,
    auxBusy,
    auxInitialLoading,
    auxRefreshing,
    pageError,
  };
}

export function useProjectSelectionView(data: ProjectWorkspaceData) {
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

export type ProjectWorkspaceData = ReturnType<typeof useProjectWorkspaceData>;
export type ProjectSelectionView = ReturnType<typeof useProjectSelectionView>;
export type ProjectEditorView = ReturnType<typeof useProjectEditorView>;
export type ProjectPageErrorState = ReturnType<typeof useProjectPageErrorState>;
export type ProjectWorkspaceState = {
  data: ProjectWorkspaceData;
  selection: ProjectSelectionView;
  editor: ProjectEditorView;
};

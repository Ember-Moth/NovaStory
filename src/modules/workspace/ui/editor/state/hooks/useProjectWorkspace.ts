import { useEffect, useMemo } from "react";
import { skipToken } from "@/lib/rpc/react";

import {
  buildAuxTreeState,
  buildContentTreeState,
  buildTimelineState,
} from "@/modules/workspace/ui/editor/model/normalize";
import { rpc } from "@/rpc/client";

import { deriveProjectEditorState, deriveProjectSelectionState } from "../helpers/projectView";
import { useWorkspaceState } from "../molecules/workspaceStore";

type AuxSnapshotData = NonNullable<ReturnType<typeof rpc.useQuery<"aux.snapshotTree">>["data"]>;
type RefreshableQueryState = {
  isSkipped: boolean;
  isRefetching: boolean;
  isStale: boolean;
  error: unknown;
};
type PendingMutationState = {
  isPending: boolean;
};
type WorkspaceIdentityRow = NonNullable<ReturnType<typeof rpc.useQuery<"workspaces.get">>["data"]>;

export function selectVisibleAuxSnapshot(snapshot: AuxSnapshotData | null | undefined) {
  if (!snapshot) return undefined;
  return snapshot.rootPath === "/" ? snapshot : undefined;
}

export function isQueryRefreshing(query: RefreshableQueryState, hasVisibleData: boolean) {
  return (
    !query.isSkipped && hasVisibleData && (query.isRefetching || query.isStale) && !query.error
  );
}

export function isAuxBusy(mutations: PendingMutationState[]) {
  return mutations.some((mutation) => mutation.isPending);
}

export function resolveProjectWorkspaceIdentity({
  projectId,
  requestedWorkspaceId,
  workspace,
  isInitialLoading,
  queryErrorMessage,
}: {
  projectId: string;
  requestedWorkspaceId: string;
  workspace: WorkspaceIdentityRow | undefined;
  isInitialLoading: boolean;
  queryErrorMessage: string | null;
}) {
  const routeMismatch =
    workspace && workspace.projectId !== projectId ? "当前工作区不属于这个项目。" : null;
  const matchedWorkspace = routeMismatch ? undefined : workspace;
  const workspaceId = matchedWorkspace?.id;

  return {
    projectId,
    requestedWorkspaceId,
    workspaceId,
    workspaceInitialLoading: isInitialLoading && !workspace && !queryErrorMessage,
    routeMismatch,
    error: routeMismatch ?? queryErrorMessage,
  };
}

export function useProjectWorkspaceIdentity(projectId: string, requestedWorkspaceId: string) {
  const workspaceQuery = rpc.useQuery("workspaces.get", {
    projectId,
    workspaceId: requestedWorkspaceId,
  });
  const resolved = resolveProjectWorkspaceIdentity({
    projectId,
    requestedWorkspaceId,
    workspace: workspaceQuery.data,
    isInitialLoading: workspaceQuery.isInitialLoading,
    queryErrorMessage: workspaceQuery.error?.message ?? null,
  });

  return useMemo(
    () => ({
      workspaceQuery,
      ...resolved,
    }),
    [resolved, workspaceQuery],
  );
}

export function useProjectContentData(projectId: string, workspaceId: string | undefined) {
  const contentQuery = rpc.useQuery(
    "content.exportSubtree",
    workspaceId ? { projectId, workspaceId } : skipToken,
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

export function useProjectTimelineData(projectId: string, workspaceId: string | undefined) {
  const timelineQuery = rpc.useQuery(
    "timeline.list",
    workspaceId ? { projectId, workspaceId } : skipToken,
  );

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
  projectId: string,
  workspaceId: string | undefined,
  activeTimelinePointId: string | null,
) {
  const auxQuery = rpc.useQuery(
    "aux.snapshotTree",
    workspaceId && activeTimelinePointId
      ? { projectId, workspaceId, pointId: activeTimelinePointId }
      : skipToken,
  );
  const visibleAuxSnapshot = selectVisibleAuxSnapshot(auxQuery.data);

  const mkdirAux = rpc.useMutation("aux.mkdir");
  const writeFileAux = rpc.useMutation("aux.writeFile");
  const linkAux = rpc.useMutation("aux.link");
  const moveAux = rpc.useMutation("aux.move");
  const retargetSymlinkAux = rpc.useMutation("aux.retargetSymlink");
  const deleteAux = rpc.useMutation("aux.delete");
  const restoreDeletedAux = rpc.useMutation("aux.restoreDeleted");

  const auxState = useMemo(
    () => buildAuxTreeState(visibleAuxSnapshot?.nodes ?? []),
    [visibleAuxSnapshot],
  );
  const rootId = visibleAuxSnapshot?.rootPath ?? "/";

  const busy = isAuxBusy([
    mkdirAux,
    writeFileAux,
    linkAux,
    moveAux,
    retargetSymlinkAux,
    deleteAux,
    restoreDeletedAux,
  ]);
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
      linkAux,
      moveAux,
      retargetSymlinkAux,
      deleteAux,
      restoreDeletedAux,
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
      linkAux,
      mkdirAux,
      moveAux,
      retargetSymlinkAux,
      restoreDeletedAux,
      pending,
      refreshing,
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
  const activeContentNodeId = useWorkspaceState((state) => state.activeContentNodeId);
  const activeAuxPath = useWorkspaceState((state) => state.activeAuxPath);
  const shouldAutoSelectContent = useWorkspaceState((state) => state.shouldAutoSelectContent);
  const activeTimelinePointId = useWorkspaceState((state) => state.activeTimelinePointId);
  const expandedContentIds = useWorkspaceState((state) => state.expandedContentIds);
  const expandedAuxPaths = useWorkspaceState((state) => state.expandedAuxPaths);

  const derivedSelection = useMemo(
    () =>
      deriveProjectSelectionState({
        activeContentNodeId,
        activeAuxPath,
        activeTimelinePointId,
        contentNodeMap: data.contentNodeMap,
        auxNodeMap: data.auxNodeMap,
        timelineLabelMap: data.timelineLabelMap,
      }),
    [
      activeAuxPath,
      activeContentNodeId,
      activeTimelinePointId,
      data.auxNodeMap,
      data.contentNodeMap,
      data.timelineLabelMap,
    ],
  );

  return {
    activeContentNodeId,
    activeAuxPath,
    shouldAutoSelectContent,
    activeTimelinePointId,
    expandedContentIds,
    expandedAuxPaths,
    ...derivedSelection,
  };
}

export function useProjectEditorView(
  selection: Pick<
    ProjectSelectionView,
    "activeContentNode" | "activeAuxNode" | "shouldAutoSelectContent"
  >,
) {
  const drafts = useWorkspaceState((state) => state.drafts);
  const committedBodies = useWorkspaceState((state) => state.committedBodies);
  const pendingSaveCounts = useWorkspaceState((state) => state.pendingSaveCounts);
  const saveErrors = useWorkspaceState((state) => state.saveErrors);

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
  const pageErrorDismissed = useWorkspaceState((state) => state.pageErrorDismissed);
  const setPageErrorDismissed = useWorkspaceState((state) => state.setPageErrorDismissed);

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

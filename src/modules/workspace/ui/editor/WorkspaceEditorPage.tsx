import { ScopeProvider } from "bunshi/react";
import { useCallback, useEffect, useRef } from "react";

import { AppShell, AppSidebar } from "@/app/shell/AppShell";
import { useLastProjectStore } from "@/app/state/lastProject";
import type {
  TimelineSelectionUpdatedEvent,
  WorkspaceRefreshRequestedEvent,
} from "@/modules/ai/domain/types";
import { AiSidebar } from "@/modules/ai/ui/chat/AiSidebar";
import { ORIGIN_TIMELINE_POINT_ID } from "@/modules/workspace/domain/constants";
import { ActionErrorBubble } from "@/modules/workspace/ui/editor/components/ActionErrorBubble";
import { actionAnchorId, clearActionError } from "@/modules/workspace/ui/editor/model/action-error";
import { collectInvalidAuxSymlinkTargetIds } from "@/modules/workspace/ui/editor/model/tree";
import { AuxTreePanel } from "@/modules/workspace/ui/editor/panels/AuxTreePanel";
import { ContentTreePanel } from "@/modules/workspace/ui/editor/panels/ContentTreePanel";
import { EditorArea } from "@/modules/workspace/ui/editor/panels/EditorArea";
import { TimelinePanel } from "@/modules/workspace/ui/editor/panels/TimelinePanel";
import { buildProjectAssistantEditorContext } from "@/modules/workspace/ui/editor/state/helpers/projectView";
import { useProjectActions } from "@/modules/workspace/ui/editor/state/hooks/useProjectActions";
import {
  useProjectAuxData,
  useProjectContentData,
  useProjectEditorView,
  useProjectPageErrorState,
  useProjectSelectionView,
  useProjectTimelineData,
  useProjectWorkspaceIdentity,
} from "@/modules/workspace/ui/editor/state/hooks/useProjectWorkspace";
import { useProjectWorkspaceEffects } from "@/modules/workspace/ui/editor/state/hooks/useProjectWorkspaceEffects";
import {
  useWorkspaceState,
  useWorkspaceStoreApi,
} from "@/modules/workspace/ui/editor/state/molecules/workspaceStore";
import { ProjectScope } from "@/modules/workspace/ui/editor/state/scopes";
import {
  getAuxRefreshTargetPath,
  getAuxRefreshTargetTimelinePointId,
  getContentRefreshTargetNodeId,
  getContentRefreshTargetTimelinePointId,
  shouldClearActiveAuxDraftForRefresh,
  shouldClearActiveContentDraftForRefresh,
  shouldHandleWorkspaceRefreshRequested,
  shouldRefetchActiveAuxForRefresh,
  shouldResetWorkspaceLocalEditorState,
} from "@/modules/workspace/ui/editor/workspaceEditorPageModel";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { FullPageMessage } from "@/shared/ui/FullPageMessage";
import { IconButton } from "@/shared/ui/IconButton";
import { PanelPlaceholder } from "@/shared/ui/PanelPlaceholder";
import { SidebarLayoutScope, SidebarPanels } from "@/shared/ui/sidebar";

const CONTENT_CREATE_SIBLING_ANCHOR = actionAnchorId("content", "create-sibling");
const AUX_CREATE_DIR_ANCHOR = actionAnchorId("aux", "create-dir");
const AUX_CREATE_FILE_ANCHOR = actionAnchorId("aux", "create-file");
const AUX_CANCEL_RETARGET_ANCHOR = actionAnchorId("aux", "cancel-retarget");
const TIMELINE_ADD_ANCHOR = actionAnchorId("timeline", "add");
const PAGE_ERROR_ANCHOR = actionAnchorId("sidebar", "page-error");

function clearDraftStateForNode(
  workspaceStore: ReturnType<typeof useWorkspaceStoreApi>,
  nodeId: string,
) {
  workspaceStore.getState().setDrafts((previous) => {
    if (!(nodeId in previous)) {
      return previous;
    }
    const next = { ...previous };
    delete next[nodeId];
    return next;
  });
  workspaceStore.getState().setCommittedBodies((previous) => {
    if (!(nodeId in previous)) {
      return previous;
    }
    const next = { ...previous };
    delete next[nodeId];
    return next;
  });
  workspaceStore.getState().setPendingSaveCounts((previous) => {
    if (!(nodeId in previous)) {
      return previous;
    }
    const next = { ...previous };
    delete next[nodeId];
    return next;
  });
  workspaceStore.getState().setSaveErrors((previous) => {
    if (!(nodeId in previous)) {
      return previous;
    }
    const next = { ...previous };
    delete next[nodeId];
    return next;
  });
}

export function WorkspaceEditorPage({
  projectId,
  workspaceId,
}: {
  projectId: string;
  workspaceId: string;
}) {
  return (
    <ScopeProvider scope={ProjectScope} value={projectId}>
      <ScopeProvider scope={SidebarLayoutScope} value={`workspace:${projectId}`}>
        <ProjectWorkspace projectId={projectId} workspaceId={workspaceId} />
      </ScopeProvider>
    </ScopeProvider>
  );
}

function ProjectWorkspace({
  projectId,
  workspaceId: requestedWorkspaceId,
}: {
  projectId: string;
  workspaceId: string;
}) {
  const identity = useProjectWorkspaceIdentity(projectId, requestedWorkspaceId);
  const setLastWorkspaceRoute = useLastProjectStore((state) => state.setLastWorkspaceRoute);
  const content = useProjectContentData(projectId, identity.workspaceId);
  const timeline = useProjectTimelineData(projectId, identity.workspaceId);
  const rawActiveTimelinePointId = useWorkspaceState((state) => state.activeTimelinePointId);
  const aux = useProjectAuxData(projectId, identity.workspaceId, rawActiveTimelinePointId);
  const selection = useProjectSelectionView({
    contentNodeMap: content.nodeMap,
    auxNodeMap: aux.nodeMap,
    timelineLabelMap: timeline.labelMap,
  });
  const editorView = useProjectEditorView(selection);
  const pageError = identity.error ?? content.error ?? timeline.error ?? aux.error;
  const pageErrorState = useProjectPageErrorState(pageError);
  const workspace = { identity, content, timeline, aux, selection, editor: editorView };
  const actions = useProjectActions(workspace);
  const workspaceStore = useWorkspaceStoreApi();
  const setContentError = useWorkspaceState((state) => state.setContentError);
  const setTimelineError = useWorkspaceState((state) => state.setTimelineError);
  const setAuxError = useWorkspaceState((state) => state.setAuxError);
  const isAuxSymlinkTargetPickerActive = useWorkspaceState(
    (state) => state.isAuxSymlinkTargetPickerActive,
  );
  const auxSymlinkTargetPickerSourceId = useWorkspaceState(
    (state) => state.auxSymlinkTargetPickerSourceId,
  );
  useProjectWorkspaceEffects(workspace, actions.flushBodySave, actions.flushAuxSave);

  const { workspaceId, workspaceQuery, workspaceInitialLoading, routeMismatch } = identity;
  const workspaceDetail = workspaceQuery.data ?? null;
  const previousWorkspaceIdRef = useRef<string | null>(workspaceId ?? null);
  useEffect(() => {
    if (
      !workspaceId ||
      !workspaceDetail ||
      workspaceDetail.projectId !== projectId ||
      workspaceDetail.id !== workspaceId
    ) {
      return;
    }

    setLastWorkspaceRoute((current) => {
      if (
        current?.projectId === workspaceDetail.projectId &&
        current.workspaceId === workspaceDetail.id &&
        current.branchId === workspaceDetail.branchName
      ) {
        return current;
      }

      return {
        projectId: workspaceDetail.projectId,
        workspaceId: workspaceDetail.id,
        branchId: workspaceDetail.branchName,
      };
    });
  }, [projectId, setLastWorkspaceRoute, workspaceDetail, workspaceId]);
  useEffect(() => {
    const previousWorkspaceId = previousWorkspaceIdRef.current;
    const nextWorkspaceId = workspaceId ?? null;

    if (
      shouldResetWorkspaceLocalEditorState({
        previousWorkspaceId,
        nextWorkspaceId,
      })
    ) {
      const state = workspaceStore.getState();
      state.setDrafts({});
      state.setCommittedBodies({});
      state.setPendingSaveCounts({});
      state.setSaveErrors({});
    }

    previousWorkspaceIdRef.current = nextWorkspaceId;
  }, [workspaceId, workspaceStore]);
  const {
    query: contentQuery,
    pending: contentPending,
    tree: contentTree,
    busy: contentBusy,
  } = content;
  const {
    query: timelineQuery,
    pending: timelinePending,
    points: timelinePoints,
    labelMap: timelineLabelMap,
    busy: timelineBusy,
  } = timeline;
  const {
    tree: auxTree,
    rootId: auxRootPath,
    busy: auxBusy,
    pending: auxPending,
    initialLoading: auxInitialLoading,
  } = aux;
  const {
    activeContentNodeId,
    activeAuxPath,
    activeTimelinePointId,
    expandedContentIds,
    expandedAuxPaths,
    activeContentNode,
    activeAuxNode,
    activeTimelineLabel,
  } = selection;
  const { editorBody, editorContent, activeSaveState, auxSaveState, editorTarget } = editorView;
  const assistantContext = buildProjectAssistantEditorContext({
    workspaceId: workspaceId ?? null,
    editorTarget,
    activeContentNode,
    activeAuxNode,
    activeTimelinePointId,
    activeTimelineLabel:
      (activeTimelinePointId ? timelineLabelMap.get(activeTimelinePointId) : undefined) ?? "原点",
  });
  const { pageErrorDismissed, setPageErrorDismissed } = pageErrorState;
  const contentError = useWorkspaceState((state) => state.contentError);
  const timelineError = useWorkspaceState((state) => state.timelineError);
  const auxError = useWorkspaceState((state) => state.auxError);
  const symlinkTargetPickerSourceNode = auxSymlinkTargetPickerSourceId
    ? (aux.nodeMap.get(auxSymlinkTargetPickerSourceId) ?? null)
    : null;
  const invalidSymlinkTargetIds =
    symlinkTargetPickerSourceNode?.nodeType === "symlink"
      ? collectInvalidAuxSymlinkTargetIds(aux.nodeMap, symlinkTargetPickerSourceNode.id)
      : new Set<string>();

  const pageErrorBubble =
    pageError && !pageErrorDismissed ? { message: pageError, anchorId: PAGE_ERROR_ANCHOR } : null;
  const handleAssistantWorkspaceRefreshRequested = useCallback(
    (event: WorkspaceRefreshRequestedEvent | TimelineSelectionUpdatedEvent) => {
      if (!shouldHandleWorkspaceRefreshRequested({ event, workspaceId })) {
        return;
      }

      if (event.type === "timeline-selection-updated") {
        workspaceStore.getState().setActiveTimelinePointId(event.timelinePointId);
        return;
      }

      const contentTargetNodeId = getContentRefreshTargetNodeId(event);
      const contentTargetTimelinePointId = getContentRefreshTargetTimelinePointId(event);
      if (contentTargetNodeId) {
        const state = workspaceStore.getState();
        state.setShouldAutoSelectContent(true);
        state.setActiveAuxPath(null);
        state.setPendingContentNodeId(contentTargetNodeId);
        state.setActiveContentNodeId(contentTargetNodeId);
        if (
          contentTargetTimelinePointId &&
          contentTargetTimelinePointId !== activeTimelinePointId
        ) {
          state.setActiveTimelinePointId(contentTargetTimelinePointId);
        }
      }

      const auxTargetTimelinePointId = getAuxRefreshTargetTimelinePointId(event);
      if (auxTargetTimelinePointId && auxTargetTimelinePointId !== activeTimelinePointId) {
        workspaceStore.getState().setActiveTimelinePointId(auxTargetTimelinePointId);
      }

      const auxTargetPath = getAuxRefreshTargetPath(event);
      if (auxTargetPath) {
        const state = workspaceStore.getState();
        state.setActiveContentNodeId(null);
        state.setPendingAuxPath(auxTargetPath);
        state.setActiveAuxPath(auxTargetPath);
        state.setPendingAuxTimelinePointId(auxTargetTimelinePointId);
      }

      if (shouldClearActiveContentDraftForRefresh({ event, activeContentNodeId })) {
        if (activeContentNodeId) {
          clearDraftStateForNode(workspaceStore, activeContentNodeId);
        }
      }
      if (
        shouldClearActiveAuxDraftForRefresh({
          event,
          activeAuxNode,
          activeTimelinePointId,
        })
      ) {
        if (activeAuxNode?.nodeType === "file") {
          clearDraftStateForNode(workspaceStore, activeAuxNode.id);
        }
      }

      if (event.areas.includes("content")) {
        void contentQuery.refetch();
      }
      if (event.areas.includes("timeline")) {
        void timelineQuery.refetch();
      }
      if (shouldRefetchActiveAuxForRefresh({ event, activeTimelinePointId })) {
        void aux.query.refetch();
      }
    },
    [
      activeAuxNode,
      activeContentNodeId,
      activeTimelinePointId,
      aux.query,
      contentQuery,
      timelineQuery,
      workspaceId,
      workspaceStore,
    ],
  );

  if (workspaceInitialLoading) {
    return (
      <AppShell>
        <FullPageMessage
          icon="icon-[material-symbols--sync] animate-spin"
          title="正在加载工作区"
          description="正在读取工作区数据并准备编辑内容。"
          embedded
        />
      </AppShell>
    );
  }

  if (workspaceQuery.error || routeMismatch) {
    return (
      <AppShell>
        <FullPageMessage
          icon="icon-[material-symbols--warning]"
          title={routeMismatch ? "工作区与项目不匹配" : "工作区加载失败"}
          description={routeMismatch ?? workspaceQuery.error?.message ?? "未找到工作区。"}
          embedded
        />
      </AppShell>
    );
  }

  if (!workspaceId) {
    return (
      <AppShell>
        <FullPageMessage
          icon="icon-[material-symbols--folder-off]"
          title="未找到工作区"
          description={`未能定位工作区「${requestedWorkspaceId}」，因此无法进入编辑页。`}
          embedded
        />
      </AppShell>
    );
  }

  return (
    <>
      <ActionErrorBubble error={contentError} onDismiss={() => clearActionError(setContentError)} />
      <ActionErrorBubble error={auxError} onDismiss={() => clearActionError(setAuxError)} />
      <ActionErrorBubble
        error={timelineError}
        onDismiss={() => clearActionError(setTimelineError)}
      />
      <ActionErrorBubble
        error={pageErrorBubble}
        onDismiss={() => setPageErrorDismissed(true)}
        size="sm"
      />
      <ConfirmDialog
        open={actions.timelineDeleteDialog !== null}
        title={
          actions.timelineDeleteDialog
            ? `删除时间点「${actions.timelineDeleteDialog.pointLabel}」`
            : ""
        }
        description="该时间点下存在以下辅助信息变动，删除时间点将撤销这些变动（不影响其他时间点的继承内容）。"
        items={actions.timelineDeleteDialog?.auxPaths ?? []}
        confirmLabel="删除时间点及辅助信息"
        cancelLabel="取消"
        isPending={timelineBusy}
        onConfirm={actions.handleTimelineDeleteConfirm}
        onCancel={actions.handleTimelineDeleteCancel}
      />

      <AppShell
        className="relative"
        data-project-editor
        sidebar={
          <AppSidebar>
            <div
              data-action-anchor={PAGE_ERROR_ANCHOR}
              className="pointer-events-none absolute top-2 left-2 size-px"
              aria-hidden
            />

            <SidebarPanels
              panels={[
                {
                  title: "正文",
                  actions: (
                    <IconButton
                      icon="icon-[material-symbols--add]"
                      title="添加同级节点"
                      onClick={() =>
                        actions.handleContentCreateSibling(CONTENT_CREATE_SIBLING_ANCHOR)
                      }
                      disabled={contentPending || !activeTimelinePointId}
                      anchorId={CONTENT_CREATE_SIBLING_ANCHOR}
                    />
                  ),
                  content:
                    contentQuery.isInitialLoading && contentTree.length === 0 ? (
                      <PanelPlaceholder variant="refresh" label="正在加载正文..." />
                    ) : (
                      <ContentTreePanel
                        tree={contentTree}
                        expandedIds={expandedContentIds}
                        onToggle={actions.toggleContentExpanded}
                        onSelect={actions.handleContentSelect}
                        onRename={actions.handleContentRename}
                        activeId={activeContentNodeId}
                        timelineLabelMap={timelineLabelMap}
                        onCreateChild={actions.handleContentCreateChild}
                        onDelete={actions.handleContentDelete}
                        onMove={actions.handleContentMove}
                        isBusy={contentBusy}
                        isPending={contentPending}
                        canCreate={!!activeTimelinePointId}
                      />
                    ),
                },
                {
                  title: "辅助信息",
                  actions: isAuxSymlinkTargetPickerActive ? (
                    <IconButton
                      icon="icon-[material-symbols--close]"
                      title="取消选择目标"
                      onClick={actions.cancelAuxSymlinkTargetPicker}
                      disabled={auxPending}
                      anchorId={AUX_CANCEL_RETARGET_ANCHOR}
                    />
                  ) : (
                    <>
                      <IconButton
                        icon="icon-[material-symbols--create-new-folder]"
                        title="添加文件夹"
                        onClick={() => actions.handleAuxCreateSiblingDir(AUX_CREATE_DIR_ANCHOR)}
                        disabled={auxPending || !activeTimelinePointId}
                        anchorId={AUX_CREATE_DIR_ANCHOR}
                      />
                      <IconButton
                        icon="icon-[material-symbols--note-add]"
                        title="添加文件"
                        onClick={() => actions.handleAuxCreateSiblingFile(AUX_CREATE_FILE_ANCHOR)}
                        disabled={auxPending || !activeTimelinePointId}
                        anchorId={AUX_CREATE_FILE_ANCHOR}
                      />
                    </>
                  ),
                  content: auxInitialLoading ? (
                    <PanelPlaceholder variant="refresh" label="正在根据当前时间点加载辅助信息..." />
                  ) : (
                    <AuxTreePanel
                      tree={auxTree}
                      rootId={auxRootPath}
                      expandedIds={expandedAuxPaths}
                      onToggle={actions.toggleAuxExpanded}
                      activeId={activeAuxPath}
                      onSelect={actions.handleAuxSelect}
                      onCreateChildDir={actions.handleAuxCreateChildDir}
                      onCreateChildFile={actions.handleAuxCreateChildFile}
                      onCreateSymlink={actions.handleAuxCreateSymlink}
                      onStartRetargetSymlink={(node) =>
                        actions.enterAuxSymlinkTargetPicker(node.id)
                      }
                      onRename={actions.handleAuxRename}
                      onMove={actions.handleAuxMove}
                      onDelete={actions.handleAuxDelete}
                      onRestoreDeleted={actions.handleAuxRestoreDeleted}
                      symlinkTargetPicker={
                        symlinkTargetPickerSourceNode?.nodeType === "symlink"
                          ? {
                              active: isAuxSymlinkTargetPickerActive,
                              sourceNodeId: symlinkTargetPickerSourceNode.id,
                              selectedTargetNodeId: symlinkTargetPickerSourceNode.symlinkTargetPath,
                              invalidTargetNodeIds: invalidSymlinkTargetIds,
                              onPickTarget: actions.submitAuxSymlinkTargetRetarget,
                            }
                          : {
                              active: false,
                              sourceNodeId: null,
                              selectedTargetNodeId: null,
                              invalidTargetNodeIds: new Set<string>(),
                              onPickTarget: actions.submitAuxSymlinkTargetRetarget,
                            }
                      }
                      isBusy={auxBusy}
                      isPending={auxPending}
                      showTimelineChanges={activeTimelinePointId !== ORIGIN_TIMELINE_POINT_ID}
                    />
                  ),
                },
                {
                  title: "时间轴",
                  actions: (
                    <IconButton
                      icon="icon-[material-symbols--add]"
                      title="添加时间点"
                      onClick={() => actions.handleTimelineAdd(TIMELINE_ADD_ANCHOR)}
                      disabled={timelinePending || !activeTimelinePointId}
                      anchorId={TIMELINE_ADD_ANCHOR}
                    />
                  ),
                  content:
                    timelineQuery.isInitialLoading && timelinePoints.length === 0 ? (
                      <PanelPlaceholder variant="refresh" label="正在加载时间轴..." />
                    ) : (
                      <TimelinePanel
                        points={timelinePoints}
                        activeId={activeTimelinePointId}
                        anchoredPointId={
                          editorTarget === "content"
                            ? (activeContentNode?.anchorTimelinePointId ?? null)
                            : null
                        }
                        canSetAnchor={editorTarget === "content" && !!activeContentNode}
                        isBusy={timelineBusy}
                        isPending={timelinePending}
                        onSelect={actions.handleTimelineSelect}
                        onSetAnchor={actions.handleContentAnchorSet}
                        onMove={actions.handleTimelineMove}
                        onDelete={actions.handleTimelineDelete}
                        onRename={actions.handleTimelineRename}
                      />
                    ),
                },
              ]}
            />
          </AppSidebar>
        }
      >
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="min-w-0 flex-1">
            <EditorArea
              target={editorTarget}
              contentNode={activeContentNode}
              auxNode={activeAuxNode}
              body={editorBody}
              auxContent={editorContent}
              timelineLabel={activeTimelineLabel}
              contentSaveState={activeSaveState}
              auxSaveState={auxSaveState}
              auxPending={auxPending}
              isAuxSymlinkTargetPickerActive={isAuxSymlinkTargetPickerActive}
              onBodyChange={actions.handleBodyChange}
              onAuxContentChange={actions.handleAuxContentChange}
            />
          </div>
          <AiSidebar
            projectId={projectId}
            context={assistantContext}
            onWorkspaceRefreshRequested={handleAssistantWorkspaceRefreshRequested}
          />
        </div>
      </AppShell>
    </>
  );
}

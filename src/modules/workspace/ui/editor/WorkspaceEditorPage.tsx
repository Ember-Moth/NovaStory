import { ScopeProvider } from "bunshi/react";
import { useCallback, useMemo } from "react";

import { AppShell, AppSidebar } from "@/app/shell/AppShell";
import type {
  ProjectAssistantContextSnapshot,
  WorkspaceMutationEvent,
} from "@/modules/ai/domain/types";
import { ActionErrorBubble } from "@/modules/workspace/ui/editor/components/ActionErrorBubble";
import { AiSidebar } from "@/modules/ai/ui/assistant/AiSidebar";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { FullPageMessage } from "@/shared/ui/FullPageMessage";
import { IconButton } from "@/shared/ui/IconButton";
import { PanelPlaceholder } from "@/shared/ui/PanelPlaceholder";
import { SidebarLayoutScope, SidebarPanels } from "@/shared/ui/sidebar";
import { actionAnchorId, clearActionError } from "@/modules/workspace/ui/editor/model/action-error";
import { AuxTreePanel } from "@/modules/workspace/ui/editor/panels/AuxTreePanel";
import { ContentTreePanel } from "@/modules/workspace/ui/editor/panels/ContentTreePanel";
import { EditorArea } from "@/modules/workspace/ui/editor/panels/EditorArea";
import { TimelinePanel } from "@/modules/workspace/ui/editor/panels/TimelinePanel";
import { useProjectActions } from "@/modules/workspace/ui/editor/state/hooks/useProjectActions";
import type { AuxTreeNodeVM } from "@/modules/workspace/ui/editor/model/types";
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
import { ORIGIN_TIMELINE_POINT_ID } from "@/modules/workspace/domain/constants";

const CONTENT_CREATE_SIBLING_ANCHOR = actionAnchorId("content", "create-sibling");
const AUX_CREATE_DIR_ANCHOR = actionAnchorId("aux", "create-dir");
const AUX_CREATE_FILE_ANCHOR = actionAnchorId("aux", "create-file");
const TIMELINE_ADD_ANCHOR = actionAnchorId("timeline", "add");
const PAGE_ERROR_ANCHOR = actionAnchorId("sidebar", "page-error");

export function shouldRefetchAuxForWorkspaceMutation({
  event,
  workspaceId,
  activeTimelinePointId,
}: {
  event: WorkspaceMutationEvent;
  workspaceId: string | null | undefined;
  activeTimelinePointId: string | null;
}) {
  return (
    event.area === "aux" &&
    workspaceId != null &&
    event.workspaceId === workspaceId &&
    activeTimelinePointId != null &&
    event.timelinePointId === activeTimelinePointId
  );
}

export function isActiveAuxFileMutationTarget({
  event,
  activeAuxNode,
}: {
  event: WorkspaceMutationEvent;
  activeAuxNode: AuxTreeNodeVM | null;
}) {
  if (activeAuxNode?.nodeType !== "file") {
    return false;
  }

  if (event.nodeId && event.nodeId === activeAuxNode.id) {
    return true;
  }

  return activeAuxNode.path === event.path;
}

export function handleAuxWorkspaceMutationForEditor({
  event,
  workspaceId,
  activeTimelinePointId,
  activeAuxNode,
  refetchAux,
  clearActiveAuxDraftState,
}: {
  event: WorkspaceMutationEvent;
  workspaceId: string | null | undefined;
  activeTimelinePointId: string | null;
  activeAuxNode: AuxTreeNodeVM | null;
  refetchAux: () => void;
  clearActiveAuxDraftState: (_nodeId: string) => void;
}) {
  if (
    !shouldRefetchAuxForWorkspaceMutation({
      event,
      workspaceId,
      activeTimelinePointId,
    })
  ) {
    return false;
  }

  if (
    isActiveAuxFileMutationTarget({
      event,
      activeAuxNode,
    }) &&
    activeAuxNode?.nodeType === "file"
  ) {
    clearActiveAuxDraftState(activeAuxNode.id);
  }

  refetchAux();
  return true;
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
  const content = useProjectContentData(identity.workspaceId);
  const timeline = useProjectTimelineData(identity.workspaceId);
  const rawActiveTimelinePointId = useWorkspaceState((state) => state.activeTimelinePointId);
  const aux = useProjectAuxData(
    identity.workspaceId,
    identity.workspaceAuxRootId,
    rawActiveTimelinePointId,
  );
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
  useProjectWorkspaceEffects(workspace, actions.flushBodySave, actions.flushAuxSave);

  const { workspaceId, contentRootId, workspaceQuery, workspaceInitialLoading, routeMismatch } =
    identity;
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
    rootId: auxRootId,
    busy: auxBusy,
    pending: auxPending,
    initialLoading: auxInitialLoading,
  } = aux;
  const {
    activeContentNodeId,
    activeAuxNodeId,
    activeTimelinePointId,
    expandedContentIds,
    expandedAuxIds,
    activeContentNode,
    activeAuxNode,
    activeTimelineLabel,
    browsingTimelineLabel,
  } = selection;
  const { editorBody, editorContent, activeSaveState, auxSaveState, editorTarget } = editorView;
  const { pageErrorDismissed, setPageErrorDismissed } = pageErrorState;
  const contentError = useWorkspaceState((state) => state.contentError);
  const timelineError = useWorkspaceState((state) => state.timelineError);
  const auxError = useWorkspaceState((state) => state.auxError);

  const pageErrorBubble =
    pageError && !pageErrorDismissed ? { message: pageError, anchorId: PAGE_ERROR_ANCHOR } : null;
  const assistantContext = useMemo<ProjectAssistantContextSnapshot>(
    () => ({
      workspaceId: workspaceId ?? null,
      activeContentNodeId,
      activeContentTitle: activeContentNode?.title ?? null,
      activeAuxNodeId,
      activeAuxPath: activeAuxNode?.path ?? null,
      activeTimelinePointId,
      activeTimelineLabel: browsingTimelineLabel ?? activeTimelineLabel,
    }),
    [
      activeAuxNode?.path,
      activeAuxNodeId,
      activeContentNode?.title,
      activeContentNodeId,
      activeTimelineLabel,
      activeTimelinePointId,
      browsingTimelineLabel,
      workspaceId,
    ],
  );
  const handleAssistantWorkspaceMutation = useCallback(
    (event: WorkspaceMutationEvent) => {
      handleAuxWorkspaceMutationForEditor({
        event,
        workspaceId,
        activeTimelinePointId,
        activeAuxNode,
        refetchAux: () => {
          void aux.query.refetch();
        },
        clearActiveAuxDraftState: (activeNodeId) => {
          workspaceStore.getState().setDrafts((previous) => {
            if (!(activeNodeId in previous)) {
              return previous;
            }
            const next = { ...previous };
            delete next[activeNodeId];
            return next;
          });
          workspaceStore.getState().setCommittedBodies((previous) => {
            if (!(activeNodeId in previous)) {
              return previous;
            }
            const next = { ...previous };
            delete next[activeNodeId];
            return next;
          });
          workspaceStore.getState().setPendingSaveCounts((previous) => {
            if (!(activeNodeId in previous)) {
              return previous;
            }
            const next = { ...previous };
            delete next[activeNodeId];
            return next;
          });
          workspaceStore.getState().setSaveErrors((previous) => {
            if (!(activeNodeId in previous)) {
              return previous;
            }
            const next = { ...previous };
            delete next[activeNodeId];
            return next;
          });
        },
      });
    },
    [activeAuxNode, activeTimelinePointId, aux.query, workspaceId, workspaceStore],
  );

  if (workspaceInitialLoading) {
    return (
      <AppShell active="project">
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
      <AppShell active="project">
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
      <AppShell active="project">
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
        active="project"
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
                      disabled={contentPending || !contentRootId || !activeTimelinePointId}
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
                  actions: (
                    <>
                      <IconButton
                        icon="icon-[material-symbols--create-new-folder]"
                        title="添加文件夹"
                        onClick={() => actions.handleAuxCreateSiblingDir(AUX_CREATE_DIR_ANCHOR)}
                        disabled={auxPending || !auxRootId || !activeTimelinePointId}
                        anchorId={AUX_CREATE_DIR_ANCHOR}
                      />
                      <IconButton
                        icon="icon-[material-symbols--note-add]"
                        title="添加文件"
                        onClick={() => actions.handleAuxCreateSiblingFile(AUX_CREATE_FILE_ANCHOR)}
                        disabled={auxPending || !auxRootId || !activeTimelinePointId}
                        anchorId={AUX_CREATE_FILE_ANCHOR}
                      />
                    </>
                  ),
                  content: auxInitialLoading ? (
                    <PanelPlaceholder variant="refresh" label="正在根据当前时间点加载辅助信息..." />
                  ) : (
                    <AuxTreePanel
                      tree={auxTree}
                      expandedIds={expandedAuxIds}
                      onToggle={actions.toggleAuxExpanded}
                      activeId={activeAuxNodeId}
                      onSelect={actions.handleAuxSelect}
                      onCreateChildDir={actions.handleAuxCreateChildDir}
                      onCreateChildFile={actions.handleAuxCreateChildFile}
                      onRename={actions.handleAuxRename}
                      onDelete={actions.handleAuxDelete}
                      onRestore={actions.handleAuxRestore}
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
                        onReorder={actions.handleTimelineReorder}
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
              onBodyChange={actions.handleBodyChange}
              onAuxContentChange={actions.handleAuxContentChange}
            />
          </div>
          <AiSidebar
            projectId={projectId}
            contextSnapshot={assistantContext}
            onWorkspaceMutation={handleAssistantWorkspaceMutation}
          />
        </div>
      </AppShell>
    </>
  );
}

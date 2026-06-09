import { ScopeProvider, useMolecule } from "bunshi/react";
import { useAtomValue, useSetAtom } from "jotai";

import { AppShell, AppSidebar } from "@/app/shell/AppShell";
import { ActionErrorBubble } from "@/modules/workspace/ui/editor/components/ActionErrorBubble";
import { AiSidebar } from "@/modules/ai/ui/assistant/AiSidebar";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { FullPageMessage } from "@/shared/ui/FullPageMessage";
import { IconButton } from "@/shared/ui/IconButton";
import { PanelPlaceholder } from "@/shared/ui/PanelPlaceholder";
import { SidebarPanels } from "@/modules/workspace/ui/editor/components/SidebarPanels";
import { actionAnchorId, clearActionError } from "@/modules/workspace/ui/editor/model/action-error";
import { AuxTreePanel } from "@/modules/workspace/ui/editor/panels/AuxTreePanel";
import { ContentTreePanel } from "@/modules/workspace/ui/editor/panels/ContentTreePanel";
import { EditorArea } from "@/modules/workspace/ui/editor/panels/EditorArea";
import { TimelinePanel } from "@/modules/workspace/ui/editor/panels/TimelinePanel";
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
import { ErrorsMolecule } from "@/modules/workspace/ui/editor/state/molecules/errors";
import { SelectionMolecule } from "@/modules/workspace/ui/editor/state/molecules/selection";
import { ProjectScope } from "@/modules/workspace/ui/editor/state/scopes";
import { ORIGIN_TIMELINE_POINT_ID } from "@/modules/workspace/domain/constants";

const CONTENT_CREATE_SIBLING_ANCHOR = actionAnchorId("content", "create-sibling");
const AUX_CREATE_DIR_ANCHOR = actionAnchorId("aux", "create-dir");
const AUX_CREATE_FILE_ANCHOR = actionAnchorId("aux", "create-file");
const TIMELINE_ADD_ANCHOR = actionAnchorId("timeline", "add");
const PAGE_ERROR_ANCHOR = actionAnchorId("sidebar", "page-error");

export function WorkspaceEditorPage({ id: projectId }: { id: string }) {
  return (
    <ScopeProvider scope={ProjectScope} value={projectId}>
      <ProjectWorkspace projectId={projectId} />
    </ScopeProvider>
  );
}

function ProjectWorkspace({ projectId }: { projectId: string }) {
  const identity = useProjectWorkspaceIdentity(projectId);
  const content = useProjectContentData(identity.workspaceId);
  const timeline = useProjectTimelineData(identity.workspaceId);
  const selectionMolecule = useMolecule(SelectionMolecule);
  const rawActiveTimelinePointId = useAtomValue(selectionMolecule.activeTimelinePointIdAtom);
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
  const errors = useMolecule(ErrorsMolecule);
  const setContentError = useSetAtom(errors.contentErrorAtom);
  const setTimelineError = useSetAtom(errors.timelineErrorAtom);
  const setAuxError = useSetAtom(errors.auxErrorAtom);
  useProjectWorkspaceEffects(workspace, actions.flushBodySave, actions.flushAuxSave);

  const { workspaceId, contentRootId, workspaceQuery, workspaceInitialLoading } = identity;
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
  } = selection;
  const { editorBody, editorContent, activeSaveState, auxSaveState, editorTarget } = editorView;
  const { pageErrorDismissed, setPageErrorDismissed } = pageErrorState;
  const contentError = useAtomValue(errors.contentErrorAtom);
  const timelineError = useAtomValue(errors.timelineErrorAtom);
  const auxError = useAtomValue(errors.auxErrorAtom);

  const pageErrorBubble =
    pageError && !pageErrorDismissed ? { message: pageError, anchorId: PAGE_ERROR_ANCHOR } : null;

  if (workspaceInitialLoading) {
    return (
      <AppShell active="project">
        <FullPageMessage
          icon="icon-[material-symbols--sync] animate-spin"
          title="正在加载项目"
          description="正在解析默认工作区并准备编辑数据。"
          embedded
        />
      </AppShell>
    );
  }

  if (workspaceQuery.error) {
    return (
      <AppShell active="project">
        <FullPageMessage
          icon="icon-[material-symbols--warning]"
          title="项目加载失败"
          description={workspaceQuery.error.message}
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
          title="未找到默认工作区"
          description="这个项目暂时没有可用的默认工作区，因此无法进入编辑页。"
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
          <AiSidebar />
        </div>
      </AppShell>
    </>
  );
}

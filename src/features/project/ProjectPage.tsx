import { ScopeProvider } from "bunshi/react";

import { FullPageMessage } from "@/features/project/components/FullPageMessage";
import { PanelPlaceholder } from "@/features/project/components/PanelPlaceholder";
import { SidebarPanels } from "@/features/project/components/SidebarPanels";
import { AuxTreePanel } from "@/features/project/panels/AuxTreePanel";
import { ContentTreePanel } from "@/features/project/panels/ContentTreePanel";
import { EditorArea } from "@/features/project/panels/EditorArea";
import { TimelinePanel } from "@/features/project/panels/TimelinePanel";
import { useProjectActions } from "@/features/project/state/hooks/useProjectActions";
import { useProjectWorkspace } from "@/features/project/state/hooks/useProjectWorkspace";
import { useProjectWorkspaceEffects } from "@/features/project/state/hooks/useProjectWorkspaceEffects";
import { ProjectScope } from "@/features/project/state/scopes";

export function ProjectPage({ id: projectId }: { id: string }) {
  return (
    <ScopeProvider scope={ProjectScope} value={projectId}>
      <ProjectWorkspace projectId={projectId} />
    </ScopeProvider>
  );
}

function ProjectWorkspace({ projectId }: { projectId: string }) {
  const workspace = useProjectWorkspace(projectId);
  const actions = useProjectActions(workspace);
  useProjectWorkspaceEffects(workspace, actions.flushBodySave, actions.flushAuxSave);

  const {
    workspaceQuery,
    workspaceId,
    contentRootId,
    contentQuery,
    timelineQuery,
    auxQuery,
    contentTree,
    timelinePoints,
    auxTree,
    timelineLabelMap,
    activeContentNodeId,
    activeAuxNodeId,
    activeTimelinePointId,
    expandedContentIds,
    expandedAuxIds,
    activeContentNode,
    activeAuxNode,
    editorBody,
    editorContent,
    activeTimelineLabel,
    activeSaveState,
    auxSaveState,
    editorTarget,
    auxRootId,
    contentError,
    timelineError,
    auxError,
    contentBusy,
    timelineBusy,
    auxBusy,
    pageError,
  } = workspace;

  if (workspaceQuery.isLoading) {
    return (
      <FullPageMessage
        icon="icon-[material-symbols--sync]"
        title="正在加载项目"
        description="正在解析默认工作区并准备编辑数据。"
      />
    );
  }

  if (workspaceQuery.error) {
    return (
      <FullPageMessage
        icon="icon-[material-symbols--warning]"
        title="项目加载失败"
        description={workspaceQuery.error.message}
      />
    );
  }

  if (!workspaceId) {
    return (
      <FullPageMessage
        icon="icon-[material-symbols--folder-off]"
        title="未找到默认工作区"
        description="这个项目暂时没有可用的默认工作区，因此无法进入编辑页。"
      />
    );
  }

  return (
    <div className="flex h-dvh w-full select-none overflow-hidden bg-editor-background text-foreground">
      <div className="flex w-12 shrink-0 flex-col items-center gap-1 bg-activity-bar-background pt-2">
        <div className="flex w-full items-center justify-center border-l-2 border-l-activity-bar-active-foreground py-1">
          <span className="icon-[material-symbols--description] text-2xl text-activity-bar-active-foreground" />
        </div>
        <div className="flex w-full items-center justify-center py-1">
          <span className="icon-[material-symbols--search] text-2xl text-activity-bar-foreground" />
        </div>
        <div className="flex w-full items-center justify-center py-1">
          <span className="icon-[material-symbols--account-tree] text-2xl text-activity-bar-foreground" />
        </div>
        <div className="mt-auto flex w-full items-center justify-center py-2">
          <span className="icon-[material-symbols--settings] text-2xl text-activity-bar-foreground" />
        </div>
      </div>

      <div className="flex w-72 shrink-0 flex-col overflow-hidden border-r border-border bg-sidebar-background">
        {pageError ? (
          <div className="m-2 flex items-start gap-2 rounded-md border border-border bg-editor-background px-3 py-2 text-sm text-accent-foreground">
            <span className="icon-[material-symbols--warning] mt-0.5 shrink-0 text-base" />
            <span>{pageError}</span>
          </div>
        ) : null}

        <SidebarPanels
          panels={[
            {
              title: "正文",
              actions: (
                <button
                  type="button"
                  onClick={actions.handleContentCreateSibling}
                  disabled={contentBusy || !contentRootId || !activeTimelinePointId}
                  className="icon-[material-symbols--add] text-base hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  title="添加同级节点"
                />
              ),
              content:
                contentQuery.isLoading && contentTree.length === 0 ? (
                  <PanelPlaceholder icon="icon-[material-symbols--sync]" label="正在加载正文..." />
                ) : (
                  <>
                    {contentError ? (
                      <div className="mx-2 mb-2 flex items-start gap-2 rounded-md border border-border bg-editor-background px-3 py-2 text-xs text-accent-foreground">
                        <span className="icon-[material-symbols--warning] mt-0.5 shrink-0 text-sm" />
                        <span>{contentError}</span>
                      </div>
                    ) : null}
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
                      isBusy={contentBusy}
                      canCreate={!!activeTimelinePointId}
                    />
                  </>
                ),
            },
            {
              title: "辅助信息",
              actions: (
                <>
                  <button
                    type="button"
                    onClick={actions.handleAuxCreateSiblingDir}
                    disabled={auxBusy || !auxRootId || !activeTimelinePointId}
                    className="icon-[material-symbols--create-new-folder] text-base hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                    title="添加文件夹"
                  />
                  <button
                    type="button"
                    onClick={actions.handleAuxCreateSiblingFile}
                    disabled={auxBusy || !auxRootId || !activeTimelinePointId}
                    className="icon-[material-symbols--note-add] text-base hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                    title="添加文件"
                  />
                </>
              ),
              content:
                auxQuery.isLoading && auxTree.length === 0 ? (
                  <PanelPlaceholder
                    icon="icon-[material-symbols--sync]"
                    label="正在根据当前时间点加载辅助信息..."
                  />
                ) : (
                  <>
                    {auxError ? (
                      <div className="mx-2 mb-2 flex items-start gap-2 rounded-md border border-border bg-editor-background px-3 py-2 text-xs text-accent-foreground">
                        <span className="icon-[material-symbols--warning] mt-0.5 shrink-0 text-sm" />
                        <span>{auxError}</span>
                      </div>
                    ) : null}
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
                      isBusy={auxBusy}
                    />
                  </>
                ),
            },
            {
              title: "时间轴",
              actions: (
                <button
                  type="button"
                  onClick={actions.handleTimelineAdd}
                  disabled={timelineBusy || !activeTimelinePointId}
                  className="icon-[material-symbols--add] text-base hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                  title="添加时间点"
                />
              ),
              content:
                timelineQuery.isLoading && timelinePoints.length === 0 ? (
                  <PanelPlaceholder
                    icon="icon-[material-symbols--sync]"
                    label="正在加载时间轴..."
                  />
                ) : (
                  <>
                    {timelineError ? (
                      <div className="mx-2 mb-2 flex items-start gap-2 rounded-md border border-border bg-editor-background px-3 py-2 text-xs text-accent-foreground">
                        <span className="icon-[material-symbols--warning] mt-0.5 shrink-0 text-sm" />
                        <span>{timelineError}</span>
                      </div>
                    ) : null}
                    <TimelinePanel
                      points={timelinePoints}
                      activeId={activeTimelinePointId}
                      isBusy={timelineBusy}
                      onSelect={actions.handleTimelineSelect}
                      onReorder={actions.handleTimelineReorder}
                      onDelete={actions.handleTimelineDelete}
                      onRename={actions.handleTimelineRename}
                    />
                  </>
                ),
            },
          ]}
        />
      </div>

      <div className="flex flex-1 flex-col overflow-hidden">
        <EditorArea
          target={editorTarget}
          contentNode={activeContentNode}
          auxNode={activeAuxNode}
          body={editorBody}
          auxContent={editorContent}
          timelineLabel={activeTimelineLabel}
          contentSaveState={activeSaveState}
          auxSaveState={auxSaveState}
          onBodyChange={actions.handleBodyChange}
          onAuxContentChange={actions.handleAuxContentChange}
        />
      </div>
    </div>
  );
}

import { cn } from "@/shared/lib/cn";
import { FullPageMessage } from "@/shared/ui/FullPageMessage";

import { ProjectCommitDetailPanel } from "./ProjectCommitDetailPanel";
import { ProjectHistoryTimeline } from "./ProjectHistoryTimeline";
import { useProjectBranchAdminFeature } from "../features/useProjectBranchAdminFeature";
import { useProjectCommitFeature } from "../features/useProjectCommitFeature";
import { useForkBranchDialogControls } from "../features/useForkBranchFeature";
import {
  compactPrimaryButton,
  compactSecondaryButton,
  formatCommitId,
  InlineError,
  primaryButton,
  secondaryButton,
} from "../../shared/projectUi";
import { useProjectCommitDraft, useProjectHistorySelection } from "../state/projectWorkbenchStore";
import {
  useProjectWorkbenchNavigation,
  useProjectWorkbenchViewModel,
} from "../core/useProjectWorkbench";
import { useRevertContentChangeFeature } from "../features/useRevertContentChangeFeature";
import { WorkingTreeStatusPanel } from "./WorkingTreeStatusPanel";

export function ProjectBranchDetailPanel() {
  const model = useProjectWorkbenchViewModel();
  const forkBranchDialog = useForkBranchDialogControls();
  const { selection, setSelection } = useProjectHistorySelection();
  const project = model.project;
  const selectedBranch = model.selectedBranch;
  const selectedWorkspace = model.selectedWorkspace;

  if (!project) {
    return null;
  }

  if (!selectedBranch) {
    return (
      <FullPageMessage
        icon="icon-[material-symbols--account-tree]"
        title="还没有可查看的分支"
        description="从左侧创建一个 branch，或等待已有 branch 加载完成。"
        embedded
      />
    );
  }

  const workspaceMissing = selectedWorkspace == null;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <BranchHeader />
      {workspaceMissing ? (
        <div className="shrink-0 border-b border-border bg-editor-background px-4 py-2 text-xs text-accent-foreground">
          该分支当前没有对应 workspace，只支持只读查看历史，不能打开编辑器或直接提交。
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <section className="flex min-h-0 w-[24rem] shrink-0 flex-col overflow-hidden border-r border-border">
          <ProjectHistoryTimeline
            commitHistory={model.commitHistory}
            commitHistoryLoading={model.commitHistoryLoading}
            commitHistoryError={model.commitHistoryErrorMessage}
            selectedBranchHeadCommitId={model.selectedBranchHeadCommitId}
            workingTreeStatus={model.workingTreeStatus}
            workspaceMissing={workspaceMissing}
            selection={selection}
            onSelect={setSelection}
          />
        </section>

        <section className="min-h-0 flex-1 overflow-y-auto p-4">
          {selection.kind === "commit" ? (
            <ProjectCommitDetailPanel
              commitId={selection.commitId}
              selectedBranchHeadCommitId={model.selectedBranchHeadCommitId}
              onOpenFork={forkBranchDialog.openDialog}
            />
          ) : (
            <WorkingChangesDetail workspaceMissing={workspaceMissing} />
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * 分支头部：分支名 / 元信息 / 分支级操作（打开 workspace、设为默认、删除）。
 * 拆成独立组件以便主区聚焦于「时间线 + 详情」两栏布局。
 */
function BranchHeader() {
  const model = useProjectWorkbenchViewModel();
  const { navigate } = useProjectWorkbenchNavigation();
  const branchAdmin = useProjectBranchAdminFeature();
  const project = model.project;
  const selectedBranch = model.selectedBranch;
  const selectedWorkspace = model.selectedWorkspace;
  if (!project || !selectedBranch) {
    return null;
  }

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border bg-title-bar-background px-4 py-2">
      <span className="icon-[material-symbols--fork-right] shrink-0 text-lg text-accent-foreground" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-[14px] font-semibold text-foreground">
            {selectedBranch.name}
          </h2>
          {project.defaultBranchName === selectedBranch.name ? (
            <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-accent-foreground">
              默认分支
            </span>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] leading-none text-foreground-muted">
          <span>
            HEAD{" "}
            {model.selectedBranchHeadCommitId ? (
              <span className="font-mono">{formatCommitId(model.selectedBranchHeadCommitId)}</span>
            ) : (
              "—"
            )}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {selectedWorkspace ? (
          <button
            type="button"
            onClick={() => navigate(`/project/${project.id}/workspace/${selectedWorkspace.id}`)}
            className={compactPrimaryButton}
          >
            <span className="icon-[material-symbols--edit] text-sm" />
            打开 workspace
          </button>
        ) : (
          <button type="button" disabled className={compactPrimaryButton}>
            <span className="icon-[material-symbols--warning] text-sm" />无 workspace
          </button>
        )}
        <button
          type="button"
          onClick={() => void branchAdmin.handleSetDefaultBranch(selectedBranch)}
          disabled={
            project.defaultBranchName === selectedBranch.name || branchAdmin.isSettingDefault
          }
          className={compactSecondaryButton}
        >
          <span className="icon-[material-symbols--target] text-sm" />
          设为默认
        </button>
        <button
          type="button"
          onClick={() => void branchAdmin.handleDeleteBranch(selectedBranch)}
          disabled={
            project.defaultBranchName === selectedBranch.name || branchAdmin.isDeletingBranch
          }
          className={cn(
            compactSecondaryButton,
            "text-accent-foreground hover:bg-red-500/10 hover:text-red-200",
          )}
        >
          <span className="icon-[material-symbols--delete] text-sm" />
          删除分支
        </button>
      </div>
    </div>
  );
}

/** 选中「未提交的更改」伪节点时的详情：工作区变更概览 + 撤回 + 提交表单。 */
function WorkingChangesDetail({ workspaceMissing }: { workspaceMissing: boolean }) {
  const model = useProjectWorkbenchViewModel();
  const { commitMessage, commitError, discardError, setCommitMessage } = useProjectCommitDraft();
  const commitFeature = useProjectCommitFeature();
  const revertFeature = useRevertContentChangeFeature();
  const workingTreeStatus = model.workingTreeStatus;

  if (workspaceMissing) {
    return (
      <FullPageMessage
        icon="icon-[material-symbols--warning]"
        title="无可用 workspace"
        description="该分支没有对应 workspace，无法查看未提交变更或提交。"
        embedded
      />
    );
  }

  const commitDisabledByCleanTree =
    workingTreeStatus?.headCommitId != null && workingTreeStatus.hasChanges === false;
  const canDiscardChanges =
    workingTreeStatus?.headCommitId != null && workingTreeStatus.hasChanges === true;
  const commitDisabled =
    commitFeature.isCommitting || commitFeature.isDiscardingChanges || commitDisabledByCleanTree;

  return (
    <>
      <div className="flex items-center gap-1 text-[11px] font-semibold tracking-wider text-foreground-muted uppercase">
        <span className="icon-[material-symbols--upload] text-base text-accent-foreground" />
        <h3>Commit</h3>
      </div>

      <form
        className="mt-2 grid gap-2"
        onSubmit={(event) => void commitFeature.handleCommit(event)}
      >
        <textarea
          value={commitMessage}
          onChange={(event) => setCommitMessage(event.target.value)}
          rows={3}
          disabled={commitDisabled}
          placeholder="描述这次提交做了什么。"
          className="field-sizing-content w-full resize-none rounded-md border border-border bg-editor-background px-3 py-2 text-sm leading-relaxed text-foreground transition outline-none focus:border-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
        />
        {commitError || commitFeature.commitErrorMessage ? (
          <InlineError message={commitError ?? commitFeature.commitErrorMessage ?? ""} />
        ) : null}
        <div className="flex justify-end gap-2">
          {canDiscardChanges ? (
            <button
              type="button"
              onClick={() => void commitFeature.handleDiscardChanges()}
              disabled={commitFeature.isDiscardingChanges}
              className={cn(
                secondaryButton,
                "text-accent-foreground hover:bg-red-500/10 hover:text-red-200",
              )}
            >
              <span
                className={cn(
                  "text-base",
                  commitFeature.isDiscardingChanges
                    ? "icon-[material-symbols--sync] animate-spin"
                    : "icon-[material-symbols--undo]",
                )}
              />
              撤回全部修改
            </button>
          ) : null}
          <button type="submit" disabled={commitDisabled} className={primaryButton}>
            <span
              className={cn(
                "text-base",
                commitFeature.isCommitting
                  ? "icon-[material-symbols--sync] animate-spin"
                  : "icon-[material-symbols--check-circle]",
              )}
            />
            提交到当前分支
          </button>
        </div>
      </form>

      <WorkingTreeStatusPanel
        status={workingTreeStatus}
        loading={model.workingTreeStatusLoading}
        error={model.workingTreeStatusErrorMessage}
        discardError={discardError ?? commitFeature.discardErrorMessage}
        onRevertContentChange={revertFeature.handleRevertContentChange}
        onRevertTimelineChange={revertFeature.handleRevertTimelineChange}
        onRevertAuxChange={revertFeature.handleRevertAuxChange}
      />
    </>
  );
}

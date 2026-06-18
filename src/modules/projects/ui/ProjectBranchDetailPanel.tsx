import { type FormEvent } from "react";

import { cn } from "@/shared/lib/cn";
import { FullPageMessage } from "@/shared/ui/FullPageMessage";

import { CommitHistorySection } from "./CommitHistorySection";
import type {
  BranchRow,
  CommitHistory,
  CommitRow,
  ProjectRow,
  WorkingTreeStatus,
  WorkspaceRow,
} from "./projectTypes";
import {
  dateFormatter,
  formatCommitId,
  InlineError,
  primaryButton,
  secondaryButton,
} from "./projectUi";
import { useProjectWorkbenchState } from "./state/projectWorkbenchStore";
import { WorkingTreeStatusPanel } from "./WorkingTreeStatusPanel";

export function ProjectBranchDetailPanel({
  project,
  selectedBranch,
  selectedBranchHeadCommitId,
  selectedWorkspace,
  commitHistory,
  commitHistoryLoading,
  commitHistoryError,
  workingTreeStatus,
  workingTreeStatusLoading,
  workingTreeStatusError,
  discardErrorMessage,
  commitErrorMessage,
  isCommitting,
  isDiscardingChanges,
  isSettingDefault,
  isDeletingBranch,
  onOpenWorkspace,
  onSetDefaultBranch,
  onDeleteBranch,
  onOpenFork,
  onSubmitCommit,
  onDiscardChanges,
}: {
  project: ProjectRow;
  selectedBranch: BranchRow | null;
  selectedBranchHeadCommitId: string | null;
  selectedWorkspace: WorkspaceRow | null;
  commitHistory: CommitHistory;
  commitHistoryLoading: boolean;
  commitHistoryError: string | null;
  workingTreeStatus: WorkingTreeStatus | null;
  workingTreeStatusLoading: boolean;
  workingTreeStatusError: string | null;
  discardErrorMessage: string | null;
  commitErrorMessage: string | null;
  isCommitting: boolean;
  isDiscardingChanges: boolean;
  isSettingDefault: boolean;
  isDeletingBranch: boolean;
  onOpenWorkspace: (_workspaceId: string) => void;
  onSetDefaultBranch: (_branch: BranchRow) => void;
  onDeleteBranch: () => void;
  onOpenFork: (_commit: CommitRow) => void;
  onSubmitCommit: (_event: FormEvent<HTMLFormElement>) => void;
  onDiscardChanges: () => void;
}) {
  const commitMessage = useProjectWorkbenchState((state) => state.commitMessage);
  const commitError = useProjectWorkbenchState((state) => state.commitError);
  const discardError = useProjectWorkbenchState((state) => state.discardError);
  const setCommitMessage = useProjectWorkbenchState((state) => state.setCommitMessage);

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
  const commitDisabledByCleanTree =
    workingTreeStatus?.headCommitId != null && workingTreeStatus.hasChanges === false;
  const canDiscardChanges =
    !workspaceMissing &&
    workingTreeStatus?.headCommitId != null &&
    workingTreeStatus.hasChanges === true;
  const commitDisabled =
    workspaceMissing || isCommitting || isDiscardingChanges || commitDisabledByCleanTree;

  return (
    <div className="mx-auto grid min-h-full w-full max-w-6xl gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,28rem)]">
      <section className="overflow-hidden rounded-md border border-border bg-sidebar-background">
        <div className="p-3">
          <div className="flex flex-wrap items-start gap-2 border-b border-border pb-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-[14px] font-semibold text-foreground">
                  {selectedBranch.name}
                </h2>
                {project.defaultBranchId === selectedBranch.id ? (
                  <span className="rounded px-1.5 py-0.5 text-[10px] font-medium text-accent-foreground">
                    默认分支
                  </span>
                ) : null}
              </div>
              <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-foreground-muted">
                <span>更新时间 {dateFormatter.format(selectedBranch.updatedAt)}</span>
                <span>
                  HEAD{" "}
                  {selectedBranchHeadCommitId ? (
                    <span className="font-mono">{formatCommitId(selectedBranchHeadCommitId)}</span>
                  ) : (
                    "—"
                  )}
                </span>
                <span>
                  Fork 自{" "}
                  {selectedBranch.forkedFromCommitId ? (
                    <span className="font-mono">
                      {formatCommitId(selectedBranch.forkedFromCommitId)}
                    </span>
                  ) : (
                    "空分支"
                  )}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {selectedWorkspace ? (
                <button
                  type="button"
                  onClick={() => onOpenWorkspace(selectedWorkspace.id)}
                  className={primaryButton}
                >
                  <span className="icon-[material-symbols--edit] text-base" />
                  打开 workspace
                </button>
              ) : (
                <button type="button" disabled className={primaryButton}>
                  <span className="icon-[material-symbols--warning] text-base" />无 workspace
                </button>
              )}
              <button
                type="button"
                onClick={() => onSetDefaultBranch(selectedBranch)}
                disabled={project.defaultBranchId === selectedBranch.id || isSettingDefault}
                className={secondaryButton}
              >
                <span className="icon-[material-symbols--target] text-base" />
                设为默认
              </button>
              <button
                type="button"
                onClick={onDeleteBranch}
                disabled={project.defaultBranchId === selectedBranch.id || isDeletingBranch}
                className={cn(
                  secondaryButton,
                  "text-accent-foreground hover:bg-red-500/10 hover:text-red-200",
                )}
              >
                <span className="icon-[material-symbols--delete] text-base" />
                删除分支
              </button>
            </div>
          </div>

          {workspaceMissing ? (
            <div className="mt-2 rounded-md border border-border bg-editor-background px-3 py-2 text-xs text-accent-foreground">
              该分支当前没有对应 workspace，只支持只读查看历史，不能打开编辑器或直接提交。
            </div>
          ) : null}
        </div>

        <CommitHistorySection
          commitHistory={commitHistory}
          commitHistoryLoading={commitHistoryLoading}
          commitHistoryError={commitHistoryError}
          selectedBranchHeadCommitId={selectedBranchHeadCommitId}
          onOpenFork={onOpenFork}
        />
      </section>

      <section className="rounded-md border border-border bg-sidebar-background p-3">
        <div className="flex h-7 items-center gap-1 text-[11px] font-semibold tracking-wider text-foreground-muted uppercase">
          <span className="icon-[material-symbols--upload] text-base text-accent-foreground" />
          <h3>Commit</h3>
        </div>

        {!workspaceMissing ? (
          <WorkingTreeStatusPanel
            status={workingTreeStatus}
            loading={workingTreeStatusLoading}
            error={workingTreeStatusError}
            discardError={discardError ?? discardErrorMessage}
            canDiscardChanges={canDiscardChanges}
            isDiscardingChanges={isDiscardingChanges}
            onDiscardChanges={onDiscardChanges}
          />
        ) : null}

        <form className="mt-2 grid gap-2" onSubmit={onSubmitCommit}>
          <textarea
            value={commitMessage}
            onChange={(event) => setCommitMessage(event.target.value)}
            rows={4}
            disabled={commitDisabled}
            placeholder="描述这次提交做了什么。"
            className="field-sizing-content w-full resize-none rounded-md border border-border bg-editor-background px-3 py-2 text-sm leading-relaxed text-foreground transition outline-none focus:border-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
          />
          {commitError || commitErrorMessage ? (
            <InlineError message={commitError ?? commitErrorMessage ?? ""} />
          ) : null}
          <div className="flex justify-end">
            <button type="submit" disabled={commitDisabled} className={primaryButton}>
              <span
                className={cn(
                  "text-base",
                  isCommitting
                    ? "icon-[material-symbols--sync] animate-spin"
                    : "icon-[material-symbols--check-circle]",
                )}
              />
              提交到当前分支
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

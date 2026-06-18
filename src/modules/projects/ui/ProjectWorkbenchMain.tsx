import { type FormEvent } from "react";

import type {
  BranchRow,
  CommitHistory,
  CommitRow,
  ProjectRow,
  WorkingTreeStatus,
  WorkspaceRow,
} from "./projectTypes";
import { PageHeader, secondaryButton } from "./projectUi";
import { ProjectBranchDetailPanel } from "./ProjectBranchDetailPanel";

export function ProjectWorkbenchMain({
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
  onClose,
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
  onClose: () => void;
  onOpenWorkspace: (_workspaceId: string) => void;
  onSetDefaultBranch: (_branch: BranchRow) => void;
  onDeleteBranch: () => void;
  onOpenFork: (_commit: CommitRow) => void;
  onSubmitCommit: (_event: FormEvent<HTMLFormElement>) => void;
  onDiscardChanges: () => void;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        icon="icon-[material-symbols--folder-open]"
        title={project.name}
        subtitle={selectedBranch ? `Branch · ${selectedBranch.name}` : "Branch Workspace"}
        trailing={
          <button type="button" onClick={onClose} className={secondaryButton}>
            <span className="icon-[material-symbols--close] text-sm" />
            关闭项目
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto p-3">
        <ProjectBranchDetailPanel
          project={project}
          selectedBranch={selectedBranch}
          selectedBranchHeadCommitId={selectedBranchHeadCommitId}
          selectedWorkspace={selectedWorkspace}
          commitHistory={commitHistory}
          commitHistoryLoading={commitHistoryLoading}
          commitHistoryError={commitHistoryError}
          workingTreeStatus={workingTreeStatus}
          workingTreeStatusLoading={workingTreeStatusLoading}
          workingTreeStatusError={workingTreeStatusError}
          discardErrorMessage={discardErrorMessage}
          commitErrorMessage={commitErrorMessage}
          isCommitting={isCommitting}
          isDiscardingChanges={isDiscardingChanges}
          isSettingDefault={isSettingDefault}
          isDeletingBranch={isDeletingBranch}
          onOpenWorkspace={onOpenWorkspace}
          onSetDefaultBranch={onSetDefaultBranch}
          onDeleteBranch={onDeleteBranch}
          onOpenFork={onOpenFork}
          onSubmitCommit={onSubmitCommit}
          onDiscardChanges={onDiscardChanges}
        />
      </div>
    </div>
  );
}

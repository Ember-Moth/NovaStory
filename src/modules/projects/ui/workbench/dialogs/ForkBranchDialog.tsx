import { useEffect, useRef } from "react";

import { ProjectDialog } from "../../shared/ProjectDialog";
import { formatCommitId } from "../../shared/projectUi";
import { useForkBranchFeature } from "../features/useForkBranchFeature";
import { useProjectForkBranchDraft } from "../state/projectWorkbenchStore";

export function ForkBranchDialog() {
  const forkBranch = useForkBranchFeature();
  const { forkBranchError, forkBranchName, forkCommit, setForkBranchName } =
    useProjectForkBranchDraft();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    if (forkBranch.isOpen) {
      if (!dialog.open) {
        dialog.showModal();
      }
      return;
    }

    if (dialog.open) {
      dialog.close();
    }
  }, [forkBranch.isOpen]);

  return (
    <ProjectDialog
      dialogRef={dialogRef}
      title="Fork 分支"
      icon="icon-[material-symbols--fork-right]"
      onClose={forkBranch.closeDialog}
      onSubmit={(event) => void forkBranch.submit(event)}
      error={forkBranchError ?? forkBranch.errorMessage}
      isPending={forkBranch.isPending}
      pendingLabel="Fork 中"
      submitLabel="创建 Fork"
      widthClassName="w-[min(42rem,calc(100vw-2rem))]"
    >
      <div className="wrap-break-word min-w-0 rounded-md border border-border bg-editor-background px-3 py-2 text-foreground-muted text-xs leading-relaxed">
        来源提交：{forkCommit ? `${forkCommit.message} · ${formatCommitId(forkCommit.id)}` : "—"}
      </div>
      <label className="block space-y-1.5">
        <span className="font-medium text-foreground-muted text-xs">分支名</span>
        <input
          value={forkBranchName}
          onChange={(event) => setForkBranchName(event.target.value)}
          placeholder="例如：fork-alt-ending"
          className="w-full rounded-md border border-border bg-editor-background px-3 py-1.5 text-foreground text-sm outline-none transition placeholder:text-foreground-muted/50 focus:border-accent-foreground"
        />
      </label>
    </ProjectDialog>
  );
}

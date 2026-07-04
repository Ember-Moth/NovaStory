import { useEffect, useRef } from "react";

import { ProjectDialog } from "../../shared/ProjectDialog";
import { useCreateBranchFeature } from "../features/useCreateBranchFeature";
import { useProjectCreateBranchDraft } from "../state/projectWorkbenchStore";

export function CreateBranchDialog() {
  const createBranch = useCreateBranchFeature();
  const { newBranchError, newBranchName, setNewBranchName } = useProjectCreateBranchDraft();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    if (createBranch.isOpen) {
      if (!dialog.open) {
        dialog.showModal();
      }
      return;
    }

    if (dialog.open) {
      dialog.close();
    }
  }, [createBranch.isOpen]);

  return (
    <ProjectDialog
      dialogRef={dialogRef}
      title="新建分支"
      icon="icon-[material-symbols--account-tree]"
      onClose={createBranch.closeDialog}
      onSubmit={(event) => void createBranch.submit(event)}
      error={newBranchError ?? createBranch.errorMessage}
      isPending={createBranch.isPending}
      pendingLabel="创建中"
      submitLabel="创建分支"
    >
      <label className="block space-y-1.5">
        <span className="font-medium text-foreground-muted text-xs">分支名</span>
        <input
          value={newBranchName}
          onChange={(event) => setNewBranchName(event.target.value)}
          placeholder="例如：feature-outline"
          className="w-full rounded-md border border-border bg-editor-background px-3 py-1.5 text-foreground text-sm outline-none transition placeholder:text-foreground-muted/50 focus:border-accent-foreground"
        />
      </label>
    </ProjectDialog>
  );
}

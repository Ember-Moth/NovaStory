import { type FormEvent } from "react";

import { ProjectDialog } from "./ProjectDialog";
import { formatCommitId } from "./projectUi";
import { useProjectListState } from "./state/projectListStore";
import { useProjectWorkbenchState } from "./state/projectWorkbenchStore";

export function CreateProjectDialog({
  dialogRef,
  mutationError,
  isPending,
  onClose,
  onSubmit,
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  mutationError: string | null;
  isPending: boolean;
  onClose: () => void;
  onSubmit: (_event: FormEvent<HTMLFormElement>) => void;
}) {
  const formError = useProjectListState((state) => state.createProjectError);

  return (
    <ProjectDialog
      dialogRef={dialogRef}
      title="新建项目"
      icon="icon-[material-symbols--add-circle-outline]"
      onClose={onClose}
      onSubmit={onSubmit}
      error={formError ?? mutationError}
      isPending={isPending}
      pendingLabel="创建中"
      submitLabel="创建"
    >
      <CreateProjectDialogFields />
    </ProjectDialog>
  );
}

export function CreateBranchDialog({
  dialogRef,
  mutationError,
  isPending,
  onClose,
  onSubmit,
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  mutationError: string | null;
  isPending: boolean;
  onClose: () => void;
  onSubmit: (_event: FormEvent<HTMLFormElement>) => void;
}) {
  const newBranchError = useProjectWorkbenchState((state) => state.newBranchError);

  return (
    <ProjectDialog
      dialogRef={dialogRef}
      title="新建分支"
      icon="icon-[material-symbols--account-tree]"
      onClose={onClose}
      onSubmit={onSubmit}
      error={newBranchError ?? mutationError}
      isPending={isPending}
      pendingLabel="创建中"
      submitLabel="创建分支"
    >
      <CreateBranchDialogFields />
    </ProjectDialog>
  );
}

export function ForkBranchDialog({
  dialogRef,
  mutationError,
  isPending,
  onClose,
  onSubmit,
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  mutationError: string | null;
  isPending: boolean;
  onClose: () => void;
  onSubmit: (_event: FormEvent<HTMLFormElement>) => void;
}) {
  const forkBranchError = useProjectWorkbenchState((state) => state.forkBranchError);

  return (
    <ProjectDialog
      dialogRef={dialogRef}
      title="Fork 分支"
      icon="icon-[material-symbols--fork-right]"
      onClose={onClose}
      onSubmit={onSubmit}
      error={forkBranchError ?? mutationError}
      isPending={isPending}
      pendingLabel="Fork 中"
      submitLabel="创建 Fork"
      widthClassName="w-[min(42rem,calc(100vw-2rem))]"
    >
      <ForkBranchDialogFields />
    </ProjectDialog>
  );
}

function CreateProjectDialogFields() {
  const name = useProjectListState((state) => state.createProjectName);
  const description = useProjectListState((state) => state.createProjectDescription);
  const setName = useProjectListState((state) => state.setCreateProjectName);
  const setDescription = useProjectListState((state) => state.setCreateProjectDescription);

  return (
    <>
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-foreground-muted">项目名</span>
        <input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="例如：雾港编年史"
          className="w-full rounded-md border border-border bg-editor-background px-3 py-1.5 text-sm text-foreground transition outline-none placeholder:text-foreground-muted/50 focus:border-accent-foreground"
        />
      </label>

      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-foreground-muted">描述</span>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={3}
          placeholder="可选"
          className="w-full resize-none rounded-md border border-border bg-editor-background px-3 py-1.5 text-sm leading-relaxed text-foreground transition outline-none placeholder:text-foreground-muted/50 focus:border-accent-foreground"
        />
      </label>
    </>
  );
}

function CreateBranchDialogFields() {
  const newBranchName = useProjectWorkbenchState((state) => state.newBranchName);
  const setNewBranchName = useProjectWorkbenchState((state) => state.setNewBranchName);

  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-foreground-muted">分支名</span>
      <input
        autoFocus
        value={newBranchName}
        onChange={(event) => setNewBranchName(event.target.value)}
        placeholder="例如：feature-outline"
        className="w-full rounded-md border border-border bg-editor-background px-3 py-1.5 text-sm text-foreground transition outline-none placeholder:text-foreground-muted/50 focus:border-accent-foreground"
      />
    </label>
  );
}

function ForkBranchDialogFields() {
  const forkBranchName = useProjectWorkbenchState((state) => state.forkBranchName);
  const forkCommit = useProjectWorkbenchState((state) => state.forkCommit);
  const setForkBranchName = useProjectWorkbenchState((state) => state.setForkBranchName);

  return (
    <>
      <div className="min-w-0 rounded-md border border-border bg-editor-background px-3 py-2 text-xs leading-relaxed wrap-break-word text-foreground-muted">
        来源提交：{forkCommit ? `${forkCommit.message} · ${formatCommitId(forkCommit.id)}` : "—"}
      </div>
      <label className="block space-y-1.5">
        <span className="text-xs font-medium text-foreground-muted">分支名</span>
        <input
          autoFocus
          value={forkBranchName}
          onChange={(event) => setForkBranchName(event.target.value)}
          placeholder="例如：fork-alt-ending"
          className="w-full rounded-md border border-border bg-editor-background px-3 py-1.5 text-sm text-foreground transition outline-none placeholder:text-foreground-muted/50 focus:border-accent-foreground"
        />
      </label>
    </>
  );
}

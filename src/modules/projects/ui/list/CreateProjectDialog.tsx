import type { FormEvent } from "react";

import { ProjectDialog } from "../shared/ProjectDialog";
import { useProjectListState } from "./state/projectListStore";

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

function CreateProjectDialogFields() {
  const name = useProjectListState((state) => state.createProjectName);
  const description = useProjectListState((state) => state.createProjectDescription);
  const setName = useProjectListState((state) => state.setCreateProjectName);
  const setDescription = useProjectListState((state) => state.setCreateProjectDescription);

  return (
    <>
      <label className="block space-y-1.5">
        <span className="font-medium text-foreground-muted text-xs">项目名</span>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="例如：雾港编年史"
          className="w-full rounded-md border border-border bg-editor-background px-3 py-1.5 text-foreground text-sm outline-none transition placeholder:text-foreground-muted/50 focus:border-accent-foreground"
        />
      </label>

      <label className="block space-y-1.5">
        <span className="font-medium text-foreground-muted text-xs">描述</span>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={3}
          placeholder="可选"
          className="w-full resize-none rounded-md border border-border bg-editor-background px-3 py-1.5 text-foreground text-sm leading-relaxed outline-none transition placeholder:text-foreground-muted/50 focus:border-accent-foreground"
        />
      </label>
    </>
  );
}

import { type FormEvent, useRef, useState } from "react";
import { useLocation } from "wouter";

import { rpc } from "@/api/client";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function HomePage() {
  const [, navigate] = useLocation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data: projects, error, isLoading } = rpc.useQuery("projects.list");
  const createProject = rpc.useMutation("projects.create");
  const deleteProject = rpc.useMutation("projects.delete");

  const projectList = [...(projects ?? [])].sort((a, b) => b.updatedAt - a.updatedAt);

  const openCreateDialog = () => {
    setFormError(null);
    if (!dialogRef.current?.open) {
      dialogRef.current?.showModal();
    }
  };

  const closeCreateDialog = () => {
    dialogRef.current?.close();
    setName("");
    setDescription("");
    setFormError(null);
  };

  const handleCreateProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedDescription = description.trim();

    if (!trimmedName) {
      setFormError("项目名不能为空。");
      return;
    }

    try {
      const id = crypto.randomUUID();
      await createProject.mutate({
        id,
        name: trimmedName,
        description: trimmedDescription || null,
      });
      closeCreateDialog();
      navigate(`/project/${id}`);
    } catch (mutationError) {
      setFormError(
        mutationError instanceof Error ? mutationError.message : "创建项目失败，请稍后重试。",
      );
    }
  };

  const handleDeleteProject = async (id: string, projectName: string) => {
    if (!confirm(`确认删除项目“${projectName}”吗？`)) {
      return;
    }

    try {
      setDeletingId(id);
      await deleteProject.mutate({ id });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <main className="min-h-dvh select-none bg-editor-background text-foreground">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8">
        {/* Header */}
        <section className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="icon-[material-symbols--description] text-2xl text-foreground-muted" />
            <div>
              <h1 className="text-lg font-semibold tracking-tight">项目</h1>
              <p className="mt-0.5 text-xs text-foreground-muted">{projectList.length} 个项目</p>
            </div>
          </div>
          <button
            type="button"
            onClick={openCreateDialog}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-sidebar-background px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-list-hover-background"
          >
            <span className="icon-[material-symbols--add] text-base" />
            新建
          </button>
        </section>

        {/* Error banner */}
        {error ? (
          <div className="flex items-center gap-2 rounded-md border border-border bg-sidebar-background px-3 py-2 text-sm text-accent-foreground">
            <span className="icon-[material-symbols--info] text-base shrink-0" />
            {error.message}
          </div>
        ) : null}

        {/* Loading state */}
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 rounded-md border border-dashed border-border px-4 py-10 text-sm text-foreground-muted">
            <span className="icon-[material-symbols--sync] text-base animate-spin" />
            加载中...
          </div>
        ) : null}

        {/* Empty state */}
        {!isLoading && projectList.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border px-4 py-12 text-sm text-foreground-muted">
            <span className="icon-[material-symbols--edit-note] text-3xl" />
            <span>还没有项目，点击「新建」创建一个。</span>
          </div>
        ) : null}

        {/* Project list */}
        {!isLoading ? (
          <div className="flex flex-col">
            {projectList.map((project) => (
              <div
                key={project.id}
                className="group flex items-start gap-2 rounded-md px-3 py-2 transition hover:bg-list-hover-background"
              >
                <button
                  type="button"
                  onClick={() => navigate(`/project/${project.id}`)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span className="icon-[material-symbols--folder] mt-0.5 shrink-0 text-lg text-icon-folder" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {project.name}
                      </span>
                      <span className="shrink-0 text-[11px] text-foreground-muted">
                        {dateFormatter.format(project.updatedAt)}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-foreground-muted">
                      {project.description?.trim() || "暂无描述"}
                    </p>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteProject(project.id, project.name)}
                  disabled={deleteProject.isPending && deletingId === project.id}
                  className="shrink-0 rounded p-1 text-foreground-muted opacity-0 transition hover:bg-button-hover-background hover:text-foreground group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
                  title="删除项目"
                >
                  <span className="icon-[material-symbols--delete] text-base leading-none" />
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* New project dialog */}
      <dialog
        ref={dialogRef}
        className="w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-border bg-sidebar-background p-0 text-foreground shadow-lg backdrop:bg-black/50"
      >
        <form onSubmit={handleCreateProject}>
          {/* Dialog title bar */}
          <div className="flex items-center gap-2 border-b border-border px-4 py-2">
            <span className="icon-[material-symbols--add-circle-outline] text-base text-accent-foreground" />
            <span className="text-sm font-medium">新建项目</span>
            <button
              type="button"
              onClick={closeCreateDialog}
              className="ml-auto rounded p-0.5 text-foreground-muted transition hover:bg-button-hover-background hover:text-foreground"
            >
              <span className="icon-[material-symbols--close] text-base leading-none" />
            </button>
          </div>

          <div className="space-y-4 p-4">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-foreground-muted">项目名</span>
              <input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：雾港编年史"
                className="w-full rounded-md border border-border bg-editor-background px-3 py-1.5 text-sm text-foreground outline-none transition placeholder:text-foreground-muted/50 focus:border-accent-foreground"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-foreground-muted">描述</span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                placeholder="可选"
                className="w-full resize-none rounded-md border border-border bg-editor-background px-3 py-1.5 text-sm text-foreground leading-relaxed outline-none transition placeholder:text-foreground-muted/50 focus:border-accent-foreground"
              />
            </label>

            {formError || createProject.error ? (
              <div className="flex items-center gap-2 rounded-md border border-border bg-editor-background px-3 py-2 text-sm text-accent-foreground">
                <span className="icon-[material-symbols--warning] text-base shrink-0" />
                {formError ?? createProject.error?.message}
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
            <button
              type="button"
              onClick={closeCreateDialog}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-list-hover-background"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={createProject.isPending}
              className="rounded-md bg-accent-foreground px-3 py-1.5 text-sm font-medium text-foreground transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {createProject.isPending ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="icon-[material-symbols--sync] text-base animate-spin" />
                  创建中
                </span>
              ) : (
                "创建"
              )}
            </button>
          </div>
        </form>
      </dialog>
    </main>
  );
}

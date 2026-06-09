import { useAtomValue, useSetAtom } from "jotai";
import { type FormEvent, useRef, useState } from "react";
import { useLocation } from "wouter";

import { AppShell } from "@/client/components/AppShell";
import { lastProjectIdAtom } from "@/client/state/lastProject";
import { rpc } from "@/server/rpc/client";
import { LoadingBlock } from "@/shared/components/Loading";

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function HomePage() {
  const [, navigate] = useLocation();
  const lastProjectId = useAtomValue(lastProjectIdAtom);
  const setLastProjectId = useSetAtom(lastProjectIdAtom);
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
      setLastProjectId((current) => (current === id ? null : current));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <AppShell active="home">
      <div className="flex h-full flex-col overflow-hidden">
        <div className="border-border bg-title-bar-background flex shrink-0 items-center gap-3 border-b px-4 py-2">
          <span className="icon-[material-symbols--folder] text-icon-folder text-xl" />
          <div className="min-w-0">
            <h1 className="text-foreground text-[14px] font-semibold">项目</h1>
            <p className="text-foreground-muted text-[11px]">{projectList.length} 个项目</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {error ? (
            <div className="border-border bg-sidebar-background text-accent-foreground mb-4 flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
              <span className="icon-[material-symbols--info] shrink-0 text-base" />
              {error.message}
            </div>
          ) : null}

          {isLoading ? (
            <LoadingBlock />
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
              <button
                type="button"
                onClick={openCreateDialog}
                className="group border-border bg-sidebar-background text-foreground-muted hover:border-accent-foreground hover:bg-list-hover-background hover:text-foreground flex min-h-36 flex-col items-center justify-center gap-2 rounded-md border border-dashed p-4 transition"
              >
                <span className="icon-[material-symbols--add-circle-outline] text-accent-foreground text-3xl transition group-hover:scale-105" />
                <span className="text-sm font-medium">新建项目</span>
              </button>

              {projectList.map((project) => {
                const isLastOpened = project.id === lastProjectId;

                return (
                  <div
                    key={project.id}
                    className={`group relative flex min-h-36 flex-col rounded-md border p-4 transition ${
                      isLastOpened
                        ? "border-accent-foreground/40 bg-list-active-background"
                        : "border-border bg-sidebar-background hover:bg-list-hover-background"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => navigate(`/project/${project.id}`)}
                      className="flex min-h-0 flex-1 flex-col items-start gap-2 text-left"
                    >
                      <div className="flex w-full items-center gap-2">
                        <span className="icon-[material-symbols--folder] text-icon-folder text-2xl" />
                        {isLastOpened ? (
                          <span className="text-accent-foreground rounded px-1.5 py-0.5 text-[10px] font-medium">
                            上次打开
                          </span>
                        ) : null}
                      </div>
                      <span className="text-foreground line-clamp-2 text-sm font-medium">
                        {project.name}
                      </span>
                      <p className="text-foreground-muted line-clamp-2 flex-1 text-xs leading-relaxed">
                        {project.description?.trim() || "暂无描述"}
                      </p>
                      <span className="text-foreground-muted text-[11px]">
                        {dateFormatter.format(project.updatedAt)}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteProject(project.id, project.name)}
                      disabled={deleteProject.isPending && deletingId === project.id}
                      className="text-foreground-muted hover:bg-button-hover-background hover:text-foreground absolute top-2 right-2 rounded p-1 opacity-0 transition group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
                      title="删除项目"
                    >
                      <span className="icon-[material-symbols--delete] text-base leading-none" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <dialog
        ref={dialogRef}
        className="border-border bg-sidebar-background text-foreground w-[min(28rem,calc(100vw-2rem))] rounded-lg border p-0 shadow-lg backdrop:bg-black/50"
      >
        <form onSubmit={handleCreateProject}>
          <div className="border-border flex items-center gap-2 border-b px-4 py-2">
            <span className="icon-[material-symbols--add-circle-outline] text-accent-foreground text-base" />
            <span className="text-sm font-medium">新建项目</span>
            <button
              type="button"
              onClick={closeCreateDialog}
              className="text-foreground-muted hover:bg-button-hover-background hover:text-foreground ml-auto rounded p-0.5 transition"
            >
              <span className="icon-[material-symbols--close] text-base leading-none" />
            </button>
          </div>

          <div className="space-y-4 p-4">
            <label className="block space-y-1.5">
              <span className="text-foreground-muted text-xs font-medium">项目名</span>
              <input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：雾港编年史"
                className="border-border bg-editor-background text-foreground placeholder:text-foreground-muted/50 focus:border-accent-foreground w-full rounded-md border px-3 py-1.5 text-sm transition outline-none"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-foreground-muted text-xs font-medium">描述</span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                placeholder="可选"
                className="border-border bg-editor-background text-foreground placeholder:text-foreground-muted/50 focus:border-accent-foreground w-full resize-none rounded-md border px-3 py-1.5 text-sm leading-relaxed transition outline-none"
              />
            </label>

            {formError || createProject.error ? (
              <div className="border-border bg-editor-background text-accent-foreground flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <span className="icon-[material-symbols--warning] shrink-0 text-base" />
                {formError ?? createProject.error?.message}
              </div>
            ) : null}
          </div>

          <div className="border-border flex items-center justify-end gap-2 border-t px-4 py-3">
            <button
              type="button"
              onClick={closeCreateDialog}
              className="border-border text-foreground hover:bg-list-hover-background rounded-md border px-3 py-1.5 text-sm font-medium transition"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={createProject.isPending}
              className="bg-accent-background text-foreground rounded-md px-3 py-1.5 text-sm font-medium transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {createProject.isPending ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="icon-[material-symbols--sync] animate-spin text-base" />
                  创建中
                </span>
              ) : (
                "创建"
              )}
            </button>
          </div>
        </form>
      </dialog>
    </AppShell>
  );
}

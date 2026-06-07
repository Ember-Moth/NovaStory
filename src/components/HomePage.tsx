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
    <main className="min-h-screen bg-stone-50 px-6 py-10 text-stone-950">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
        <section className="flex flex-col gap-4 rounded-[2rem] border border-stone-200 bg-white px-6 py-7 shadow-[0_24px_80px_-48px_rgba(28,25,23,0.45)] sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-[0.28em] text-stone-500">
              Novel Evolver
            </p>
            <div className="space-y-1">
              <h1 className="text-3xl font-semibold tracking-tight text-stone-900">项目管理</h1>
              <p className="max-w-2xl text-sm leading-6 text-stone-600">
                保持首页足够轻，只处理项目的查看、新建与删除。
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={openCreateDialog}
            className="inline-flex items-center justify-center rounded-full bg-stone-900 px-4 py-2 text-sm font-medium text-stone-50 transition hover:bg-stone-700"
          >
            新建项目
          </button>
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium uppercase tracking-[0.24em] text-stone-500">
              项目列表
            </h2>
            <span className="text-sm text-stone-500">{projectList.length} 个项目</span>
          </div>

          {error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error.message}
            </div>
          ) : null}

          {isLoading ? (
            <div className="rounded-[1.5rem] border border-dashed border-stone-300 bg-white px-6 py-12 text-center text-sm text-stone-500">
              正在加载项目列表...
            </div>
          ) : null}

          {!isLoading && projectList.length === 0 ? (
            <div className="rounded-[1.5rem] border border-dashed border-stone-300 bg-white px-6 py-12 text-center">
              <p className="text-base font-medium text-stone-800">还没有项目</p>
              <p className="mt-2 text-sm text-stone-500">
                从一个新项目开始，把世界观和章节慢慢长出来。
              </p>
            </div>
          ) : null}

          {!isLoading ? (
            <div className="grid gap-3">
              {projectList.map((project) => (
                <div
                  key={project.id}
                  className="group flex items-start gap-3 rounded-[1.5rem] border border-stone-200 bg-white p-3 shadow-[0_18px_50px_-44px_rgba(28,25,23,0.45)] transition hover:border-stone-300 hover:shadow-[0_24px_70px_-42px_rgba(28,25,23,0.5)]"
                >
                  <button
                    type="button"
                    onClick={() => navigate(`/project/${project.id}`)}
                    className="flex-1 rounded-[1rem] px-3 py-3 text-left transition group-hover:bg-stone-50"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-base font-medium text-stone-900">{project.name}</h3>
                      <span className="text-xs text-stone-400">
                        {dateFormatter.format(project.updatedAt)}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm leading-6 text-stone-600">
                      {project.description?.trim() || "暂无描述"}
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteProject(project.id, project.name)}
                    disabled={deleteProject.isPending && deletingId === project.id}
                    className="rounded-full border border-stone-200 px-3 py-2 text-sm text-stone-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {deleteProject.isPending && deletingId === project.id ? "删除中" : "删除"}
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      </div>

      <dialog
        ref={dialogRef}
        className="w-[min(32rem,calc(100vw-2rem))] rounded-[1.75rem] border border-stone-200 bg-white p-0 text-stone-950 shadow-2xl backdrop:bg-stone-900/20"
      >
        <form onSubmit={handleCreateProject} className="space-y-6 p-6">
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-[0.24em] text-stone-500">
              新建项目
            </p>
            <h2 className="text-2xl font-semibold tracking-tight text-stone-900">
              创建一个新的故事容器
            </h2>
            <p className="text-sm leading-6 text-stone-600">先给项目一个名字，描述可以后面再补。</p>
          </div>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-stone-700">项目名</span>
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：雾港编年史"
              className="w-full rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-900 outline-none transition focus:border-stone-400 focus:bg-white"
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm font-medium text-stone-700">描述</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
              placeholder="一句话写下这个项目的方向。"
              className="w-full resize-none rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm leading-6 text-stone-900 outline-none transition focus:border-stone-400 focus:bg-white"
            />
          </label>

          {formError || createProject.error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {formError ?? createProject.error?.message}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={closeCreateDialog}
              className="rounded-full border border-stone-200 px-4 py-2 text-sm font-medium text-stone-600 transition hover:border-stone-300 hover:bg-stone-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={createProject.isPending}
              className="rounded-full bg-stone-900 px-4 py-2 text-sm font-medium text-stone-50 transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {createProject.isPending ? "创建中" : "创建并进入"}
            </button>
          </div>
        </form>
      </dialog>
    </main>
  );
}

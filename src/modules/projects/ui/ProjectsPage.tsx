import { skipToken } from "@codehz/rpc/react";
import { useAtomValue, useSetAtom } from "jotai";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";

import { AppShell } from "@/app/shell/AppShell";
import { lastProjectIdAtom, lastWorkspaceRouteAtom } from "@/app/state/lastProject";
import { rpc } from "@/rpc/client";
import { FullPageMessage } from "@/shared/ui/FullPageMessage";
import { LoadingBlock } from "@/shared/ui/Loading";

import {
  insertProjectOptimistically,
  removeProjectOptimistically,
  updateProjectOptimistically,
} from "./projectCache";

type ProjectList = NonNullable<ReturnType<typeof rpc.useQuery<"projects.list">>["data"]>;
type ProjectRow = ProjectList[number];
type WorkspaceList = NonNullable<ReturnType<typeof rpc.useQuery<"workspaces.list">>["data"]>;
type ProjectMutationContext = {
  previousProjects?: ProjectList;
};

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function ProjectsPage({ projectId = null }: { projectId?: string | null }) {
  const [, navigate] = useLocation();
  const lastProjectId = useAtomValue(lastProjectIdAtom);
  const lastWorkspaceRoute = useAtomValue(lastWorkspaceRouteAtom);
  const setLastProjectId = useSetAtom(lastProjectIdAtom);
  const setLastWorkspaceRoute = useSetAtom(lastWorkspaceRouteAtom);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [detailName, setDetailName] = useState("");
  const [detailDescription, setDetailDescription] = useState("");
  const [detailError, setDetailError] = useState<string | null>(null);

  const {
    data: projects,
    error,
    isInitialLoading,
  } = rpc.useQuery("projects.list", undefined, {
    refetchOnWindowFocus: true,
  });
  const workspacesQuery = rpc.useQuery("workspaces.list", projectId ? { projectId } : skipToken, {
    refetchOnWindowFocus: true,
  });
  const createProject = rpc.useMutation<"projects.create", ProjectMutationContext>(
    "projects.create",
    {
      onMutate: (input) => {
        const previousProjects = rpc.getQueryData("projects.list", undefined);
        if (previousProjects) {
          const timestamp = Date.now();
          rpc.setQueryData(
            "projects.list",
            undefined,
            insertProjectOptimistically(previousProjects, {
              id: input.id,
              name: input.name,
              description: input.description ?? null,
              createdAt: timestamp,
              updatedAt: timestamp,
            }),
          );
        }
        return { previousProjects };
      },
      onError: (_, __, context) => {
        if (context?.previousProjects) {
          rpc.setQueryData("projects.list", undefined, context.previousProjects);
        }
      },
    },
  );
  const updateProject = rpc.useMutation<"projects.update", ProjectMutationContext>(
    "projects.update",
    {
      onMutate: (input) => {
        const previousProjects = rpc.getQueryData("projects.list", undefined);
        if (previousProjects) {
          rpc.setQueryData(
            "projects.list",
            undefined,
            updateProjectOptimistically(previousProjects, {
              id: input.id,
              name: input.name,
              description: input.description ?? null,
            }),
          );
        }
        return { previousProjects };
      },
      onError: (_, __, context) => {
        if (context?.previousProjects) {
          rpc.setQueryData("projects.list", undefined, context.previousProjects);
        }
      },
    },
  );
  const deleteProject = rpc.useMutation<"projects.delete", ProjectMutationContext>(
    "projects.delete",
    {
      onMutate: (input) => {
        const previousProjects = rpc.getQueryData("projects.list", undefined);
        if (previousProjects) {
          rpc.setQueryData(
            "projects.list",
            undefined,
            removeProjectOptimistically(previousProjects, input.id),
          );
        }
        return { previousProjects };
      },
      onError: (_, __, context) => {
        if (context?.previousProjects) {
          rpc.setQueryData("projects.list", undefined, context.previousProjects);
        }
      },
    },
  );

  const projectList = [...(projects ?? [])].sort((a, b) => b.updatedAt - a.updatedAt);
  const project = projectId ? (projectList.find((item) => item.id === projectId) ?? null) : null;
  const workspaceList = [...(workspacesQuery.data ?? [])].sort((a, b) => {
    if (a.isDefault !== b.isDefault) {
      return a.isDefault ? -1 : 1;
    }
    return b.updatedAt - a.updatedAt;
  });

  useEffect(() => {
    if (!project) {
      setDetailName("");
      setDetailDescription("");
      setDetailError(null);
      return;
    }

    setDetailName(project.name);
    setDetailDescription(project.description ?? "");
    setDetailError(null);
  }, [project]);

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
      setLastWorkspaceRoute((current) => (current?.projectId === id ? null : current));
      if (projectId === id) {
        navigate("/");
      }
    } finally {
      setDeletingId(null);
    }
  };

  const commitProjectMetadata = async () => {
    if (!project) {
      return;
    }

    const trimmedName = detailName.trim();
    const trimmedDescription = detailDescription.trim();
    const currentDescription = project.description ?? "";

    if (!trimmedName) {
      setDetailError("项目名不能为空。");
      setDetailName(project.name);
      setDetailDescription(currentDescription);
      return;
    }

    if (trimmedName === project.name && trimmedDescription === currentDescription) {
      setDetailError(null);
      if (detailName !== trimmedName) {
        setDetailName(trimmedName);
      }
      if (detailDescription !== trimmedDescription) {
        setDetailDescription(trimmedDescription);
      }
      return;
    }

    try {
      setDetailError(null);
      await updateProject.mutate({
        id: project.id,
        name: trimmedName,
        description: trimmedDescription || null,
      });
      setDetailName(trimmedName);
      setDetailDescription(trimmedDescription);
    } catch (mutationError) {
      setDetailError(
        mutationError instanceof Error ? mutationError.message : "更新项目失败，请稍后重试。",
      );
      setDetailName(project.name);
      setDetailDescription(currentDescription);
    }
  };

  const renderError = error ? (
    <div className="mb-4 flex items-center gap-2 rounded-md border border-border bg-sidebar-background px-3 py-2 text-sm text-accent-foreground">
      <span className="icon-[material-symbols--info] shrink-0 text-base" />
      {error.message}
    </div>
  ) : null;

  return (
    <AppShell active="home">
      {projectId ? (
        <ProjectDetailView
          project={project}
          detailName={detailName}
          detailDescription={detailDescription}
          detailError={detailError ?? updateProject.error?.message ?? null}
          isLoading={isInitialLoading && projectList.length === 0}
          isSaving={updateProject.isPending}
          workspaceList={workspaceList}
          workspaceError={workspacesQuery.error?.message ?? null}
          workspaceLoading={workspacesQuery.isInitialLoading && workspaceList.length === 0}
          lastWorkspaceRoute={lastWorkspaceRoute}
          onClose={() => navigate("/")}
          onNameChange={setDetailName}
          onDescriptionChange={setDetailDescription}
          onMetadataCommit={() => void commitProjectMetadata()}
          onOpenWorkspace={(workspaceId) =>
            navigate(`/project/${projectId}/workspace/${workspaceId}`)
          }
          renderError={renderError}
        />
      ) : (
        <ProjectListView
          projectList={projectList}
          lastProjectId={lastProjectId}
          isLoading={isInitialLoading}
          isDeleting={deleteProject.isPending}
          deletingId={deletingId}
          renderError={renderError}
          onCreateProject={openCreateDialog}
          onOpenProject={(nextProjectId) => navigate(`/project/${nextProjectId}`)}
          onDeleteProject={handleDeleteProject}
        />
      )}

      <dialog
        ref={dialogRef}
        className="w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-border bg-sidebar-background p-0 text-foreground shadow-lg backdrop:bg-black/50"
      >
        <form onSubmit={handleCreateProject}>
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

            {formError || createProject.error ? (
              <div className="flex items-center gap-2 rounded-md border border-border bg-editor-background px-3 py-2 text-sm text-accent-foreground">
                <span className="icon-[material-symbols--warning] shrink-0 text-base" />
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
              className="rounded-md bg-accent-background px-3 py-1.5 text-sm font-medium text-foreground transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
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

function ProjectListView({
  projectList,
  lastProjectId,
  isLoading,
  isDeleting,
  deletingId,
  renderError,
  onCreateProject,
  onOpenProject,
  onDeleteProject,
}: {
  projectList: ProjectList;
  lastProjectId: string | null;
  isLoading: boolean;
  isDeleting: boolean;
  deletingId: string | null;
  renderError: React.ReactNode;
  onCreateProject: () => void;
  onOpenProject: (_projectId: string) => void;
  onDeleteProject: (_projectId: string, _projectName: string) => void;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        icon="icon-[material-symbols--folder]"
        title="项目"
        subtitle={`${projectList.length} 个项目`}
      />

      <div className="flex-1 overflow-y-auto p-6">
        {renderError}

        {isLoading ? (
          <LoadingBlock />
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
            <button
              type="button"
              onClick={onCreateProject}
              className="group flex min-h-36 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-sidebar-background p-4 text-foreground-muted transition hover:border-accent-foreground hover:bg-list-hover-background hover:text-foreground"
            >
              <span className="icon-[material-symbols--add-circle-outline] text-3xl text-accent-foreground transition group-hover:scale-105" />
              <span className="text-sm font-medium">新建项目</span>
            </button>

            {projectList.map((project) => {
              const isLastViewed = project.id === lastProjectId;

              return (
                <div
                  key={project.id}
                  className={`group relative flex min-h-36 flex-col rounded-md border p-4 transition ${
                    isLastViewed
                      ? "border-accent-foreground/40 bg-list-active-background"
                      : "border-border bg-sidebar-background hover:bg-list-hover-background"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onOpenProject(project.id)}
                    className="flex min-h-0 flex-1 flex-col items-start gap-2 text-left"
                  >
                    <div className="flex w-full items-center gap-2">
                      <span className="icon-[material-symbols--folder] text-2xl text-icon-folder" />
                      {isLastViewed ? (
                        <span className="rounded px-1.5 py-0.5 text-[10px] font-medium text-accent-foreground">
                          上次查看
                        </span>
                      ) : null}
                    </div>
                    <span className="line-clamp-2 text-sm font-medium text-foreground">
                      {project.name}
                    </span>
                    <p className="line-clamp-2 flex-1 text-xs leading-relaxed text-foreground-muted">
                      {project.description?.trim() || "暂无描述"}
                    </p>
                    <span className="text-[11px] text-foreground-muted">
                      {dateFormatter.format(project.updatedAt)}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteProject(project.id, project.name)}
                    disabled={isDeleting && deletingId === project.id}
                    className="absolute top-2 right-2 rounded p-1 text-foreground-muted opacity-0 transition group-hover:opacity-100 hover:bg-button-hover-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
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
  );
}

function ProjectDetailView({
  project,
  detailName,
  detailDescription,
  detailError,
  isLoading,
  isSaving,
  workspaceList,
  workspaceError,
  workspaceLoading,
  lastWorkspaceRoute,
  onClose,
  onNameChange,
  onDescriptionChange,
  onMetadataCommit,
  onOpenWorkspace,
  renderError,
}: {
  project: ProjectRow | null;
  detailName: string;
  detailDescription: string;
  detailError: string | null;
  isLoading: boolean;
  isSaving: boolean;
  workspaceList: WorkspaceList;
  workspaceError: string | null;
  workspaceLoading: boolean;
  lastWorkspaceRoute: { projectId: string; workspaceId: string } | null;
  onClose: () => void;
  onNameChange: (_value: string) => void;
  onDescriptionChange: (_value: string) => void;
  onMetadataCommit: () => void;
  onOpenWorkspace: (_workspaceId: string) => void;
  renderError: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        icon="icon-[material-symbols--folder-open]"
        title={project?.name ?? "项目详情"}
        subtitle={project ? "项目详情" : "未找到项目"}
        trailing={
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground-muted transition hover:bg-list-hover-background hover:text-foreground"
          >
            <span className="icon-[material-symbols--close] text-sm" />
            关闭项目
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        {renderError}

        {isLoading ? (
          <LoadingBlock />
        ) : !project ? (
          <div className="h-full">
            <FullPageMessage
              icon="icon-[material-symbols--folder-off]"
              title="未找到项目"
              description="这个项目可能已被删除，或当前链接中的项目 ID 无效。"
              embedded
            />
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
            <section className="rounded-xl border border-border bg-sidebar-background p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <span className="icon-[material-symbols--info] text-base text-accent-foreground" />
                <h2 className="text-sm font-semibold text-foreground">基础信息</h2>
                {isSaving ? (
                  <span className="ml-auto inline-flex items-center gap-1 text-xs text-foreground-muted">
                    <span className="icon-[material-symbols--sync] animate-spin text-sm" />
                    保存中
                  </span>
                ) : (
                  <span className="ml-auto text-xs text-foreground-muted">失焦或回车保存</span>
                )}
              </div>

              <div className="mt-4 grid gap-4">
                <label className="grid gap-1.5">
                  <span className="text-xs font-medium text-foreground-muted">项目名</span>
                  <input
                    value={detailName}
                    disabled={isSaving}
                    onChange={(event) => onNameChange(event.target.value)}
                    onBlur={onMetadataCommit}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        event.currentTarget.blur();
                      }
                    }}
                    className="w-full rounded-md border border-border bg-editor-background px-3 py-2 text-sm text-foreground transition outline-none focus:border-accent-foreground disabled:cursor-wait disabled:opacity-70"
                  />
                </label>

                <label className="grid gap-1.5">
                  <span className="text-xs font-medium text-foreground-muted">描述</span>
                  <textarea
                    value={detailDescription}
                    disabled={isSaving}
                    rows={4}
                    onChange={(event) => onDescriptionChange(event.target.value)}
                    onBlur={onMetadataCommit}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        event.currentTarget.blur();
                      }
                    }}
                    className="w-full resize-y rounded-md border border-border bg-editor-background px-3 py-2 text-sm leading-relaxed text-foreground transition outline-none focus:border-accent-foreground disabled:cursor-wait disabled:opacity-70"
                    placeholder="为这个项目补充背景、目标或当前进度。"
                  />
                  <span className="text-[11px] text-foreground-muted">
                    `Enter` 保存，`Shift+Enter` 换行。
                  </span>
                </label>

                {detailError ? (
                  <div className="flex items-center gap-2 rounded-md border border-border bg-editor-background px-3 py-2 text-sm text-accent-foreground">
                    <span className="icon-[material-symbols--warning] shrink-0 text-base" />
                    {detailError}
                  </div>
                ) : null}

                <div className="text-xs text-foreground-muted">
                  上次更新于 {dateFormatter.format(project.updatedAt)}
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-border bg-sidebar-background p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <span className="icon-[material-symbols--account-tree] text-base text-accent-foreground" />
                <h2 className="text-sm font-semibold text-foreground">Workspace</h2>
                <span className="ml-auto text-xs text-foreground-muted">
                  {workspaceList.length} 个工作区
                </span>
              </div>

              {workspaceError ? (
                <div className="mt-4 flex items-center gap-2 rounded-md border border-border bg-editor-background px-3 py-2 text-sm text-accent-foreground">
                  <span className="icon-[material-symbols--warning] shrink-0 text-base" />
                  {workspaceError}
                </div>
              ) : workspaceLoading ? (
                <div className="mt-4">
                  <LoadingBlock />
                </div>
              ) : workspaceList.length === 0 ? (
                <div className="mt-4 rounded-md border border-dashed border-border bg-editor-background px-4 py-6 text-sm text-foreground-muted">
                  当前项目还没有可用的 workspace。
                </div>
              ) : (
                <div className="mt-4 grid gap-3">
                  {workspaceList.map((workspace) => {
                    const isLastWorkspace = lastWorkspaceRoute?.workspaceId === workspace.id;

                    return (
                      <button
                        key={workspace.id}
                        type="button"
                        onClick={() => onOpenWorkspace(workspace.id)}
                        className="group flex items-center gap-3 rounded-lg border border-border bg-editor-background px-4 py-3 text-left transition hover:border-accent-foreground/40 hover:bg-list-hover-background"
                      >
                        <span className="icon-[material-symbols--description] text-xl text-icon-leaf" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium text-foreground">
                              {workspace.name}
                            </span>
                            {workspace.isDefault ? (
                              <span className="rounded px-1.5 py-0.5 text-[10px] font-medium text-accent-foreground">
                                默认
                              </span>
                            ) : null}
                            {isLastWorkspace ? (
                              <span className="rounded px-1.5 py-0.5 text-[10px] font-medium text-foreground-muted">
                                最近编辑
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-1 text-[11px] text-foreground-muted">
                            更新于 {dateFormatter.format(workspace.updatedAt)}
                          </div>
                        </div>
                        <span className="icon-[material-symbols--arrow-forward] text-base text-foreground-muted transition group-hover:text-foreground" />
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function PageHeader({
  icon,
  title,
  subtitle,
  trailing,
}: {
  icon: string;
  title: string;
  subtitle: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border bg-title-bar-background px-4 py-2">
      <span className={`${icon} text-xl text-icon-folder`} />
      <div className="min-w-0">
        <h1 className="text-[14px] font-semibold text-foreground">{title}</h1>
        <p className="text-[11px] text-foreground-muted">{subtitle}</p>
      </div>
      {trailing ? <div className="ml-auto">{trailing}</div> : null}
    </div>
  );
}

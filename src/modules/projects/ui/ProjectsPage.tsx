import { skipToken } from "@codehz/rpc/react";
import { ScopeProvider } from "bunshi/react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";

import { AppShell, AppSidebar } from "@/app/shell/AppShell";
import {
  lastProjectIdAtom,
  lastWorkspaceRouteAtom,
  projectBranchSelectionAtom,
} from "@/app/state/lastProject";
import { SidebarLayoutScope, SidebarPanels } from "@/shared/ui/sidebar";
import { rpc } from "@/rpc/client";
import { cn } from "@/shared/lib/cn";
import { createProjectId } from "@/shared/lib/domain";
import { FullPageMessage } from "@/shared/ui/FullPageMessage";
import { IconButton } from "@/shared/ui/IconButton";
import { LoadingBlock } from "@/shared/ui/Loading";
import { OverlayScrollbar } from "@/shared/ui/OverlayScrollbar";
import { SidebarListRow } from "@/shared/ui/tree/SidebarListRow";

import {
  insertProjectOptimistically,
  removeProjectOptimistically,
  updateProjectOptimistically,
} from "./projectCache";
import {
  resolveNewBranchSourceCommitId,
  resolveSelectedBranchId,
  sortProjectBranches,
} from "./projectCockpit";

type ProjectList = NonNullable<ReturnType<typeof rpc.useQuery<"projects.list">>["data"]>;
type ProjectRow = NonNullable<ReturnType<typeof rpc.useQuery<"projects.get">>["data"]>;
type BranchList = NonNullable<ReturnType<typeof rpc.useQuery<"branches.list">>["data"]>;
type BranchRow = BranchList[number];
type WorkspaceList = NonNullable<ReturnType<typeof rpc.useQuery<"workspaces.list">>["data"]>;
type WorkspaceRow = WorkspaceList[number];
type CommitHistory = NonNullable<ReturnType<typeof rpc.useQuery<"commits.history">>["data"]>;
type CommitRow = CommitHistory[number];
type WorkingTreeStatus = NonNullable<
  ReturnType<typeof rpc.useQuery<"commits.workingTreeStatus">>["data"]
>;
type ProjectMutationContext = {
  previousProjects?: ProjectList;
};

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "short",
});

const buttonBase =
  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButton = `${buttonBase} border border-border bg-sidebar-background text-foreground hover:bg-list-hover-background`;
const primaryButton = `${buttonBase} bg-accent-background text-foreground hover:brightness-110`;

export function ProjectsPage({ projectId = null }: { projectId?: string | null }) {
  const [, navigate] = useLocation();
  const lastProjectId = useAtomValue(lastProjectIdAtom);
  const setLastProjectId = useSetAtom(lastProjectIdAtom);
  const setLastWorkspaceRoute = useSetAtom(lastWorkspaceRouteAtom);
  const [projectBranchSelection, setProjectBranchSelection] = useAtom(projectBranchSelectionAtom);

  const createProjectDialogRef = useRef<HTMLDialogElement>(null);
  const createBranchDialogRef = useRef<HTMLDialogElement>(null);
  const forkBranchDialogRef = useRef<HTMLDialogElement>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [detailName, setDetailName] = useState("");
  const [detailDescription, setDetailDescription] = useState("");
  const [detailError, setDetailError] = useState<string | null>(null);

  const [newBranchName, setNewBranchName] = useState("");
  const [newBranchError, setNewBranchError] = useState<string | null>(null);
  const [forkBranchName, setForkBranchName] = useState("");
  const [forkBranchError, setForkBranchError] = useState<string | null>(null);
  const [forkCommit, setForkCommit] = useState<CommitRow | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [commitError, setCommitError] = useState<string | null>(null);

  const projectsQuery = rpc.useQuery("projects.list", projectId ? skipToken : undefined, {
    refetchOnWindowFocus: true,
  });
  const projectQuery = rpc.useQuery("projects.get", projectId ? { projectId } : skipToken, {
    refetchOnWindowFocus: true,
  });
  const branchesQuery = rpc.useQuery("branches.list", projectId ? { projectId } : skipToken, {
    refetchOnWindowFocus: true,
  });
  const workspacesQuery = rpc.useQuery("workspaces.list", projectId ? { projectId } : skipToken, {
    refetchOnWindowFocus: true,
  });

  const project = projectQuery.data;
  const branches = branchesQuery.data ?? [];
  const workspaces = workspacesQuery.data ?? [];
  const sortedBranches = sortProjectBranches(branches, project?.defaultBranchId ?? null);
  const rememberedBranchId = projectId ? (projectBranchSelection[projectId] ?? null) : null;
  const selectedBranchId = resolveSelectedBranchId(
    sortedBranches,
    rememberedBranchId,
    project?.defaultBranchId ?? null,
  );
  const selectedBranch = sortedBranches.find((item) => item.id === selectedBranchId) ?? null;

  const commitHistoryQuery = rpc.useQuery(
    "commits.history",
    selectedBranchId ? { branchId: selectedBranchId } : skipToken,
    {
      refetchOnWindowFocus: true,
    },
  );
  const workingTreeStatusQuery = rpc.useQuery(
    "commits.workingTreeStatus",
    selectedBranchId ? { branchId: selectedBranchId } : skipToken,
    {
      refetchOnWindowFocus: true,
    },
  );
  const commitHistory = commitHistoryQuery.data ?? [];
  const workingTreeStatus = workingTreeStatusQuery.data ?? null;

  const workspaceMap = new Map(workspaces.map((workspace) => [workspace.branchId, workspace]));
  const selectedWorkspace = selectedBranch ? (workspaceMap.get(selectedBranch.id) ?? null) : null;
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
              defaultBranchId: null,
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
  const setDefaultBranch = rpc.useMutation("projects.setDefaultBranch");
  const createBranchWithWorkspace = rpc.useMutation("branches.createWithWorkspace");
  const deleteBranch = rpc.useMutation("branches.delete");
  const createCommit = rpc.useMutation("commits.create");

  const projectList = [...(projectsQuery.data ?? [])].sort((a, b) => b.updatedAt - a.updatedAt);

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

  useEffect(() => {
    setCommitMessage("");
    setCommitError(null);
  }, [selectedBranchId]);

  useEffect(() => {
    if (!projectId) {
      return;
    }

    setProjectBranchSelection((current) => {
      if ((current[projectId] ?? null) === selectedBranchId) {
        return current;
      }

      return {
        ...current,
        [projectId]: selectedBranchId,
      };
    });
  }, [projectId, selectedBranchId, setProjectBranchSelection]);

  const openCreateProjectDialog = () => {
    setFormError(null);
    if (!createProjectDialogRef.current?.open) {
      createProjectDialogRef.current?.showModal();
    }
  };

  const closeCreateProjectDialog = () => {
    createProjectDialogRef.current?.close();
    setName("");
    setDescription("");
    setFormError(null);
  };

  const openCreateBranchDialog = () => {
    setNewBranchName("");
    setNewBranchError(null);
    if (!createBranchDialogRef.current?.open) {
      createBranchDialogRef.current?.showModal();
    }
  };

  const closeCreateBranchDialog = () => {
    createBranchDialogRef.current?.close();
    setNewBranchName("");
    setNewBranchError(null);
  };

  const openForkDialog = (commit: CommitRow) => {
    setForkCommit(commit);
    setForkBranchName("");
    setForkBranchError(null);
    if (!forkBranchDialogRef.current?.open) {
      forkBranchDialogRef.current?.showModal();
    }
  };

  const closeForkDialog = () => {
    forkBranchDialogRef.current?.close();
    setForkCommit(null);
    setForkBranchName("");
    setForkBranchError(null);
  };

  const rememberSelectedBranch = (nextBranchId: string | null) => {
    if (!projectId) {
      return;
    }

    setProjectBranchSelection((current) => ({
      ...current,
      [projectId]: nextBranchId,
    }));
  };

  const forgetProjectBranch = (nextProjectId: string) => {
    setProjectBranchSelection((current) => {
      if (!(nextProjectId in current)) {
        return current;
      }

      const next = { ...current };
      delete next[nextProjectId];
      return next;
    });
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
      const id = createProjectId();
      await createProject.mutate({
        id,
        name: trimmedName,
        description: trimmedDescription || null,
      });
      closeCreateProjectDialog();
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
      forgetProjectBranch(id);
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

  const handleCreateBranch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!project) {
      return;
    }

    const trimmedName = newBranchName.trim();
    if (!trimmedName) {
      setNewBranchError("分支名称不能为空。");
      return;
    }

    try {
      const sourceCommitId = resolveNewBranchSourceCommitId(branches, project.defaultBranchId);
      const workspace = await createBranchWithWorkspace.mutate({
        projectId: project.id,
        name: trimmedName,
        fromCommitId: sourceCommitId,
      });
      rememberSelectedBranch(workspace.branchId);
      closeCreateBranchDialog();
      navigate(`/project/${project.id}`);
    } catch (mutationError) {
      setNewBranchError(
        mutationError instanceof Error ? mutationError.message : "创建分支失败，请稍后重试。",
      );
    }
  };

  const handleForkBranch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!project || !forkCommit) {
      return;
    }

    const trimmedName = forkBranchName.trim();
    if (!trimmedName) {
      setForkBranchError("分支名称不能为空。");
      return;
    }

    try {
      const workspace = await createBranchWithWorkspace.mutate({
        projectId: project.id,
        name: trimmedName,
        fromCommitId: forkCommit.id,
      });
      rememberSelectedBranch(workspace.branchId);
      closeForkDialog();
      navigate(`/project/${project.id}`);
    } catch (mutationError) {
      setForkBranchError(
        mutationError instanceof Error ? mutationError.message : "Fork 分支失败，请稍后重试。",
      );
    }
  };

  const handleCommit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedBranch || !selectedWorkspace) {
      return;
    }

    const commitBlockedByCleanTree =
      workingTreeStatus?.headCommitId != null && workingTreeStatus.hasChanges === false;
    if (commitBlockedByCleanTree) {
      return;
    }

    const trimmedMessage = commitMessage.trim();
    if (!trimmedMessage) {
      setCommitError("提交信息不能为空。");
      return;
    }

    try {
      setCommitError(null);
      await createCommit.mutate({
        branchId: selectedBranch.id,
        message: trimmedMessage,
      });
      setCommitMessage("");
    } catch (mutationError) {
      setCommitError(
        mutationError instanceof Error ? mutationError.message : "提交失败，请稍后重试。",
      );
    }
  };

  const handleDeleteBranch = async (branch: BranchRow) => {
    if (!project) {
      return;
    }

    if (!confirm(`确认删除分支“${branch.name}”吗？这会连带删除它绑定的 workspace。`)) {
      return;
    }

    const remainingBranches = sortedBranches.filter((item) => item.id !== branch.id);
    const nextSelectedBranchId = resolveSelectedBranchId(
      remainingBranches,
      selectedBranchId === branch.id ? null : selectedBranchId,
      project.defaultBranchId,
    );

    await deleteBranch.mutate({
      projectId: project.id,
      branchId: branch.id,
    });

    rememberSelectedBranch(nextSelectedBranchId);
    navigate(`/project/${project.id}`);
  };

  const handleSetDefaultBranch = async (branch: BranchRow) => {
    if (!project || project.defaultBranchId === branch.id) {
      return;
    }

    await setDefaultBranch.mutate({
      projectId: project.id,
      branchId: branch.id,
    });
  };

  const renderListError = projectsQuery.error ? (
    <InlineError message={projectsQuery.error.message} />
  ) : null;

  return (
    <>
      <AppShell
        active="home"
        sidebar={
          projectId && project ? (
            <ScopeProvider scope={SidebarLayoutScope} value={`projects:${project.id}`}>
              <ProjectWorkbenchSidebar
                project={project}
                branches={sortedBranches}
                branchesLoading={branchesQuery.isInitialLoading && sortedBranches.length === 0}
                branchesError={branchesQuery.error?.message ?? null}
                selectedBranch={selectedBranch}
                detailName={detailName}
                detailDescription={detailDescription}
                detailError={detailError ?? updateProject.error?.message ?? null}
                isSaving={updateProject.isPending}
                onNameChange={setDetailName}
                onDescriptionChange={setDetailDescription}
                onMetadataCommit={() => void commitProjectMetadata()}
                onSelectBranch={rememberSelectedBranch}
                onCreateBranch={openCreateBranchDialog}
              />
            </ScopeProvider>
          ) : undefined
        }
      >
        {!projectId ? (
          <ProjectListView
            projectList={projectList}
            lastProjectId={lastProjectId}
            isLoading={projectsQuery.isInitialLoading}
            isDeleting={deleteProject.isPending}
            deletingId={deletingId}
            renderError={renderListError}
            onCreateProject={openCreateProjectDialog}
            onOpenProject={(nextProjectId) => navigate(`/project/${nextProjectId}`)}
            onDeleteProject={handleDeleteProject}
          />
        ) : projectQuery.isInitialLoading && !project ? (
          <FullPageMessage
            icon="icon-[material-symbols--sync] animate-spin"
            title="正在加载项目工作台"
            description="正在读取项目、分支和工作副本。"
            embedded
          />
        ) : projectQuery.error ? (
          <FullPageMessage
            icon="icon-[material-symbols--folder-off]"
            title="未找到项目"
            description={projectQuery.error.message}
            embedded
          />
        ) : project ? (
          <ProjectWorkbenchMain
            project={project}
            selectedBranch={selectedBranch}
            selectedWorkspace={selectedWorkspace}
            commitHistory={commitHistory}
            commitHistoryLoading={commitHistoryQuery.isInitialLoading && commitHistory.length === 0}
            commitHistoryError={commitHistoryQuery.error?.message ?? null}
            workingTreeStatus={workingTreeStatus}
            workingTreeStatusLoading={
              workingTreeStatusQuery.isInitialLoading && workingTreeStatus == null
            }
            workingTreeStatusError={workingTreeStatusQuery.error?.message ?? null}
            commitMessage={commitMessage}
            commitError={commitError ?? createCommit.error?.message ?? null}
            isCommitting={createCommit.isPending}
            isSettingDefault={setDefaultBranch.isPending}
            isDeletingBranch={deleteBranch.isPending}
            onClose={() => navigate("/")}
            onOpenWorkspace={(workspaceId) =>
              navigate(`/project/${project.id}/workspace/${workspaceId}`)
            }
            onSetDefaultBranch={handleSetDefaultBranch}
            onDeleteBranch={() =>
              selectedBranch ? void handleDeleteBranch(selectedBranch) : undefined
            }
            onOpenFork={openForkDialog}
            onCommitMessageChange={setCommitMessage}
            onSubmitCommit={(event) => void handleCommit(event)}
          />
        ) : (
          <FullPageMessage
            icon="icon-[material-symbols--folder-off]"
            title="未找到项目"
            description="这个项目可能已被删除，或当前链接中的项目 ID 无效。"
            embedded
          />
        )}
      </AppShell>

      <ProjectDialog
        dialogRef={createProjectDialogRef}
        title="新建项目"
        icon="icon-[material-symbols--add-circle-outline]"
        onClose={closeCreateProjectDialog}
        onSubmit={handleCreateProject}
        error={formError ?? createProject.error?.message ?? null}
        isPending={createProject.isPending}
        pendingLabel="创建中"
        submitLabel="创建"
      >
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
      </ProjectDialog>

      <ProjectDialog
        dialogRef={createBranchDialogRef}
        title="新建分支"
        icon="icon-[material-symbols--account-tree]"
        onClose={closeCreateBranchDialog}
        onSubmit={handleCreateBranch}
        error={newBranchError ?? createBranchWithWorkspace.error?.message ?? null}
        isPending={createBranchWithWorkspace.isPending}
        pendingLabel="创建中"
        submitLabel="创建分支"
      >
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
      </ProjectDialog>

      <ProjectDialog
        dialogRef={forkBranchDialogRef}
        title="Fork 分支"
        icon="icon-[material-symbols--fork-right]"
        onClose={closeForkDialog}
        onSubmit={handleForkBranch}
        error={forkBranchError ?? createBranchWithWorkspace.error?.message ?? null}
        isPending={createBranchWithWorkspace.isPending}
        pendingLabel="Fork 中"
        submitLabel="创建 Fork"
      >
        <div className="rounded-md border border-border bg-editor-background px-3 py-2 text-xs text-foreground-muted">
          来源提交：{forkCommit ? `${forkCommit.message} · ${shortId(forkCommit.id)}` : "—"}
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
      </ProjectDialog>
    </>
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
  renderError: ReactNode;
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
                  className={cn(
                    "group relative flex min-h-36 flex-col rounded-md border p-4 transition",
                    isLastViewed
                      ? "border-accent-foreground/40 bg-list-active-background"
                      : "border-border bg-sidebar-background hover:bg-list-hover-background",
                  )}
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

function ProjectWorkbenchSidebar({
  project,
  branches,
  branchesLoading,
  branchesError,
  selectedBranch,
  detailName,
  detailDescription,
  detailError,
  isSaving,
  onNameChange,
  onDescriptionChange,
  onMetadataCommit,
  onSelectBranch,
  onCreateBranch,
}: {
  project: ProjectRow;
  branches: BranchList;
  branchesLoading: boolean;
  branchesError: string | null;
  selectedBranch: BranchRow | null;
  detailName: string;
  detailDescription: string;
  detailError: string | null;
  isSaving: boolean;
  onNameChange: (_value: string) => void;
  onDescriptionChange: (_value: string) => void;
  onMetadataCommit: () => void;
  onSelectBranch: (_branchId: string | null) => void;
  onCreateBranch: () => void;
}) {
  return (
    <AppSidebar>
      <div className="border-b border-border px-3 py-3">
        <div className="text-[11px] font-semibold tracking-wider text-foreground-muted uppercase">
          项目工作台
        </div>
        <div className="mt-1 truncate text-sm font-medium text-foreground">{project.name}</div>
      </div>

      <SidebarPanels
        panels={[
          {
            title: `Branches · ${branches.length}`,
            actions: (
              <IconButton
                icon="icon-[material-symbols--add]"
                title="新建分支"
                onClick={onCreateBranch}
              />
            ),
            content: (
              <ProjectBranchListPanel
                project={project}
                branches={branches}
                branchesLoading={branchesLoading}
                branchesError={branchesError}
                selectedBranch={selectedBranch}
                onSelectBranch={onSelectBranch}
              />
            ),
          },
          {
            title: "Project Meta",
            content: (
              <ProjectMetaPanel
                project={project}
                detailName={detailName}
                detailDescription={detailDescription}
                detailError={detailError}
                isSaving={isSaving}
                branchCount={branches.length}
                onNameChange={onNameChange}
                onDescriptionChange={onDescriptionChange}
                onMetadataCommit={onMetadataCommit}
              />
            ),
          },
        ]}
      />
    </AppSidebar>
  );
}

function ProjectBranchListPanel({
  project,
  branches,
  branchesLoading,
  branchesError,
  selectedBranch,
  onSelectBranch,
}: {
  project: ProjectRow;
  branches: BranchList;
  branchesLoading: boolean;
  branchesError: string | null;
  selectedBranch: BranchRow | null;
  onSelectBranch: (_branchId: string | null) => void;
}) {
  if (branchesError) {
    return (
      <div className="p-3">
        <InlineError message={branchesError} />
      </div>
    );
  }

  if (branchesLoading) {
    return (
      <div className="p-3">
        <LoadingBlock label="正在加载分支..." />
      </div>
    );
  }

  if (branches.length === 0) {
    return (
      <div className="p-3">
        <div className="rounded-md border border-dashed border-border bg-editor-background px-4 py-8 text-sm text-foreground-muted">
          当前项目还没有 branch，先创建一个分支开始工作。
        </div>
      </div>
    );
  }

  return (
    <div className="py-1">
      {branches.map((branch) => (
        <SidebarListRow
          key={branch.id}
          isActive={branch.id === selectedBranch?.id}
          onClick={() => onSelectBranch(branch.id)}
          icon={
            <span className="icon-[material-symbols--fork-right] text-base text-foreground-muted" />
          }
          label={
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate">{branch.name}</span>
              {project.defaultBranchId === branch.id ? (
                <span className="rounded px-1.5 py-0.5 text-[10px] font-medium text-accent-foreground">
                  默认
                </span>
              ) : null}
            </div>
          }
          trailing={branch.headCommitId ? shortId(branch.headCommitId) : "空分支"}
        />
      ))}
    </div>
  );
}

function ProjectMetaPanel({
  project,
  detailName,
  detailDescription,
  detailError,
  isSaving,
  branchCount,
  onNameChange,
  onDescriptionChange,
  onMetadataCommit,
}: {
  project: ProjectRow;
  detailName: string;
  detailDescription: string;
  detailError: string | null;
  isSaving: boolean;
  branchCount: number;
  onNameChange: (_value: string) => void;
  onDescriptionChange: (_value: string) => void;
  onMetadataCommit: () => void;
}) {
  return (
    <OverlayScrollbar className="h-full min-h-0 w-full">
      <div className="space-y-4 p-3">
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-foreground-muted">项目名</span>
          <input
            value={detailName}
            disabled={isSaving}
            onChange={(event) => onNameChange(event.target.value)}
            onBlur={onMetadataCommit}
            className="w-full rounded-md border border-border bg-editor-background px-3 py-2 text-sm text-foreground transition outline-none focus:border-accent-foreground disabled:cursor-wait disabled:opacity-70"
          />
        </label>

        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-foreground-muted">描述</span>
          <textarea
            value={detailDescription}
            disabled={isSaving}
            rows={5}
            onChange={(event) => onDescriptionChange(event.target.value)}
            onBlur={onMetadataCommit}
            className="w-full resize-y rounded-md border border-border bg-editor-background px-3 py-2 text-sm leading-relaxed text-foreground transition outline-none focus:border-accent-foreground disabled:cursor-wait disabled:opacity-70"
            placeholder="为这个项目补充背景、目标或当前进度。"
          />
        </label>

        {detailError ? <InlineError message={detailError} /> : null}

        <div className="rounded-md border border-border bg-editor-background p-3">
          <div className="text-[11px] tracking-wide text-foreground-muted/70 uppercase">Stats</div>
          <div className="mt-2 space-y-2 text-sm text-foreground">
            <div className="flex items-center justify-between gap-3">
              <span className="text-foreground-muted">Branch 数量</span>
              <span>{branchCount}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-foreground-muted">上次更新</span>
              <span className="text-right text-xs">{dateFormatter.format(project.updatedAt)}</span>
            </div>
          </div>
        </div>
      </div>
    </OverlayScrollbar>
  );
}

function ProjectWorkbenchMain({
  project,
  selectedBranch,
  selectedWorkspace,
  commitHistory,
  commitHistoryLoading,
  commitHistoryError,
  workingTreeStatus,
  workingTreeStatusLoading,
  workingTreeStatusError,
  commitMessage,
  commitError,
  isCommitting,
  isSettingDefault,
  isDeletingBranch,
  onClose,
  onOpenWorkspace,
  onSetDefaultBranch,
  onDeleteBranch,
  onOpenFork,
  onCommitMessageChange,
  onSubmitCommit,
}: {
  project: ProjectRow;
  selectedBranch: BranchRow | null;
  selectedWorkspace: WorkspaceRow | null;
  commitHistory: CommitHistory;
  commitHistoryLoading: boolean;
  commitHistoryError: string | null;
  workingTreeStatus: WorkingTreeStatus | null;
  workingTreeStatusLoading: boolean;
  workingTreeStatusError: string | null;
  commitMessage: string;
  commitError: string | null;
  isCommitting: boolean;
  isSettingDefault: boolean;
  isDeletingBranch: boolean;
  onClose: () => void;
  onOpenWorkspace: (_workspaceId: string) => void;
  onSetDefaultBranch: (_branch: BranchRow) => void;
  onDeleteBranch: () => void;
  onOpenFork: (_commit: CommitRow) => void;
  onCommitMessageChange: (_value: string) => void;
  onSubmitCommit: (_event: FormEvent<HTMLFormElement>) => void;
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

      <div className="flex-1 overflow-y-auto p-6">
        <BranchDetailPanel
          project={project}
          selectedBranch={selectedBranch}
          selectedWorkspace={selectedWorkspace}
          commitHistory={commitHistory}
          commitHistoryLoading={commitHistoryLoading}
          commitHistoryError={commitHistoryError}
          workingTreeStatus={workingTreeStatus}
          workingTreeStatusLoading={workingTreeStatusLoading}
          workingTreeStatusError={workingTreeStatusError}
          commitMessage={commitMessage}
          commitError={commitError}
          isCommitting={isCommitting}
          isSettingDefault={isSettingDefault}
          isDeletingBranch={isDeletingBranch}
          onOpenWorkspace={onOpenWorkspace}
          onSetDefaultBranch={onSetDefaultBranch}
          onDeleteBranch={onDeleteBranch}
          onOpenFork={onOpenFork}
          onCommitMessageChange={onCommitMessageChange}
          onSubmitCommit={onSubmitCommit}
        />
      </div>
    </div>
  );
}

function BranchDetailPanel({
  project,
  selectedBranch,
  selectedWorkspace,
  commitHistory,
  commitHistoryLoading,
  commitHistoryError,
  workingTreeStatus,
  workingTreeStatusLoading,
  workingTreeStatusError,
  commitMessage,
  commitError,
  isCommitting,
  isSettingDefault,
  isDeletingBranch,
  onOpenWorkspace,
  onSetDefaultBranch,
  onDeleteBranch,
  onOpenFork,
  onCommitMessageChange,
  onSubmitCommit,
}: {
  project: ProjectRow;
  selectedBranch: BranchRow | null;
  selectedWorkspace: WorkspaceRow | null;
  commitHistory: CommitHistory;
  commitHistoryLoading: boolean;
  commitHistoryError: string | null;
  workingTreeStatus: WorkingTreeStatus | null;
  workingTreeStatusLoading: boolean;
  workingTreeStatusError: string | null;
  commitMessage: string;
  commitError: string | null;
  isCommitting: boolean;
  isSettingDefault: boolean;
  isDeletingBranch: boolean;
  onOpenWorkspace: (_workspaceId: string) => void;
  onSetDefaultBranch: (_branch: BranchRow) => void;
  onDeleteBranch: () => void;
  onOpenFork: (_commit: CommitRow) => void;
  onCommitMessageChange: (_value: string) => void;
  onSubmitCommit: (_event: FormEvent<HTMLFormElement>) => void;
}) {
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
  const commitDisabled = workspaceMissing || isCommitting || commitDisabledByCleanTree;

  return (
    <div className="mx-auto grid min-h-full w-full max-w-6xl gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,28rem)]">
      <section className="rounded-xl border border-border bg-sidebar-background p-5 shadow-sm">
        <div className="flex flex-wrap items-start gap-3 border-b border-border pb-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-lg font-semibold text-foreground">
                {selectedBranch.name}
              </h2>
              {project.defaultBranchId === selectedBranch.id ? (
                <span className="rounded px-1.5 py-0.5 text-[10px] font-medium text-accent-foreground">
                  默认分支
                </span>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-foreground-muted">
              <span>更新时间 {dateFormatter.format(selectedBranch.updatedAt)}</span>
              <span>
                HEAD {selectedBranch.headCommitId ? shortId(selectedBranch.headCommitId) : "—"}
              </span>
              <span>
                Fork 自{" "}
                {selectedBranch.forkedFromCommitId
                  ? shortId(selectedBranch.forkedFromCommitId)
                  : "空分支"}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
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
          <div className="mt-4 rounded-md border border-border bg-editor-background px-4 py-3 text-sm text-accent-foreground">
            该分支当前没有对应 workspace，只支持只读查看历史，不能打开编辑器或直接提交。
          </div>
        ) : null}

        <section className="mt-6 rounded-lg border border-border bg-editor-background p-4">
          <div className="flex items-center gap-2">
            <span className="icon-[material-symbols--history] text-base text-accent-foreground" />
            <h3 className="text-sm font-semibold text-foreground">提交历史</h3>
          </div>

          <div className="mt-4">
            {commitHistoryError ? (
              <InlineError message={commitHistoryError} />
            ) : commitHistoryLoading ? (
              <LoadingBlock label="正在加载提交历史..." />
            ) : commitHistory.length === 0 ? (
              <div className="rounded-md border border-dashed border-border bg-sidebar-background px-4 py-8 text-sm text-foreground-muted">
                这个分支还没有提交历史。
              </div>
            ) : (
              <div className="space-y-3">
                {commitHistory.map((commit) => (
                  <article
                    key={commit.id}
                    className="rounded-lg border border-border bg-sidebar-background px-4 py-3"
                  >
                    <div className="flex flex-wrap items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="font-medium text-foreground">{commit.message}</div>
                          {commit.id === selectedBranch.headCommitId ? (
                            <span className="rounded px-1.5 py-0.5 text-[10px] font-medium text-accent-foreground">
                              HEAD
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-3 text-xs text-foreground-muted">
                          <span>{shortId(commit.id)}</span>
                          <span>{dateFormatter.format(commit.committedAt)}</span>
                          <span>父提交 {commit.parents.length}</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => onOpenFork(commit)}
                        className={secondaryButton}
                      >
                        <span className="icon-[material-symbols--fork-right] text-base" />
                        Fork
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      </section>

      <section className="rounded-xl border border-border bg-sidebar-background p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="icon-[material-symbols--upload] text-base text-accent-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Commit</h3>
        </div>

        {!workspaceMissing ? (
          <WorkingTreeStatusPanel
            status={workingTreeStatus}
            loading={workingTreeStatusLoading}
            error={workingTreeStatusError}
          />
        ) : null}

        <form className="mt-4 grid gap-3" onSubmit={onSubmitCommit}>
          <textarea
            value={commitMessage}
            onChange={(event) => onCommitMessageChange(event.target.value)}
            rows={5}
            disabled={commitDisabled}
            placeholder="描述这次提交做了什么。"
            className="w-full resize-y rounded-md border border-border bg-editor-background px-3 py-2 text-sm leading-relaxed text-foreground transition outline-none focus:border-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
          />
          {commitError ? <InlineError message={commitError} /> : null}
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

function ProjectDialog({
  dialogRef,
  title,
  icon,
  onClose,
  onSubmit,
  error,
  isPending,
  pendingLabel,
  submitLabel,
  children,
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  title: string;
  icon: string;
  onClose: () => void;
  onSubmit: (_event: FormEvent<HTMLFormElement>) => void;
  error: string | null;
  isPending: boolean;
  pendingLabel: string;
  submitLabel: string;
  children: ReactNode;
}) {
  return (
    <dialog
      ref={dialogRef}
      className="w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-border bg-sidebar-background p-0 text-foreground shadow-lg backdrop:bg-black/50"
    >
      <form onSubmit={onSubmit}>
        <div className="flex items-center gap-2 border-b border-border px-4 py-2">
          <span className={cn(icon, "text-base text-accent-foreground")} />
          <span className="text-sm font-medium">{title}</span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded p-0.5 text-foreground-muted transition hover:bg-button-hover-background hover:text-foreground"
          >
            <span className="icon-[material-symbols--close] text-base leading-none" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          {children}
          {error ? <InlineError message={error} /> : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button type="button" onClick={onClose} className={secondaryButton}>
            取消
          </button>
          <button type="submit" disabled={isPending} className={primaryButton}>
            {isPending ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="icon-[material-symbols--sync] animate-spin text-base" />
                {pendingLabel}
              </span>
            ) : (
              submitLabel
            )}
          </button>
        </div>
      </form>
    </dialog>
  );
}

const workingTreeChangeKindLabels: Record<
  WorkingTreeStatus["areas"]["content"]["changes"][number]["kind"],
  string
> = {
  added: "新增",
  modified: "修改",
  deleted: "删除",
};

const workingTreeAreaLabels = {
  content: "正文",
  timeline: "时间线",
  aux: "辅助信息",
} as const;

function WorkingTreeStatusPanel({
  status,
  loading,
  error,
}: {
  status: WorkingTreeStatus | null;
  loading: boolean;
  error: string | null;
}) {
  return (
    <section className="mt-4 rounded-lg border border-border bg-editor-background p-4">
      <div className="flex items-center gap-2">
        <span className="icon-[material-symbols--difference] text-base text-accent-foreground" />
        <h4 className="text-sm font-semibold text-foreground">未提交变更</h4>
      </div>

      <div className="mt-3">
        {error ? (
          <InlineError message={error} />
        ) : loading ? (
          <LoadingBlock label="正在对比工作区与 HEAD..." />
        ) : status == null ? null : status.headCommitId == null ? (
          <p className="text-sm text-foreground-muted">尚无提交，可创建首次提交。</p>
        ) : !status.hasChanges ? (
          <p className="text-sm text-foreground-muted">工作区与 HEAD 一致，无未提交变更。</p>
        ) : (
          <div className="space-y-4">
            {(Object.keys(workingTreeAreaLabels) as Array<keyof typeof workingTreeAreaLabels>).map(
              (areaKey) => {
                const area = status.areas[areaKey];
                if (!area.changed) {
                  return null;
                }

                return (
                  <div key={areaKey}>
                    <div className="text-xs font-medium text-foreground-muted">
                      {workingTreeAreaLabels[areaKey]}
                    </div>
                    <ul className="mt-2 space-y-1.5">
                      {area.changes.map((change) => (
                        <li
                          key={`${areaKey}-${change.kind}-${change.label}`}
                          className="flex items-center gap-2 text-sm text-foreground"
                        >
                          <WorkingTreeChangeBadge kind={change.kind} />
                          <WorkingTreeChangeLabel
                            label={change.label}
                            emphasizeTimeline={areaKey === "aux"}
                          />
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              },
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function WorkingTreeChangeLabel({
  label,
  emphasizeTimeline,
}: {
  label: string;
  emphasizeTimeline: boolean;
}) {
  if (!emphasizeTimeline) {
    return <span className="min-w-0 truncate">{label}</span>;
  }

  const timelineMarkerIndex = label.lastIndexOf("@");
  if (timelineMarkerIndex < 0) {
    return <span className="min-w-0 truncate">{label}</span>;
  }

  const path = label.slice(0, timelineMarkerIndex);
  const timelineRef = label.slice(timelineMarkerIndex);

  return (
    <span className="min-w-0 truncate">
      {path}
      <span className="text-foreground-muted italic">{timelineRef}</span>
    </span>
  );
}

function WorkingTreeChangeBadge({
  kind,
}: {
  kind: WorkingTreeStatus["areas"]["content"]["changes"][number]["kind"];
}) {
  const label = workingTreeChangeKindLabels[kind];
  const className =
    kind === "added"
      ? "bg-emerald-500/15 text-emerald-200"
      : kind === "deleted"
        ? "bg-red-500/15 text-red-200"
        : "bg-amber-500/15 text-amber-200";

  return (
    <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium", className)}>
      {label}
    </span>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-editor-background px-3 py-2 text-sm text-accent-foreground">
      <span className="icon-[material-symbols--warning] shrink-0 text-base" />
      {message}
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
  trailing?: ReactNode;
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

function shortId(id: string) {
  return id.length > 16 ? `${id.slice(0, 16)}…` : id;
}

import { type FormEvent, useRef } from "react";
import { useLocation } from "wouter";

import { AppShell } from "@/app/shell/AppShell";
import { useLastProjectStore } from "@/app/state/lastProject";
import { rpc } from "@/rpc/client";
import { createProjectId } from "@/shared/lib/domain";

import { CreateProjectDialog } from "./CreateProjectDialog";
import { insertProjectOptimistically, removeProjectOptimistically } from "../shared/projectCache";
import { ProjectListView } from "./ProjectListView";
import type { ProjectList } from "../shared/projectTypes";
import { InlineError } from "../shared/projectUi";
import { useProjectListStoreApi } from "./state/projectListStore";

type ProjectListMutationContext = {
  previousProjects?: ProjectList;
};

export function ProjectListRoute() {
  const [, navigate] = useLocation();
  const lastProjectId = useLastProjectStore((state) => state.lastProjectId);
  const setLastProjectId = useLastProjectStore((state) => state.setLastProjectId);
  const setLastWorkspaceRoute = useLastProjectStore((state) => state.setLastWorkspaceRoute);
  const projectListStore = useProjectListStoreApi();
  const createProjectDialogRef = useRef<HTMLDialogElement>(null);

  const projectsQuery = rpc.useQuery("projects.list", undefined, {
    refetchOnWindowFocus: true,
  });

  const createProject = rpc.useMutation<"projects.create", ProjectListMutationContext>(
    "projects.create",
    {
      onMutate: (input) => {
        const previousProjects = rpc.getQueryData("projects.list", undefined);
        if (previousProjects) {
          rpc.setQueryData(
            "projects.list",
            undefined,
            insertProjectOptimistically(previousProjects, {
              id: input.id,
              name: input.name,
              description: input.description ?? null,
              defaultBranchName: null,
              updatedAt: Date.now(),
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

  const deleteProject = rpc.useMutation<"projects.delete", ProjectListMutationContext>(
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

  const projectList = [...(projectsQuery.data ?? [])].sort((a, b) => b.updatedAt - a.updatedAt);

  const openCreateProjectDialog = () => {
    projectListStore.getState().setCreateProjectError(null);
    if (!createProjectDialogRef.current?.open) {
      createProjectDialogRef.current?.showModal();
    }
  };

  const closeCreateProjectDialog = () => {
    createProjectDialogRef.current?.close();
    projectListStore.getState().resetCreateProjectDialog();
  };

  const handleCreateProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const { createProjectName, createProjectDescription, setCreateProjectError } =
      projectListStore.getState();
    const trimmedName = createProjectName.trim();
    const trimmedDescription = createProjectDescription.trim();

    if (!trimmedName) {
      setCreateProjectError("项目名不能为空。");
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
      setCreateProjectError(
        mutationError instanceof Error ? mutationError.message : "创建项目失败，请稍后重试。",
      );
    }
  };

  const handleDeleteProject = async (id: string, projectName: string) => {
    const { setDeletingProjectId } = projectListStore.getState();

    if (!confirm(`确认删除项目“${projectName}”吗？`)) {
      return;
    }

    try {
      setDeletingProjectId(id);
      await deleteProject.mutate({ id });
      setLastProjectId((current) => (current === id ? null : current));
      setLastWorkspaceRoute((current) => (current?.projectId === id ? null : current));
    } finally {
      setDeletingProjectId(null);
    }
  };

  const renderListError = projectsQuery.error ? (
    <InlineError message={projectsQuery.error.message} />
  ) : null;

  return (
    <>
      <AppShell>
        <ProjectListView
          projectList={projectList}
          lastProjectId={lastProjectId}
          isLoading={projectsQuery.isInitialLoading}
          isDeleting={deleteProject.isPending}
          renderError={renderListError}
          onCreateProject={openCreateProjectDialog}
          onOpenProject={(nextProjectId) => navigate(`/project/${nextProjectId}`)}
          onDeleteProject={(id, name) => void handleDeleteProject(id, name)}
        />
      </AppShell>

      <CreateProjectDialog
        dialogRef={createProjectDialogRef}
        onClose={closeCreateProjectDialog}
        onSubmit={(event) => void handleCreateProject(event)}
        mutationError={createProject.error?.message ?? null}
        isPending={createProject.isPending}
      />
    </>
  );
}

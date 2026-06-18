import { skipToken } from "@codehz/rpc/react";
import { ScopeProvider } from "bunshi/react";
import { type FormEvent, useEffect, useRef } from "react";
import { useLocation } from "wouter";

import { AppShell } from "@/app/shell/AppShell";
import { useLastProjectStore } from "@/app/state/lastProject";
import { rpc } from "@/rpc/client";
import { FullPageMessage } from "@/shared/ui/FullPageMessage";
import { SidebarLayoutScope } from "@/shared/ui/sidebar";

import { CreateBranchDialog, ForkBranchDialog } from "./ProjectDialogFields";
import { updateProjectOptimistically } from "./projectCache";
import {
  resolveNewBranchSourceCommitId,
  resolveSelectedBranchId,
  resolveWorkspaceRouteAfterBranchDelete,
  sortProjectBranches,
} from "./projectCockpit";
import type { BranchRow, CommitRow, ProjectList } from "./projectTypes";
import { ProjectWorkbenchMain } from "./ProjectWorkbenchMain";
import { ProjectWorkbenchSidebar } from "./ProjectWorkbenchSidebar";
import { useProjectWorkbenchStoreApi } from "./state/projectWorkbenchStore";

type ProjectMutationContext = {
  previousProjects?: ProjectList;
};

export function ProjectWorkbenchRoute({ projectId }: { projectId: string }) {
  const [, navigate] = useLocation();
  const projectBranchSelection = useLastProjectStore((state) => state.projectBranchSelection);
  const setProjectBranchSelection = useLastProjectStore((state) => state.setProjectBranchSelection);
  const setLastWorkspaceRoute = useLastProjectStore((state) => state.setLastWorkspaceRoute);
  const workbenchStore = useProjectWorkbenchStoreApi();
  const createBranchDialogRef = useRef<HTMLDialogElement>(null);
  const forkBranchDialogRef = useRef<HTMLDialogElement>(null);

  const projectQuery = rpc.useQuery(
    "projects.get",
    { projectId },
    {
      refetchOnWindowFocus: true,
    },
  );
  const branchesQuery = rpc.useQuery(
    "branches.list",
    { projectId },
    {
      refetchOnWindowFocus: true,
    },
  );
  const workspacesQuery = rpc.useQuery(
    "workspaces.list",
    { projectId },
    {
      refetchOnWindowFocus: true,
    },
  );
  const branchHeadsQuery = rpc.useQuery(
    "branches.heads",
    { projectId },
    {
      refetchOnWindowFocus: true,
    },
  );

  const project = projectQuery.data;
  const branches = branchesQuery.data ?? [];
  const workspaces = workspacesQuery.data ?? [];
  const branchHeads = branchHeadsQuery.data ?? [];
  const branchHeadCommitIdById = new Map(
    branchHeads.map((branchHead) => [branchHead.branchId, branchHead.headCommitId] as const),
  );
  const sortedBranches = sortProjectBranches(branches, project?.defaultBranchId ?? null);
  const rememberedBranchId = projectBranchSelection[projectId] ?? null;
  const selectedBranchId = resolveSelectedBranchId(
    sortedBranches,
    rememberedBranchId,
    project?.defaultBranchId ?? null,
  );
  const selectedBranch = sortedBranches.find((item) => item.id === selectedBranchId) ?? null;
  const selectedBranchHeadCommitId = selectedBranch
    ? (branchHeadCommitIdById.get(selectedBranch.id) ?? null)
    : null;

  const commitHistoryQuery = rpc.useQuery(
    "commits.history",
    selectedBranchId ? { projectId, branchId: selectedBranchId } : skipToken,
    {
      refetchOnWindowFocus: true,
    },
  );
  const workingTreeStatusQuery = rpc.useQuery(
    "commits.workingTreeStatus",
    selectedBranchId ? { projectId, branchId: selectedBranchId } : skipToken,
    {
      refetchOnWindowFocus: true,
    },
  );
  const commitHistory = commitHistoryQuery.data ?? [];
  const workingTreeStatus = workingTreeStatusQuery.data ?? null;

  const workspaceMap = new Map(workspaces.map((workspace) => [workspace.branchId, workspace]));
  const selectedWorkspace = selectedBranch ? (workspaceMap.get(selectedBranch.id) ?? null) : null;

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
  const setDefaultBranch = rpc.useMutation("projects.setDefaultBranch");
  const createBranchWithWorkspace = rpc.useMutation("branches.createWithWorkspace");
  const deleteBranch = rpc.useMutation("branches.delete");
  const createCommit = rpc.useMutation("commits.create");
  const checkoutCommit = rpc.useMutation("commits.checkout");

  useEffect(() => {
    workbenchStore.getState().syncProjectDetail(project ?? null);
  }, [project, workbenchStore]);

  useEffect(() => {
    workbenchStore.getState().resetCommitDraft();
  }, [selectedBranchId, workbenchStore]);

  useEffect(() => {
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

  const rememberSelectedBranch = (nextBranchId: string | null) => {
    setProjectBranchSelection((current) => ({
      ...current,
      [projectId]: nextBranchId,
    }));
  };

  const openCreateBranchDialog = () => {
    workbenchStore.getState().resetCreateBranchDialog();
    if (!createBranchDialogRef.current?.open) {
      createBranchDialogRef.current?.showModal();
    }
  };

  const closeCreateBranchDialog = () => {
    createBranchDialogRef.current?.close();
    workbenchStore.getState().resetCreateBranchDialog();
  };

  const openForkDialog = (commit: CommitRow) => {
    workbenchStore.setState({
      forkCommit: commit,
      forkBranchName: "",
      forkBranchError: null,
    });
    if (!forkBranchDialogRef.current?.open) {
      forkBranchDialogRef.current?.showModal();
    }
  };

  const closeForkDialog = () => {
    forkBranchDialogRef.current?.close();
    workbenchStore.getState().resetForkBranchDialog();
  };

  const commitProjectMetadata = async () => {
    if (!project) {
      return;
    }

    const { detailName, detailDescription, setDetailError, setDetailName, setDetailDescription } =
      workbenchStore.getState();
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

    const { newBranchName, setNewBranchError } = workbenchStore.getState();
    const trimmedName = newBranchName.trim();
    if (!trimmedName) {
      setNewBranchError("分支名称不能为空。");
      return;
    }

    try {
      const sourceCommitId = resolveNewBranchSourceCommitId(branchHeads, project.defaultBranchId);
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
    const { forkBranchName, forkCommit, setForkBranchError } = workbenchStore.getState();

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

  const handleDiscardChanges = async () => {
    if (!selectedBranch || !selectedWorkspace || !workingTreeStatus?.headCommitId) {
      return;
    }

    if (!confirm("确认撤回全部未提交修改吗？工作区将恢复到当前 HEAD 状态，此操作不可撤销。")) {
      return;
    }

    try {
      workbenchStore.getState().setDiscardError(null);
      await checkoutCommit.mutate({
        projectId,
        workspaceId: selectedWorkspace.id,
        commitId: workingTreeStatus.headCommitId,
      });
    } catch (mutationError) {
      workbenchStore
        .getState()
        .setDiscardError(
          mutationError instanceof Error ? mutationError.message : "撤回修改失败，请稍后重试。",
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

    const { commitMessage, setCommitError, setCommitMessage } = workbenchStore.getState();
    const trimmedMessage = commitMessage.trim();
    if (!trimmedMessage) {
      setCommitError("提交信息不能为空。");
      return;
    }

    try {
      setCommitError(null);
      await createCommit.mutate({
        projectId,
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
    const deletedWorkspace = workspaceMap.get(branch.id) ?? null;

    await deleteBranch.mutate({
      projectId: project.id,
      branchId: branch.id,
    });

    setLastWorkspaceRoute((current) =>
      resolveWorkspaceRouteAfterBranchDelete(current, deletedWorkspace),
    );
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

  return (
    <>
      <AppShell
        active="home"
        sidebar={
          project ? (
            <ScopeProvider scope={SidebarLayoutScope} value={`projects:${project.id}`}>
              <ProjectWorkbenchSidebar
                project={project}
                branches={sortedBranches}
                branchHeadCommitIdById={branchHeadCommitIdById}
                branchesLoading={branchesQuery.isInitialLoading && sortedBranches.length === 0}
                branchesError={branchesQuery.error?.message ?? null}
                selectedBranch={selectedBranch}
                metadataErrorMessage={updateProject.error?.message ?? null}
                isSaving={updateProject.isPending}
                onMetadataCommit={() => void commitProjectMetadata()}
                onSelectBranch={rememberSelectedBranch}
                onCreateBranch={openCreateBranchDialog}
              />
            </ScopeProvider>
          ) : undefined
        }
      >
        {projectQuery.isInitialLoading && !project ? (
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
            selectedBranchHeadCommitId={selectedBranchHeadCommitId}
            selectedWorkspace={selectedWorkspace}
            commitHistory={commitHistory}
            commitHistoryLoading={commitHistoryQuery.isInitialLoading && commitHistory.length === 0}
            commitHistoryError={commitHistoryQuery.error?.message ?? null}
            workingTreeStatus={workingTreeStatus}
            workingTreeStatusLoading={
              workingTreeStatusQuery.isInitialLoading && workingTreeStatus == null
            }
            workingTreeStatusError={workingTreeStatusQuery.error?.message ?? null}
            discardErrorMessage={checkoutCommit.error?.message ?? null}
            commitErrorMessage={createCommit.error?.message ?? null}
            isCommitting={createCommit.isPending}
            isDiscardingChanges={checkoutCommit.isPending}
            isSettingDefault={setDefaultBranch.isPending}
            isDeletingBranch={deleteBranch.isPending}
            onClose={() => navigate("/")}
            onOpenWorkspace={(workspaceId) =>
              navigate(`/project/${project.id}/workspace/${workspaceId}`)
            }
            onSetDefaultBranch={(branch) => void handleSetDefaultBranch(branch)}
            onDeleteBranch={() =>
              selectedBranch ? void handleDeleteBranch(selectedBranch) : undefined
            }
            onOpenFork={openForkDialog}
            onSubmitCommit={(event) => void handleCommit(event)}
            onDiscardChanges={() => void handleDiscardChanges()}
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

      <CreateBranchDialog
        dialogRef={createBranchDialogRef}
        onClose={closeCreateBranchDialog}
        onSubmit={(event) => void handleCreateBranch(event)}
        mutationError={createBranchWithWorkspace.error?.message ?? null}
        isPending={createBranchWithWorkspace.isPending}
      />

      <ForkBranchDialog
        dialogRef={forkBranchDialogRef}
        onClose={closeForkDialog}
        onSubmit={(event) => void handleForkBranch(event)}
        mutationError={createBranchWithWorkspace.error?.message ?? null}
        isPending={createBranchWithWorkspace.isPending}
      />
    </>
  );
}

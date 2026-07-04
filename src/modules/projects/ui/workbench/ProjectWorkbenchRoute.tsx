import { ScopeProvider } from "bunshi/react";

import { AppShell } from "@/app/shell/AppShell";
import { FullPageMessage } from "@/shared/ui/FullPageMessage";
import { SidebarLayoutScope } from "@/shared/ui/sidebar";
import { ProjectWorkbenchMain } from "./components/ProjectWorkbenchMain";
import { ProjectWorkbenchSidebar } from "./components/ProjectWorkbenchSidebar";
import {
  ProjectWorkbenchBranchRouteScope,
  ProjectWorkbenchProjectScope,
} from "./core/projectWorkbenchScopes";
import { useProjectWorkbenchSync, useProjectWorkbenchViewModel } from "./core/useProjectWorkbench";
import { CreateBranchDialog } from "./dialogs/CreateBranchDialog";
import { ForkBranchDialog } from "./dialogs/ForkBranchDialog";

export function ProjectWorkbenchRoute({
  projectId,
  branchId = null,
}: {
  projectId: string;
  branchId?: string | null;
}) {
  return (
    <ScopeProvider scope={ProjectWorkbenchProjectScope} value={projectId}>
      <ScopeProvider scope={ProjectWorkbenchBranchRouteScope} value={branchId}>
        <ProjectWorkbenchRouteContent />
      </ScopeProvider>
    </ScopeProvider>
  );
}

function ProjectWorkbenchRouteContent() {
  useProjectWorkbenchSync();
  const model = useProjectWorkbenchViewModel();
  const project = model.project;

  return (
    <>
      <AppShell
        sidebar={
          project ? (
            <ScopeProvider scope={SidebarLayoutScope} value={`projects:${project.id}`}>
              <ProjectWorkbenchSidebar />
            </ScopeProvider>
          ) : undefined
        }
      >
        {model.projectInitialLoading ? (
          <FullPageMessage
            icon="icon-[material-symbols--sync] animate-spin"
            title="正在加载项目工作台"
            description="正在读取项目、分支和工作副本。"
            embedded
          />
        ) : model.projectErrorMessage ? (
          <FullPageMessage
            icon="icon-[material-symbols--folder-off]"
            title="未找到项目"
            description={model.projectErrorMessage}
            embedded
          />
        ) : project ? (
          <ProjectWorkbenchMain />
        ) : (
          <FullPageMessage
            icon="icon-[material-symbols--folder-off]"
            title="未找到项目"
            description="这个项目可能已被删除，或当前链接中的项目 ID 无效。"
            embedded
          />
        )}
      </AppShell>

      <CreateBranchDialog />
      <ForkBranchDialog />
    </>
  );
}

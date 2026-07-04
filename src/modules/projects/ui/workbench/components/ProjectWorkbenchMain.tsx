import { PageHeader, secondaryButton } from "../../shared/projectUi";
import {
  useProjectWorkbenchNavigation,
  useProjectWorkbenchViewModel,
} from "../core/useProjectWorkbench";
import { ProjectBranchDetailPanel } from "./ProjectBranchDetailPanel";

export function ProjectWorkbenchMain() {
  const model = useProjectWorkbenchViewModel();
  const { navigate } = useProjectWorkbenchNavigation();
  const project = model.project;
  if (!project) {
    return null;
  }

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <PageHeader
        icon="icon-[material-symbols--folder-open]"
        title={project.name}
        subtitle={
          model.selectedBranch ? `Branch · ${model.selectedBranch.name}` : "Branch Workspace"
        }
        trailing={
          <button type="button" onClick={() => navigate("/")} className={secondaryButton}>
            <span className="icon-[material-symbols--close] text-sm" />
            关闭项目
          </button>
        }
      />

      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <ProjectBranchDetailPanel />
      </div>
    </div>
  );
}

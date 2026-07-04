import { cn } from "@/shared/lib/cn";
import { LoadingBlock } from "@/shared/ui/Loading";

import type { ProjectList } from "../shared/projectTypes";
import { dateFormatter, PageHeader } from "../shared/projectUi";
import { useProjectListState } from "./state/projectListStore";

export function ProjectListView({
  projectList,
  lastProjectId,
  isLoading,
  isDeleting,
  renderError,
  onCreateProject,
  onOpenProject,
  onDeleteProject,
}: {
  projectList: ProjectList;
  lastProjectId: string | null;
  isLoading: boolean;
  isDeleting: boolean;
  renderError: React.ReactNode;
  onCreateProject: () => void;
  onOpenProject: (_projectId: string) => void;
  onDeleteProject: (_projectId: string, _projectName: string) => void;
}) {
  const deletingId = useProjectListState((state) => state.deletingProjectId);

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
              className="group flex min-h-36 flex-col items-center justify-center gap-2 rounded-md border border-border border-dashed bg-sidebar-background p-4 text-foreground-muted transition hover:border-accent-foreground hover:bg-list-hover-background hover:text-foreground"
            >
              <span className="icon-[material-symbols--add-circle-outline] text-3xl text-accent-foreground transition group-hover:scale-105" />
              <span className="font-medium text-sm">新建项目</span>
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
                        <span className="rounded px-1.5 py-0.5 font-medium text-[10px] text-accent-foreground">
                          上次查看
                        </span>
                      ) : null}
                    </div>
                    <span className="line-clamp-2 font-medium text-foreground text-sm">
                      {project.name}
                    </span>
                    <p className="line-clamp-2 flex-1 text-foreground-muted text-xs leading-relaxed">
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
                    className="absolute top-2 right-2 rounded p-1 text-foreground-muted opacity-0 transition hover:bg-button-hover-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30 group-hover:opacity-100"
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

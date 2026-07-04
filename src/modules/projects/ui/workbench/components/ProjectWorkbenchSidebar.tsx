import { AppSidebar } from "@/app/shell/AppShell";
import { IconButton } from "@/shared/ui/IconButton";
import { LoadingBlock } from "@/shared/ui/Loading";
import { OverlayScrollbar } from "@/shared/ui/OverlayScrollbar";
import { SidebarPanels } from "@/shared/ui/sidebar";
import { SidebarListRow } from "@/shared/ui/tree";

import type { BranchList, BranchRow, ProjectRow } from "../../shared/projectTypes";
import { dateFormatter, formatCommitId, InlineError } from "../../shared/projectUi";
import {
  useProjectWorkbenchNavigation,
  useProjectWorkbenchViewModel,
} from "../core/useProjectWorkbench";
import { useCreateBranchDialogControls } from "../features/useCreateBranchFeature";
import { useProjectMetadataFeature } from "../features/useProjectMetadataFeature";
import { useProjectMetadataDraft } from "../state/projectWorkbenchStore";

export function ProjectWorkbenchSidebar() {
  const model = useProjectWorkbenchViewModel();
  const { navigateToBranch } = useProjectWorkbenchNavigation();
  const createBranchDialog = useCreateBranchDialogControls();
  const project = model.project;
  if (!project) {
    return null;
  }

  return (
    <AppSidebar>
      <div className="border-border border-b px-3 py-3">
        <div className="font-semibold text-[11px] text-foreground-muted uppercase tracking-wider">
          项目工作台
        </div>
        <div className="mt-1 truncate font-medium text-foreground text-sm">{project.name}</div>
      </div>

      <SidebarPanels
        panels={[
          {
            title: `Branches · ${model.sortedBranches.length}`,
            actions: (
              <IconButton
                icon="icon-[material-symbols--add]"
                title="新建分支"
                onClick={createBranchDialog.openDialog}
              />
            ),
            content: (
              <ProjectBranchListPanel
                project={project}
                branches={model.sortedBranches}
                branchHeadCommitIdById={model.branchHeadCommitIdById}
                branchesLoading={model.branchesLoading}
                branchesError={model.branchesErrorMessage}
                selectedBranch={model.selectedBranch}
                onSelectBranch={navigateToBranch}
              />
            ),
          },
          {
            title: "Project Meta",
            content: (
              <ProjectMetaPanel project={project} branchCount={model.sortedBranches.length} />
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
  branchHeadCommitIdById,
  branchesLoading,
  branchesError,
  selectedBranch,
  onSelectBranch,
}: {
  project: ProjectRow;
  branches: BranchList;
  branchHeadCommitIdById: ReadonlyMap<string, string | null>;
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
        <div className="rounded-md border border-border border-dashed bg-editor-background px-4 py-8 text-foreground-muted text-sm">
          当前项目还没有 branch，先创建一个分支开始工作。
        </div>
      </div>
    );
  }

  return (
    <div className="py-1">
      {branches.map((branch) => (
        <SidebarListRow
          key={branch.name}
          isActive={branch.name === selectedBranch?.name}
          onClick={() => onSelectBranch(branch.name)}
          icon={
            <span className="icon-[material-symbols--fork-right] text-base text-foreground-muted" />
          }
          label={
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate">{branch.name}</span>
              {project.defaultBranchName === branch.name ? (
                <span className="rounded px-1.5 py-0.5 font-medium text-[10px] text-accent-foreground">
                  默认
                </span>
              ) : null}
            </div>
          }
          trailing={
            branchHeadCommitIdById.get(branch.name)
              ? formatCommitId(branchHeadCommitIdById.get(branch.name)!)
              : "空分支"
          }
        />
      ))}
    </div>
  );
}

function ProjectMetaPanel({ project, branchCount }: { project: ProjectRow; branchCount: number }) {
  const { detailName, detailDescription, detailError, setDetailName, setDetailDescription } =
    useProjectMetadataDraft();
  const metadata = useProjectMetadataFeature();

  return (
    <OverlayScrollbar className="h-full min-h-0 w-full">
      <div className="space-y-4 p-3">
        <label className="grid gap-1.5">
          <span className="font-medium text-foreground-muted text-xs">项目名</span>
          <input
            value={detailName}
            disabled={metadata.isPending}
            onChange={(event) => setDetailName(event.target.value)}
            onBlur={() => void metadata.commit()}
            className="w-full rounded-md border border-border bg-editor-background px-3 py-2 text-foreground text-sm outline-none transition focus:border-accent-foreground disabled:cursor-wait disabled:opacity-70"
          />
        </label>

        <label className="grid gap-1.5">
          <span className="font-medium text-foreground-muted text-xs">描述</span>
          <textarea
            value={detailDescription}
            disabled={metadata.isPending}
            rows={5}
            onChange={(event) => setDetailDescription(event.target.value)}
            onBlur={() => void metadata.commit()}
            className="field-sizing-content w-full resize-none rounded-md border border-border bg-editor-background px-3 py-2 text-foreground text-sm leading-relaxed outline-none transition focus:border-accent-foreground disabled:cursor-wait disabled:opacity-70"
            placeholder="为这个项目补充背景、目标或当前进度。"
          />
        </label>

        {detailError || metadata.errorMessage ? (
          <InlineError message={detailError ?? metadata.errorMessage ?? ""} />
        ) : null}

        <div className="rounded-md border border-border bg-editor-background p-3">
          <div className="text-[11px] text-foreground-muted/70 uppercase tracking-wide">Stats</div>
          <div className="mt-2 space-y-2 text-foreground text-sm">
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

import { cn } from "@/shared/lib/cn";
import { LoadingBlock } from "@/shared/ui/Loading";

import type { CommitHistory, CommitRow, WorkingTreeStatus } from "../../shared/projectTypes";
import {
  dateFormatter,
  formatDateTimePreferredRelative,
  InlineError,
} from "../../shared/projectUi";
import type { ProjectHistorySelection } from "../state/projectWorkbenchStore";

/**
 * 统一历史时间线（仿 GitHub Desktop / Fork）：顶部一个「未提交更改」伪节点，
 * 其下是当前分支的 commit 列表，所有节点共用一条竖直 rail，并以选中态驱动右侧详情。
 *
 * 简化版说明：
 * - 当前仅绘制单泳道 rail。多分支拓扑连线（fork/merge 的多泳道图谱）留待后续实现。
 */
export function ProjectHistoryTimeline({
  commitHistory,
  commitHistoryLoading,
  commitHistoryError,
  selectedBranchHeadCommitId,
  workingTreeStatus,
  workspaceMissing,
  selection,
  onSelect,
}: {
  commitHistory: CommitHistory;
  commitHistoryLoading: boolean;
  commitHistoryError: string | null;
  selectedBranchHeadCommitId: string | null;
  workingTreeStatus: WorkingTreeStatus | null;
  workspaceMissing: boolean;
  selection: ProjectHistorySelection;
  onSelect: (_selection: ProjectHistorySelection) => void;
}) {
  return (
    <section className="flex min-h-0 flex-col">
      <div className="flex h-7 shrink-0 items-center gap-1 px-3 text-[11px] font-semibold tracking-wider text-foreground-muted uppercase">
        <span className="icon-[material-symbols--history] text-base text-accent-foreground" />
        <h3>历史</h3>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* 顶部伪节点：未提交的更改。仅在分支存在 workspace 时可作为工作区入口。 */}
        {!workspaceMissing ? (
          <WorkingChangesRow
            workingTreeStatus={workingTreeStatus}
            isActive={selection.kind === "working"}
            onClick={() => onSelect({ kind: "working" })}
          />
        ) : null}

        {commitHistoryError ? (
          <div className="px-3 pb-3">
            <InlineError message={commitHistoryError} />
          </div>
        ) : commitHistoryLoading ? (
          <div className="px-3 pb-3">
            <LoadingBlock label="正在加载提交历史..." />
          </div>
        ) : (
          <div>
            {commitHistory.map((commit, index) => (
              <CommitRowItem
                key={commit.id}
                commit={commit}
                isHead={commit.id === selectedBranchHeadCommitId}
                isFirst={workspaceMissing && index === 0}
                isLast={index === commitHistory.length - 1}
                isActive={selection.kind === "commit" && selection.commitId === commit.id}
                onClick={() => onSelect({ kind: "commit", commitId: commit.id })}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function summarizeChangeCount(status: WorkingTreeStatus | null) {
  if (!status) {
    return 0;
  }
  return (
    status.areas.content.changes.length +
    status.areas.timeline.changes.length +
    status.areas.aux.changes.length
  );
}

/** 时间线左侧的 rail（竖线 + 节点圆点）。isFirst/isLast 控制竖线在端点处是否延伸。 */
function TimelineRail({
  isFirst,
  isLast,
  active,
  variant,
}: {
  isFirst: boolean;
  isLast: boolean;
  active: boolean;
  variant: "working" | "commit" | "head";
}) {
  return (
    <div className="relative flex w-5 shrink-0 justify-center self-stretch">
      <span
        className={cn(
          "absolute top-0 w-px bg-border",
          isFirst ? "h-1/2 translate-y-full" : isLast ? "bottom-1/2 h-1/2" : "h-full",
        )}
      />
      <span
        className={cn(
          "relative top-2.5 h-2.5 w-2.5 rounded-full border-2",
          variant === "working"
            ? "border-dashed border-accent-foreground bg-editor-background"
            : variant === "head"
              ? "border-accent-foreground bg-accent-foreground"
              : "border-foreground-muted bg-editor-background",
          active ? "ring-2 ring-accent-foreground/40" : null,
        )}
      />
    </div>
  );
}

function WorkingChangesRow({
  workingTreeStatus,
  isActive,
  onClick,
}: {
  workingTreeStatus: WorkingTreeStatus | null;
  isActive: boolean;
  onClick: () => void;
}) {
  const count = summarizeChangeCount(workingTreeStatus);
  const hasChanges = workingTreeStatus?.hasChanges === true;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-stretch gap-1.5 px-3 text-left transition",
        isActive ? "bg-list-active-background" : "hover:bg-list-hover-background",
      )}
    >
      <TimelineRail isFirst isLast={false} active={isActive} variant="working" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-2">
        <div className="flex min-w-0 items-center gap-1.5 leading-none">
          <span className="truncate text-[13px] font-medium text-foreground">未提交的更改</span>
          {hasChanges ? (
            <span className="rounded bg-accent-background px-1.5 py-0.5 text-[10px] font-medium text-foreground">
              {count}
            </span>
          ) : null}
        </div>
        <div className="text-[10px] leading-none text-foreground-muted">
          {hasChanges ? "工作区有未提交修改" : "工作区与 HEAD 一致"}
        </div>
      </div>
    </button>
  );
}

function CommitRowItem({
  commit,
  isHead,
  isFirst,
  isLast,
  isActive,
  onClick,
}: {
  commit: CommitRow;
  isHead: boolean;
  isFirst: boolean;
  isLast: boolean;
  isActive: boolean;
  onClick: () => void;
}) {
  const isMerge = commit.parents.length > 1;
  const commitSubject = commit.message.split(/\r?\n/, 1)[0] ?? "";
  const committedAtLabel = formatDateTimePreferredRelative(commit.committedAt);
  const committedAtTitle = dateFormatter.format(commit.committedAt);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-stretch gap-1.5 px-3 text-left transition",
        isActive ? "bg-list-active-background" : "hover:bg-list-hover-background",
      )}
    >
      <TimelineRail
        isFirst={isFirst}
        isLast={isLast}
        active={isActive}
        variant={isHead ? "head" : "commit"}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[13px] leading-4.5 text-foreground">{commitSubject}</span>
          {isHead ? (
            <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-accent-foreground">
              HEAD
            </span>
          ) : null}
          {isMerge ? (
            <span className="icon-[material-symbols--merge] shrink-0 text-sm text-foreground-muted" />
          ) : null}
        </div>
        <div className="min-w-0 text-[10px] leading-4 text-foreground-muted">
          <span title={committedAtTitle}>{committedAtLabel}</span>
        </div>
      </div>
    </button>
  );
}

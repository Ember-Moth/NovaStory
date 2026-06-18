import { RowActionButton } from "@/shared/ui/tree";

import type { CommitHistory, CommitRow } from "./projectTypes";
import { dateFormatter, formatCommitId, InlineError } from "./projectUi";
import { LoadingBlock } from "@/shared/ui/Loading";

export function CommitHistorySection({
  commitHistory,
  commitHistoryLoading,
  commitHistoryError,
  selectedBranchHeadCommitId,
  onOpenFork,
}: {
  commitHistory: CommitHistory;
  commitHistoryLoading: boolean;
  commitHistoryError: string | null;
  selectedBranchHeadCommitId: string | null;
  onOpenFork: (_commit: CommitRow) => void;
}) {
  return (
    <section>
      <div className="flex h-7 items-center gap-1 px-3 text-[11px] font-semibold tracking-wider text-foreground-muted uppercase">
        <span className="icon-[material-symbols--history] text-base text-accent-foreground" />
        <h3>提交历史</h3>
      </div>

      <div className="mt-1">
        {commitHistoryError ? (
          <div className="px-3 pb-3">
            <InlineError message={commitHistoryError} />
          </div>
        ) : commitHistoryLoading ? (
          <div className="px-3 pb-3">
            <LoadingBlock label="正在加载提交历史..." />
          </div>
        ) : commitHistory.length === 0 ? (
          <div className="mx-3 mb-3 rounded-md border border-dashed border-border bg-editor-background px-3 py-6 text-sm text-foreground-muted">
            这个分支还没有提交历史。
          </div>
        ) : (
          <div>
            {commitHistory.map((commit) => (
              <CommitHistoryRow
                key={commit.id}
                commit={commit}
                isHead={commit.id === selectedBranchHeadCommitId}
                onFork={() => onOpenFork(commit)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function CommitHistoryRow({
  commit,
  isHead,
  onFork,
}: {
  commit: CommitRow;
  isHead: boolean;
  onFork: () => void;
}) {
  return (
    <div className="group flex w-full items-start gap-1.5 px-3 py-1 text-[13px] text-foreground transition hover:bg-list-hover-background">
      <span className="mt-0.5 icon-[material-symbols--commit] shrink-0 text-base text-foreground-muted" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-1 leading-none">
          <span className="truncate">{commit.message}</span>
          {isHead ? (
            <span className="rounded px-1.5 py-0.5 text-[10px] font-medium text-accent-foreground">
              HEAD
            </span>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] leading-none text-foreground-muted">
          <span className="break-all">{formatCommitId(commit.id)}</span>
          <span className="shrink-0">{dateFormatter.format(commit.committedAt)}</span>
        </div>
      </div>
      <div className="grid h-5 shrink-0 items-center self-center">
        <div className="pointer-events-none col-start-1 row-start-1 flex items-center justify-end opacity-0 transition group-hover:pointer-events-auto group-hover:opacity-100">
          <RowActionButton
            icon="icon-[material-symbols--fork-right]"
            title="Fork"
            onClick={onFork}
          />
        </div>
      </div>
    </div>
  );
}

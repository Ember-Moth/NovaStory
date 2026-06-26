import { skipToken } from "@codehz/rpc/react";

import { rpc } from "@/rpc/client";
import { LoadingBlock } from "@/shared/ui/Loading";

import { useProjectWorkbenchProjectId } from "../core/useProjectWorkbench";
import type { CommitRow } from "../../shared/projectTypes";
import {
  dateFormatter,
  formatCommitId,
  InlineError,
  secondaryButton,
} from "../../shared/projectUi";
import { ChangeAreasView } from "./ChangeAreasView";

/**
 * 选中某个 commit 时展示的详情面板（仿专业版本控制软件的 commit inspector）：
 * 元信息（message / 作者 / 时间 / hash / 父提交）+ 操作入口 + 改动文件与差异。
 *
 * 简化版说明：
 * - 「改动文件清单 / 内容 diff」通过「commits.diff」RPC 取得：对比该 commit 与其首个父提交
 *   （根提交则与空树对比），复用与「未提交变更」一致的语义化呈现（见 DiffSection）。
 * - 「Reset 到此提交 / Merge」同样留待后续实现，目前仅暴露 Fork 入口。
 */
export function ProjectCommitDetailPanel({
  commitId,
  selectedBranchHeadCommitId,
  onOpenFork,
}: {
  commitId: string;
  selectedBranchHeadCommitId: string | null;
  onOpenFork: (_commit: CommitRow) => void;
}) {
  const projectId = useProjectWorkbenchProjectId();
  const commitQuery = rpc.useQuery("commits.get", commitId ? { projectId, commitId } : skipToken);
  const commit = commitQuery.data ?? null;
  const isHead = commit?.id === selectedBranchHeadCommitId;

  if (commitQuery.error) {
    return <InlineError message={commitQuery.error.message} />;
  }

  if (!commit) {
    return <LoadingBlock label="正在加载提交..." />;
  }

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div>
        <div className="flex items-start gap-2">
          <span className="mt-0.5 icon-[material-symbols--commit] shrink-0 text-base text-accent-foreground" />
          <h3 className="min-w-0 text-sm leading-snug font-semibold wrap-break-word text-foreground">
            {commit.message}
          </h3>
          {isHead ? (
            <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-accent-foreground">
              HEAD
            </span>
          ) : null}
        </div>
      </div>

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
        <MetaRow label="提交">
          <span className="font-mono break-all">{formatCommitId(commit.id)}</span>
        </MetaRow>
        <MetaRow label="作者">{commit.author ?? "—"}</MetaRow>
        <MetaRow label="时间">{dateFormatter.format(commit.committedAt)}</MetaRow>
        <MetaRow label="父提交">
          {commit.parents.length === 0 ? (
            <span className="text-foreground-muted">根提交（无父）</span>
          ) : (
            <div className="flex flex-col gap-1">
              {commit.parents.map((parent) => (
                <div key={parent.parentId} className="flex items-center gap-1.5">
                  <span className="font-mono break-all">{formatCommitId(parent.parentId)}</span>
                  {parent.mergeRole !== "normal" ? (
                    <span className="rounded bg-sidebar-background px-1 py-0.5 text-[9px] text-foreground-muted">
                      {parent.mergeRole === "mainline" ? "主线" : "并入"}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </MetaRow>
      </dl>

      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => onOpenFork(commit)} className={secondaryButton}>
          <span className="icon-[material-symbols--fork-right] text-base" />
          从这里 Fork
        </button>
        {/* TODO: Reset 到此提交 / Merge 入口待后端能力补齐后接入。 */}
      </div>

      <DiffSection commitId={commit.id} />
    </div>
  );
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-foreground-muted">{label}</dt>
      <dd className="min-w-0 text-foreground">{children}</dd>
    </>
  );
}

/**
 * 单个 commit 的改动文件清单 / 内容 diff（对比该 commit 与其首个父提交）。
 */
function DiffSection({ commitId }: { commitId: string }) {
  const projectId = useProjectWorkbenchProjectId();
  const diffQuery = rpc.useQuery("commits.diff", commitId ? { projectId, commitId } : skipToken);
  const diff = diffQuery.data ?? null;

  return (
    <div className="bg-editor-background">
      <div className="flex items-center gap-1">
        <span className="icon-[material-symbols--difference] text-base text-accent-foreground" />
        <h4 className="text-xs font-medium text-foreground-muted">
          {diff?.isRoot ? "本次改动（根提交）" : "本次改动"}
        </h4>
      </div>

      <div className="mt-2">
        {diffQuery.error ? (
          <InlineError message={diffQuery.error.message} />
        ) : diff == null ? (
          <LoadingBlock label="正在计算差异..." />
        ) : !diff.hasChanges ? (
          <p className="text-sm text-foreground-muted">该提交相对父提交无内容变更。</p>
        ) : (
          <ChangeAreasView areas={diff.areas} />
        )}
      </div>
    </div>
  );
}

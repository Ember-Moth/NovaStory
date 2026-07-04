import { skipToken } from "@codehz/rpc/react";

import { rpc } from "@/rpc/client";
import { cn } from "@/shared/lib/cn";
import { LoadingBlock } from "@/shared/ui/Loading";
import type { CommitRow } from "../../shared/projectTypes";
import {
  dateFormatter,
  formatCommitId,
  formatDateTimePreferredRelative,
  InlineError,
} from "../../shared/projectUi";
import { useProjectWorkbenchProjectId } from "../core/useProjectWorkbench";
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

  const { subject, body } = splitCommitMessage(commit.message);
  const isMerge = commit.parents.length > 1;
  const committedAtLabel = formatDateTimePreferredRelative(commit.committedAt);

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <section className="-mx-4 space-y-3 border-border border-b px-4 pb-4">
        <div className="flex min-w-0 flex-wrap items-start gap-x-2 gap-y-1">
          <div className="flex min-w-0 flex-1 items-start gap-2">
            <span className="icon-[material-symbols--commit] mt-1 shrink-0 text-accent-foreground text-base" />
            <h3 className="wrap-break-word min-w-0 flex-1 whitespace-pre-wrap font-semibold text-base text-foreground leading-6">
              {subject}
            </h3>
          </div>
          {isHead ? (
            <span className="shrink-0 font-medium text-[10px] text-accent-foreground uppercase tracking-wide">
              HEAD
            </span>
          ) : null}
          {isMerge ? (
            <span className="shrink-0 font-medium text-[10px] text-foreground-muted uppercase tracking-wide">
              Merge
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-foreground-muted">
          <span>{committedAtLabel}</span>
          <span className="font-mono">{formatCommitId(commit.id)}</span>
        </div>

        {body ? (
          <pre
            className={cn(
              "wrap-break-word whitespace-pre-wrap font-sans text-foreground text-sm leading-6",
            )}
          >
            {body}
          </pre>
        ) : null}
      </section>

      <section>
        <div className="mb-3 flex items-center gap-1 font-semibold text-[11px] text-foreground-muted uppercase tracking-wider">
          <span className="icon-[material-symbols--info-outline] text-accent-foreground text-sm" />
          <h4>元信息</h4>
        </div>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <MetaRow label="提交">
            <span className="break-all font-mono">{formatCommitId(commit.id)}</span>
          </MetaRow>
          <MetaRow label="作者">{commit.author ?? "—"}</MetaRow>
          <MetaRow label="时间">
            <div className="space-y-1">
              <div>{dateFormatter.format(commit.committedAt)}</div>
              <div className="text-[11px] text-foreground-muted">{committedAtLabel}</div>
            </div>
          </MetaRow>
          <MetaRow label="父提交" className="sm:col-span-2">
            {commit.parents.length === 0 ? (
              <span className="text-foreground-muted">根提交（无父）</span>
            ) : (
              <div className="flex flex-col gap-2">
                {commit.parents.map((parent) => (
                  <div key={parent.parentId} className="flex flex-wrap items-center gap-1.5">
                    <span className="break-all font-mono">{formatCommitId(parent.parentId)}</span>
                    {parent.mergeRole !== "normal" ? (
                      <span className="text-[10px] text-foreground-muted">
                        {parent.mergeRole === "mainline" ? "主线" : "并入"}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </MetaRow>
        </dl>
      </section>

      <div>
        <button
          type="button"
          onClick={() => onOpenFork(commit)}
          className="inline-flex items-center gap-1 text-foreground-muted text-xs transition hover:text-foreground disabled:opacity-50"
        >
          <span className="icon-[material-symbols--fork-right] text-sm" />
          从这里 Fork
        </button>
        {/* TODO: Reset 到此提交 / Merge 入口待后端能力补齐后接入。 */}
      </div>

      <DiffSection commitId={commit.id} />
    </div>
  );
}

function MetaRow({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="mb-1 font-medium text-[11px] text-foreground-muted">{label}</dt>
      <dd className="min-w-0 text-foreground text-sm">{children}</dd>
    </div>
  );
}

function splitCommitMessage(message: string) {
  const normalized = message.replace(/\r\n/g, "\n");
  const [subjectLine = "", ...restLines] = normalized.split("\n");
  const subject = subjectLine.trim() || "无提交说明";
  const body = restLines.join("\n").replace(/^\n+|\n+$/g, "");

  return {
    subject,
    body,
  };
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
        <span className="icon-[material-symbols--difference] text-accent-foreground text-base" />
        <h4 className="font-medium text-foreground-muted text-xs">
          {diff?.isRoot ? "本次改动（根提交）" : "本次改动"}
        </h4>
      </div>

      <div className="mt-2">
        {diffQuery.error ? (
          <InlineError message={diffQuery.error.message} />
        ) : diff == null ? (
          <LoadingBlock label="正在计算差异..." />
        ) : !diff.hasChanges ? (
          <p className="text-foreground-muted text-sm">该提交相对父提交无内容变更。</p>
        ) : (
          <ChangeAreasView areas={diff.areas} />
        )}
      </div>
    </div>
  );
}

import { AnimatePresence, motion } from "motion/react";

function formatDuration(durationMs: number) {
  if (durationMs < 1000) {
    return `${Math.max(0, Math.round(durationMs))}ms`;
  }
  if (durationMs < 10_000) {
    return `${(durationMs / 1000).toFixed(1)}s`;
  }
  return `${Math.round(durationMs / 1000)}s`;
}

export function RunSummaryRow({
  status,
  stepCount,
  totalTokens,
  durationMs,
  errorMessage,
  canRetry,
  isRetrying,
  onRetry,
  needsContinuation,
  isContinuing,
  onContinue,
  continuedByRunId,
  expanded,
  onToggle,
}: {
  status: "queued" | "running" | "waiting_for_input" | "succeeded" | "failed" | "cancelled";
  stepCount: number;
  totalTokens: number | null;
  durationMs: number | null;
  errorMessage: string | null;
  canRetry?: boolean;
  isRetrying?: boolean;
  onRetry?: () => void;
  needsContinuation?: boolean;
  isContinuing?: boolean;
  onContinue?: () => void;
  continuedByRunId?: string | null;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const isRunning = status === "running" || status === "queued";
  const isWaitingForInput = status === "waiting_for_input";
  const isFailed = status === "failed";
  const isContinuationPaused = needsContinuation === true;
  const canExpand = isFailed && typeof errorMessage === "string" && errorMessage.trim().length > 0;
  const toneClassName = isContinuationPaused
    ? "border-accent-foreground/30 bg-accent-foreground/5 text-accent-foreground"
    : isFailed
      ? "border-accent-foreground/30 bg-accent-foreground/5 text-accent-foreground"
      : "border-border bg-editor-background text-foreground-muted";
  const statusIcon = isRunning
    ? "icon-[material-symbols--progress-activity] animate-spin text-accent-foreground"
    : isWaitingForInput
      ? "icon-[material-symbols--help]"
      : isContinuationPaused
        ? "icon-[material-symbols--pause-circle]"
        : isFailed
          ? "icon-[material-symbols--warning]"
          : status === "cancelled"
            ? "icon-[material-symbols--block]"
            : "icon-[material-symbols--check-circle]";
  const label = isRunning
    ? "正在生成回复..."
    : isWaitingForInput
      ? "等待回答"
      : isContinuationPaused
        ? "已到轮次上限"
        : isFailed
          ? "生成失败"
          : status === "cancelled"
            ? "已取消"
            : continuedByRunId
              ? "已继续"
              : "生成完成";
  const metrics = [
    durationMs != null ? formatDuration(durationMs) : null,
    stepCount > 0 ? `${stepCount} 步` : null,
    totalTokens != null ? `${totalTokens.toLocaleString("zh-CN")} tokens` : null,
  ].filter(Boolean);

  return (
    <div className={`overflow-hidden rounded-md border ${toneClassName}`}>
      <div className="flex min-h-8 items-center gap-2 px-2 py-1 text-[11px] leading-4">
        {canExpand ? (
          <button
            type="button"
            onClick={onToggle}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <span className={`shrink-0 text-[14px] ${statusIcon}`} />
            <span className="min-w-0 shrink-0">{label}</span>
            <span className="min-w-0 flex-1 truncate opacity-80">
              {metrics.length > 0 ? metrics.join(" / ") : "统计信息暂不可用"}
            </span>
            <span
              className={`shrink-0 text-[14px] ${
                expanded
                  ? "icon-[material-symbols--keyboard-arrow-up]"
                  : "icon-[material-symbols--keyboard-arrow-down]"
              }`}
            />
          </button>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className={`shrink-0 text-[14px] ${statusIcon}`} />
            <span className="min-w-0 shrink-0">{label}</span>
            <span className="min-w-0 flex-1 truncate opacity-80">
              {metrics.length > 0 ? metrics.join(" / ") : "统计信息暂不可用"}
            </span>
          </div>
        )}
        {canRetry && onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            disabled={isRetrying}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded text-[14px] transition hover:bg-current/10 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={isRetrying ? "重试中" : "重试"}
            title={isRetrying ? "重试中" : "重试"}
          >
            <span
              className={
                isRetrying
                  ? "icon-[material-symbols--progress-activity] animate-spin"
                  : "icon-[material-symbols--refresh]"
              }
            />
          </button>
        ) : null}
        {needsContinuation && onContinue ? (
          <button
            type="button"
            onClick={onContinue}
            disabled={isContinuing}
            className="inline-flex h-6 shrink-0 items-center gap-1 rounded px-1.5 text-[11px] transition hover:bg-current/10 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={isContinuing ? "继续中" : "继续"}
            title={isContinuing ? "继续中" : "继续"}
          >
            <span
              className={
                isContinuing
                  ? "icon-[material-symbols--progress-activity] animate-spin"
                  : "icon-[material-symbols--play-arrow]"
              }
            />
            <span>继续</span>
          </button>
        ) : null}
      </div>
      <AnimatePresence initial={false}>
        {canExpand && expanded ? (
          <motion.div
            className="border-t border-current/10 px-2 py-1.5 text-[10px] leading-4 break-all whitespace-pre-wrap"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
          >
            {errorMessage}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

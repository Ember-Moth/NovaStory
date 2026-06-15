import { AnimatePresence, motion } from "motion/react";

import type { AssistantToolTraceEntry } from "./toolTraceModel";

function formatToolTracePayload(payload: unknown) {
  if (typeof payload === "string") {
    return payload;
  }
  if (payload == null) {
    return "null";
  }

  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

function ToolTracePayload({ label, payload }: { label: string; payload: unknown }) {
  return (
    <div className="space-y-1 pb-1 last:pb-0">
      <div className="text-[10px] font-medium tracking-[0.08em] opacity-70">{label}</div>
      <pre className="overflow-x-auto rounded bg-sidebar-background/70 px-2 py-1 text-[10px] leading-4 break-all whitespace-pre-wrap text-foreground">
        {formatToolTracePayload(payload)}
      </pre>
    </div>
  );
}

export function ToolTraceCard({
  entry,
  expanded,
  onToggle,
}: {
  entry: AssistantToolTraceEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const hasDetails = entry.requestPayload != null || entry.responsePayload != null;
  const statusLabel =
    entry.status === "error" ? "失败" : entry.status === "success" ? "已返回" : "处理中";
  const toneClassName =
    entry.status === "error"
      ? "border-accent-foreground/30 bg-accent-foreground/5 text-accent-foreground"
      : "border-border bg-editor-background text-foreground-muted";

  return (
    <div className={`overflow-hidden rounded-md border ${toneClassName}`}>
      <button
        type="button"
        disabled={!hasDetails}
        onClick={hasDetails ? onToggle : undefined}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] leading-4 disabled:cursor-default"
      >
        <span className="icon-[material-symbols--build-outline] shrink-0 text-[13px]" />
        <span className="min-w-0 flex-1 truncate">{entry.summary}</span>
        <span className="shrink-0 text-[10px] tracking-[0.08em] uppercase opacity-70">
          {statusLabel}
        </span>
        {hasDetails ? (
          <span
            className={`shrink-0 text-[14px] ${
              expanded
                ? "icon-[material-symbols--keyboard-arrow-up]"
                : "icon-[material-symbols--keyboard-arrow-down]"
            }`}
          />
        ) : null}
      </button>

      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            className="border-t border-current/10 px-2 py-1.5 text-[10px] leading-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
          >
            {entry.requestPayload != null ? (
              <ToolTracePayload label="请求" payload={entry.requestPayload} />
            ) : null}
            {entry.responsePayload != null ? (
              <ToolTracePayload label="响应" payload={entry.responsePayload} />
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

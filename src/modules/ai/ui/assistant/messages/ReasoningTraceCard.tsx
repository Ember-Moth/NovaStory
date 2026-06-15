import { AnimatePresence, motion } from "motion/react";

import { AiMarkdown } from "../AiMarkdown";

export function ReasoningTraceCard({
  reasoningText,
  isStreaming,
  expanded,
  onToggle,
}: {
  reasoningText: string;
  isStreaming: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-border bg-editor-background text-foreground-muted">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] leading-4"
      >
        <span className="icon-[material-symbols--psychology-alt-outline] shrink-0 text-[13px]" />
        <span className="min-w-0 flex-1 truncate">思考过程</span>
        <span
          className={`shrink-0 text-[14px] ${
            expanded
              ? "icon-[material-symbols--keyboard-arrow-up]"
              : "icon-[material-symbols--keyboard-arrow-down]"
          }`}
        />
      </button>

      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            className="border-t border-current/10 px-2 py-1.5"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: "easeOut" }}
          >
            <AiMarkdown content={reasoningText} isStreaming={isStreaming} variant="reasoning" />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

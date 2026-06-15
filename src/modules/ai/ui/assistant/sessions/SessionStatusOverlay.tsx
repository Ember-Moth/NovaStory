import { motion } from "motion/react";

export function SessionStatusOverlay({ state }: { state: "loading" | "empty" }) {
  const content =
    state === "loading" ? (
      <div className="px-3 py-1.5 text-[12px] text-foreground-muted">正在加载会话...</div>
    ) : (
      <div className="rounded-md border border-dashed border-border bg-editor-background/95 px-3 py-2 text-[12px] text-foreground-muted backdrop-blur-sm">
        还没有可用会话。点击右上角新建会话开始。
      </div>
    );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
      className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-3"
    >
      {content}
    </motion.div>
  );
}

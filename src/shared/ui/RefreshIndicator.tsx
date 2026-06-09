import { cn } from "@/shared/lib/cn";

export function RefreshIndicator({
  label = "同步中...",
  size = "xs",
  className,
}: {
  label?: string;
  size?: "xs" | "sm";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border border-border bg-sidebar-background/92 font-medium text-foreground-muted shadow-sm backdrop-blur-sm",
        size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-2 py-1 text-[11px]",
        className,
      )}
    >
      <span
        className={cn(
          "icon-[material-symbols--sync] animate-spin text-accent-foreground motion-reduce:animate-none",
          size === "sm" ? "text-sm" : "text-xs",
        )}
      />
      {label}
    </span>
  );
}

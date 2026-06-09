export function RefreshOverlay({
  active,
  label = "刷新中...",
  className = "",
}: {
  active: boolean;
  label?: string;
  className?: string;
}) {
  return (
    <div
      aria-hidden={!active}
      className={`pointer-events-none absolute top-2 right-2 z-10 transition-[opacity,translate] duration-150 ease-out motion-reduce:transition-none ${
        active
          ? "translate-y-0 opacity-100 delay-200"
          : "-translate-y-1 opacity-0 delay-0 duration-100"
      } ${className}`.trim()}
    >
      <div className="border-border bg-sidebar-background/92 text-foreground-muted inline-flex items-center gap-1 rounded-sm border px-2 py-1 text-[11px] shadow-sm backdrop-blur-sm">
        <span className="icon-[material-symbols--sync] animate-spin text-xs motion-reduce:animate-none" />
        {label}
      </div>
    </div>
  );
}

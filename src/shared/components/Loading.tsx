export function LoadingBlock({ label = "加载中..." }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 rounded-md border border-dashed border-border px-4 py-10 text-sm text-foreground-muted">
      <span className="icon-[material-symbols--sync] animate-spin text-base" />
      {label}
    </div>
  );
}

export function LoadingInline({
  label = "加载中...",
  size = "sm",
}: {
  label?: string;
  size?: "sm" | "xs";
}) {
  return (
    <div
      className={`flex items-center gap-1.5 text-foreground-muted ${
        size === "xs" ? "text-[10px]" : "text-sm py-4"
      }`}
    >
      <span
        className={`icon-[material-symbols--sync] animate-spin ${
          size === "xs" ? "text-[10px]" : "text-base"
        }`}
      />
      {label}
    </div>
  );
}

import { RefreshIndicator } from "@/shared/ui/RefreshIndicator";

export function RefreshOverlay({
  active,
  label = "同步中...",
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
      <RefreshIndicator label={label} size="xs" />
    </div>
  );
}

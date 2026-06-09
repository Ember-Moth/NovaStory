import { RefreshIndicator } from "@/shared/ui/RefreshIndicator";

export function PanelPlaceholder({
  icon,
  label,
  variant = "default",
}: {
  icon?: string;
  label: string;
  variant?: "default" | "refresh";
}) {
  if (variant === "refresh") {
    return (
      <div className="p-3">
        <RefreshIndicator label={label} size="sm" />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 p-3 text-sm text-foreground-muted">
      {icon ? <span className={`${icon} shrink-0 text-base`} /> : null}
      <span>{label}</span>
    </div>
  );
}

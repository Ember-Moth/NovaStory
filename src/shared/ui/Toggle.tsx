import { cn } from "@/shared/lib/cn";

export function Toggle({
  checked,
  onChange,
  disabled,
  label,
  description,
}: {
  checked: boolean;
  onChange: (_checked: boolean) => void;
  disabled?: boolean;
  label: string;
  description?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "group inline-flex items-start gap-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50",
      )}
    >
      <span
        className={cn(
          "relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
          checked ? "bg-accent-background" : "bg-white/10",
        )}
      >
        <span
          className={cn(
            "inline-block size-4 rounded-full bg-foreground transition-transform",
            checked ? "translate-x-4.5" : "translate-x-0.5",
          )}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        {description ? (
          <span className="block text-[11px] text-foreground-muted">{description}</span>
        ) : null}
      </span>
    </button>
  );
}

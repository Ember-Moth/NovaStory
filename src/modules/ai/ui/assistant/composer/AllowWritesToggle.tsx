export function AllowWritesToggle({
  disabled,
  checked,
  onToggle,
}: {
  disabled: boolean;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onToggle}
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-px text-[10px] leading-4 transition disabled:cursor-not-allowed disabled:opacity-60 ${
        checked
          ? "border-accent-foreground/40 bg-accent-foreground/10 text-foreground"
          : "border-border/50 bg-editor-background/50 text-foreground-muted/60"
      }`}
    >
      <span
        className={`shrink-0 text-[12px] ${
          checked
            ? "icon-[material-symbols--edit-note] text-accent-foreground"
            : "icon-[material-symbols--edit-note-outline] text-foreground-muted/60"
        }`}
      />
      <span>允许写入</span>
    </button>
  );
}

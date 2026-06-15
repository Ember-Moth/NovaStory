import {
  AI_ASSISTANT_MAX_STEPS_DEFAULT,
  AI_ASSISTANT_MAX_STEPS_MAX,
  AI_ASSISTANT_MAX_STEPS_MIN,
} from "@/modules/config/domain/ai-assistant-options";

export function MaxStepsField({
  value,
  loading,
  isPending,
  onChange,
  onCommit,
  onReset,
}: {
  value: string;
  loading: boolean;
  isPending: boolean;
  onChange: (_value: string) => void;
  onCommit: (_value?: string) => void;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="number"
        min={AI_ASSISTANT_MAX_STEPS_MIN}
        max={AI_ASSISTANT_MAX_STEPS_MAX}
        step={1}
        value={loading ? "" : value}
        disabled={loading}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => onCommit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }

          if (event.key === "Escape") {
            onChange(value);
            event.currentTarget.blur();
          }
        }}
        className="h-8 w-28 rounded-md border border-border bg-sidebar-background px-2 text-sm text-foreground outline-none placeholder:text-foreground-muted/50 focus:border-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
        placeholder={String(AI_ASSISTANT_MAX_STEPS_DEFAULT)}
      />
      <button
        type="button"
        disabled={isPending}
        onClick={onReset}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-sidebar-background px-2.5 text-sm text-foreground transition hover:bg-list-hover-background disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="icon-[material-symbols--restart-alt] text-base" />
        重置
      </button>
      <span className="text-xs text-foreground-muted">
        范围 {AI_ASSISTANT_MAX_STEPS_MIN}-{AI_ASSISTANT_MAX_STEPS_MAX}
      </span>
    </div>
  );
}

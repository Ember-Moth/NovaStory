import { cn } from "@/shared/lib/cn";

export function MessageBranchSwitcher({
  currentIndex,
  total,
  onSelect,
}: {
  currentIndex: number;
  total: number;
  onSelect: (_index: number) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: total }, (_, index) => (
        <button
          key={index}
          type="button"
          onClick={() => onSelect(index)}
          className={cn(
            "rounded-md border px-2 py-1 text-[11px] leading-4 transition",
            index === currentIndex
              ? "border-accent-foreground bg-accent-foreground/10 text-accent-foreground"
              : "border-border bg-editor-background text-foreground-muted hover:text-foreground",
          )}
        >
          候选 {index + 1}
        </button>
      ))}
    </div>
  );
}

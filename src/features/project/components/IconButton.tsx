import { cn } from "@/shared/cn";

export function IconButton({
  icon,
  title,
  onClick,
  disabled = false,
  anchorId,
  className = "",
}: {
  icon: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  anchorId?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      data-action-anchor={anchorId}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded text-foreground-muted transition hover:bg-button-hover-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-drag-border disabled:cursor-not-allowed disabled:opacity-30",
        className,
      )}
      title={title}
    >
      <span className={cn(icon, "text-base leading-none")} />
    </button>
  );
}

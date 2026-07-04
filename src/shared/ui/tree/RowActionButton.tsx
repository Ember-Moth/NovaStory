export function RowActionButton({
  onClick,
  disabled,
  title,
  icon,
  anchorId,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  icon: string;
  anchorId?: string;
}) {
  return (
    <button
      type="button"
      data-action-anchor={anchorId}
      data-no-row-gesture
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      className="flex size-5 shrink-0 items-center justify-center rounded text-foreground-muted transition hover:bg-button-hover-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-drag-border focus-visible:outline-offset-0 disabled:cursor-not-allowed disabled:opacity-30"
      title={title}
    >
      <span className={`${icon} text-sm leading-none`} />
    </button>
  );
}

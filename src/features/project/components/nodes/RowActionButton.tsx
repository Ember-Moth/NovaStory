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
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      className="text-foreground-muted hover:bg-button-hover-background hover:text-foreground focus-visible:outline-drag-border flex h-5 w-5 items-center justify-center rounded transition focus-visible:outline-2 focus-visible:outline-offset-0 disabled:cursor-not-allowed disabled:opacity-30"
      title={title}
    >
      <span className={`${icon} text-sm leading-none`} />
    </button>
  );
}

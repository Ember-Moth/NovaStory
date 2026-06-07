import { type ReactNode } from "react";

export function RowHoverSlot({ actions, badge }: { actions?: ReactNode; badge?: ReactNode }) {
  if (!actions && !badge) {
    return null;
  }

  return (
    <div className="grid h-5 shrink-0 items-center">
      {actions ? (
        <div className="col-start-1 row-start-1 flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
          {actions}
        </div>
      ) : null}
      {badge ? (
        <span className="col-start-1 row-start-1 justify-self-end self-center max-w-20 truncate text-[10px] leading-none text-accent-foreground opacity-70 transition group-hover:hidden">
          {badge}
        </span>
      ) : null}
    </div>
  );
}

export function RowActionButton({
  onClick,
  disabled,
  title,
  icon,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  icon: string;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      className="flex h-5 w-5 items-center justify-center rounded text-foreground-muted transition hover:bg-button-hover-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
      title={title}
    >
      <span className={`${icon} text-sm leading-none`} />
    </button>
  );
}

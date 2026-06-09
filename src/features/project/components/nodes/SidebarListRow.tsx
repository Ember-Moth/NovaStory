import { type ReactNode } from "react";

import { cn } from "@/shared/cn";

export const ROW_BASE = "flex w-full items-center gap-1 h-7 pr-4 text-[13px]";
export const ROW_ACTIVE = "bg-list-active-background text-foreground";
export const ROW_INACTIVE = "text-foreground hover:bg-list-hover-background";

export function rowPaddingLeft(depth: number) {
  return 8 + depth * 16;
}

export function SidebarListRow({
  depth = 0,
  isActive,
  group = false,
  className = "",
  onClick,
  leading,
  icon,
  label,
  trailing,
  actions,
  anchorId,
  dataNodeId,
}: {
  depth?: number;
  isActive: boolean;
  group?: boolean;
  className?: string;
  onClick?: () => void;
  leading?: ReactNode;
  icon?: ReactNode;
  label: ReactNode;
  trailing?: ReactNode;
  actions?: ReactNode;
  anchorId?: string;
  dataNodeId?: string;
}) {
  const stateClass = isActive ? ROW_ACTIVE : ROW_INACTIVE;
  const hasHoverSlot = trailing != null || actions != null;
  const groupClass = group || hasHoverSlot ? "group" : "";
  const interactiveClass = onClick ? "cursor-pointer" : "";

  return (
    <div
      data-action-anchor={anchorId}
      data-tree-node-id={dataNodeId}
      className={cn(ROW_BASE, stateClass, groupClass, interactiveClass, className)}
      style={{ paddingLeft: `${rowPaddingLeft(depth)}px` }}
      onClick={onClick}
    >
      {leading}
      {icon}
      <div className="flex min-w-0 flex-1 items-center gap-1">{label}</div>
      <RowHoverSlot badge={trailing} actions={actions} />
    </div>
  );
}

function RowHoverSlot({ actions, badge }: { actions?: ReactNode; badge?: ReactNode }) {
  if (!actions && !badge) {
    return null;
  }

  return (
    <div className="grid h-5 shrink-0 items-center">
      {actions ? (
        <div className="pointer-events-none col-start-1 row-start-1 flex items-center justify-end gap-1 justify-self-end opacity-0 transition group-hover:pointer-events-auto group-hover:opacity-100">
          {actions}
        </div>
      ) : null}
      {badge ? (
        <span
          className={cn(
            "col-start-1 row-start-1 max-w-20 self-center justify-self-end truncate text-[10px] leading-none text-accent-foreground opacity-70 transition",
            actions ? "group-hover:pointer-events-none group-hover:opacity-0" : "",
          )}
        >
          {badge}
        </span>
      ) : null}
    </div>
  );
}

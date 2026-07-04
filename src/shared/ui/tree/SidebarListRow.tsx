import { motion } from "motion/react";
import type { ReactNode, PointerEvent as ReactPointerEvent } from "react";

import { cn } from "@/shared/lib/cn";

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
  description,
  trailing,
  actions,
  isEditing = false,
  anchorId,
  dataNodeId,
  dataRowId,
  dataSymlinkTargetPickerState,
  multiline = false,
  layout,
  onPointerDown,
}: {
  depth?: number;
  isActive: boolean;
  group?: boolean;
  className?: string;
  onClick?: () => void;
  leading?: ReactNode;
  icon?: ReactNode;
  label: ReactNode;
  description?: ReactNode;
  trailing?: ReactNode;
  actions?: ReactNode;
  isEditing?: boolean;
  anchorId?: string;
  dataNodeId?: string;
  dataRowId?: string;
  dataSymlinkTargetPickerState?: "source" | "selected-target" | "disabled-target";
  multiline?: boolean;
  layout?: boolean | "position";
  onPointerDown?: (_event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const stateClass = isActive ? ROW_ACTIVE : ROW_INACTIVE;
  const hasHoverSlot = trailing != null || actions != null;
  const groupClass = group || hasHoverSlot ? "group" : "";
  const interactiveClass = onClick ? "cursor-pointer" : "";
  const prefix =
    leading || icon ? (
      <div className="flex items-start gap-1">
        {leading}
        {icon}
      </div>
    ) : null;

  return (
    <motion.div
      data-action-anchor={anchorId}
      data-tree-node-id={dataNodeId}
      data-row-id={dataRowId}
      data-symlink-target-picker-state={dataSymlinkTargetPickerState}
      className={cn(
        ROW_BASE,
        stateClass,
        groupClass,
        interactiveClass,
        multiline
          ? "grid h-auto grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-[auto_auto] items-start gap-x-1 py-1"
          : "",
        className,
      )}
      initial={false}
      animate={{ paddingLeft: rowPaddingLeft(depth) }}
      transition={{ duration: 0.14, ease: "easeOut" }}
      onClick={onClick}
      onPointerDown={onPointerDown}
      layout={layout}
    >
      {multiline ? (
        <>
          {prefix ? (
            <div className="col-start-1 row-start-1 mt-0.5 self-start">{prefix}</div>
          ) : null}
          <div className="col-start-2 row-start-1 min-w-0">
            <div className="flex min-w-0 items-center gap-1">{label}</div>
          </div>
          <div className="col-start-3 row-start-1 row-end-3 mt-0.5 self-start">
            <RowHoverSlot badge={trailing} actions={actions} isEditing={isEditing} />
          </div>
          {description ? (
            <div className="col-[2/4] row-start-2 min-w-0 text-[11px] text-foreground-muted leading-4">
              {description}
            </div>
          ) : null}
        </>
      ) : (
        <>
          {leading}
          {icon}
          <div className="flex min-w-0 flex-1 items-center gap-1">{label}</div>
          <RowHoverSlot badge={trailing} actions={actions} isEditing={isEditing} />
        </>
      )}
    </motion.div>
  );
}

function RowHoverSlot({
  actions,
  badge,
  isEditing,
}: {
  actions?: ReactNode;
  badge?: ReactNode;
  isEditing: boolean;
}) {
  if (!actions && !badge) {
    return null;
  }

  return (
    <div className="grid h-5 shrink-0 items-center">
      {actions && !isEditing ? (
        <div className="interpolate-size pointer-events-none col-start-1 row-start-1 flex w-0 items-center justify-end gap-1 justify-self-end overflow-visible opacity-0 transition-all duration-200 group-hover:pointer-events-auto group-hover:w-auto group-hover:opacity-100">
          {actions}
        </div>
      ) : null}
      {badge && !isEditing ? (
        <span
          className={cn(
            "col-start-1 row-start-1 max-w-20 self-center justify-self-end truncate text-[10px] text-accent-foreground leading-none opacity-70 transition",
            actions ? "group-hover:pointer-events-none group-hover:opacity-0" : "",
          )}
        >
          {badge}
        </span>
      ) : null}
    </div>
  );
}

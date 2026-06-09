import { type ReactNode } from "react";

import { OverlayScrollbar } from "@/shared/ui/OverlayScrollbar";

export function SidebarSection({
  title,
  actions,
  collapsed,
  onToggleCollapse,
  height,
  children,
}: {
  title: string;
  actions?: ReactNode;
  collapsed: boolean;
  onToggleCollapse: () => void;
  height?: number;
  children: ReactNode;
}) {
  return (
    <div
      className="flex shrink-0 flex-col overflow-hidden"
      style={collapsed || height == null ? undefined : { height }}
    >
      <div
        className="flex h-7 shrink-0 cursor-pointer items-center gap-1 px-2 text-[11px] font-semibold tracking-wider text-foreground-muted uppercase hover:text-foreground"
        onClick={onToggleCollapse}
        role="button"
        tabIndex={0}
      >
        <span
          className={`w-4 shrink-0 text-base ${!collapsed ? "icon-[material-symbols--keyboard-arrow-down]" : "icon-[material-symbols--keyboard-arrow-right]"}`}
        />
        <span className="truncate">{title}</span>
        {actions ? (
          <span
            className="ml-auto flex items-center gap-1"
            onClick={(event) => event.stopPropagation()}
          >
            {actions}
          </span>
        ) : null}
      </div>
      {!collapsed ? <OverlayScrollbar>{children}</OverlayScrollbar> : null}
    </div>
  );
}

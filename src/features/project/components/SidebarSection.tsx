import { type ReactNode, useState } from "react";

export function SidebarSection({
  title,
  actions,
  defaultExpanded = true,
  children,
}: {
  title: string;
  actions?: ReactNode;
  defaultExpanded?: boolean;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="flex shrink-0 flex-col">
      <div
        className="flex shrink-0 cursor-pointer items-center gap-1 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground-muted hover:text-foreground"
        onClick={() => setExpanded((value) => !value)}
        role="button"
        tabIndex={0}
      >
        <span
          className={`w-4 shrink-0 text-base ${expanded ? "icon-[material-symbols--keyboard-arrow-down]" : "icon-[material-symbols--keyboard-arrow-right]"}`}
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
      {expanded ? <div className="overflow-auto">{children}</div> : null}
    </div>
  );
}

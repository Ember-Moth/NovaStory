import { type ComponentPropsWithoutRef, type ReactNode } from "react";

import { ActivityBar, type ActivityBarItem } from "@/client/components/ActivityBar";

export function AppShell({
  active,
  sidebar,
  children,
  className,
  mainClassName,
  ...rest
}: {
  active: ActivityBarItem;
  sidebar?: ReactNode;
  children: ReactNode;
  className?: string;
  mainClassName?: string;
} & Omit<ComponentPropsWithoutRef<"div">, "children" | "className">) {
  return (
    <div
      {...rest}
      className={`flex h-dvh w-full overflow-hidden bg-editor-background text-foreground select-none ${className ?? ""}`.trim()}
    >
      <ActivityBar active={active} />
      {sidebar}
      <div className={`flex min-w-0 flex-1 flex-col overflow-hidden ${mainClassName ?? ""}`.trim()}>
        {children}
      </div>
    </div>
  );
}

export function AppSidebar({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex w-72 shrink-0 flex-col overflow-hidden border-r border-border bg-sidebar-background">
      {children}
    </div>
  );
}

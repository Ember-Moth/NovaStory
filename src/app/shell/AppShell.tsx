import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "@/shared/lib/cn";

export function AppShell({
  sidebar,
  children,
  className,
  mainClassName,
  ...rest
}: {
  sidebar?: ReactNode;
  children: ReactNode;
  className?: string;
  mainClassName?: string;
} & Omit<ComponentPropsWithoutRef<"div">, "children" | "className">) {
  return (
    <div {...rest} className={cn("flex min-w-0 flex-1 overflow-hidden", className)}>
      {sidebar}
      <div className={cn("flex min-w-0 flex-1 flex-col overflow-hidden", mainClassName)}>
        {children}
      </div>
    </div>
  );
}

export function AppSidebar({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex w-72 shrink-0 flex-col overflow-hidden border-border border-r bg-sidebar-background">
      {children}
    </div>
  );
}

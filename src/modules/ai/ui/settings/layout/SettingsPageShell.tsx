import type { ReactNode } from "react";

import { AppShell } from "@/app/shell/AppShell";

import { SettingsSidebar } from "./SettingsSidebar";

export function SettingsPageShell({
  title,
  summary,
  actions,
  children,
}: {
  title: string;
  summary: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <AppShell sidebar={<SettingsSidebar />}>
      <div className="flex h-full flex-col overflow-hidden">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-border border-b bg-title-bar-background px-4 py-2">
          <div className="min-w-0">
            <h1 className="font-semibold text-[14px] text-foreground">{title}</h1>
            <p className="text-[11px] text-foreground-muted">{summary}</p>
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
        {children}
      </div>
    </AppShell>
  );
}

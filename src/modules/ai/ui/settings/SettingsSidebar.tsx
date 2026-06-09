import { AppSidebar } from "@/app/shell/AppShell";
import { SidebarListRow } from "@/shared/ui/tree/SidebarListRow";

export function SettingsSidebar() {
  return (
    <AppSidebar>
      <div className="flex h-7 shrink-0 items-center px-3 text-[11px] font-semibold tracking-wider text-foreground-muted uppercase">
        设置
      </div>
      <SidebarListRow
        isActive
        icon={
          <span className="icon-[material-symbols--smart-toy] text-base text-foreground-muted" />
        }
        label="AI"
      />
    </AppSidebar>
  );
}

import { useLocation } from "wouter";

import { AppSidebar } from "@/app/shell/AppShell";
import { parseAppRoute } from "@/app/routing/useCachedProjectRoute";
import { SidebarListRow } from "@/shared/ui/tree/SidebarListRow";

export function SettingsSidebar() {
  const [location, navigate] = useLocation();
  const route = parseAppRoute(location);
  const activeSection = route.kind === "settings" ? route.section : "ai-connections";

  return (
    <AppSidebar>
      <div className="flex h-7 shrink-0 items-center px-3 text-[11px] font-semibold tracking-wider text-foreground-muted uppercase">
        设置
      </div>
      <SidebarListRow
        isActive={activeSection === "ai-connections"}
        icon={
          <span className="icon-[material-symbols--smart-toy] text-base text-foreground-muted" />
        }
        label="AI 连接"
        onClick={() => navigate("/settings/ai-connections")}
      />
      <SidebarListRow
        isActive={activeSection === "ai"}
        icon={<span className="icon-[material-symbols--tune] text-base text-foreground-muted" />}
        label="AI 配置"
        onClick={() => navigate("/settings/ai")}
      />
      <SidebarListRow
        isActive={activeSection === "prompts"}
        icon={<span className="icon-[material-symbols--article] text-base text-foreground-muted" />}
        label="Prompt 库"
        onClick={() => navigate("/settings/prompts")}
      />
    </AppSidebar>
  );
}

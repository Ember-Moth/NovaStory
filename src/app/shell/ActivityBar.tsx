import { useAtomValue } from "jotai";
import { useLocation } from "wouter";

import { parseAppRoute } from "@/app/routing/useCachedProjectRoute";
import { lastWorkspaceRouteAtom } from "@/app/state/lastProject";
import { cn } from "@/shared/lib/cn";

export type ActivityBarItem = "home" | "project" | "settings";

function ActivityBarButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: string;
  label: string;
  active: boolean;
  onClick?: () => void;
}) {
  const interactive = onClick != null;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!interactive}
      title={label}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex w-full items-center justify-center border-l-2 border-l-transparent py-1 transition",
        interactive ? "cursor-pointer hover:text-activity-bar-active-foreground" : "cursor-default",
      )}
    >
      {active ? (
        <div
          className="pointer-events-none absolute inset-y-0 left-0 w-0.5 bg-activity-bar-active-foreground view-transition-name-[activity-bar-indicator]"
          aria-hidden
        />
      ) : null}
      <span
        className={cn(
          icon,
          "text-2xl",
          active ? "text-activity-bar-active-foreground" : "text-activity-bar-foreground",
        )}
      />
    </button>
  );
}

export function ActivityBar({ active }: { active: ActivityBarItem }) {
  const [location, navigate] = useLocation();
  const lastWorkspaceRoute = useAtomValue(lastWorkspaceRouteAtom);
  const route = parseAppRoute(location);
  const projectTarget = route.kind === "workspace" ? `/project/${route.projectId}` : "/";

  return (
    <div className="flex w-12 shrink-0 flex-col items-center gap-1 bg-activity-bar-background pt-2">
      <ActivityBarButton
        icon="icon-[material-symbols--folder]"
        label="项目"
        active={active === "home"}
        onClick={() => navigate(projectTarget)}
      />

      {lastWorkspaceRoute ? (
        <ActivityBarButton
          icon="icon-[material-symbols--description]"
          label="编辑器"
          active={active === "project"}
          onClick={
            active === "project"
              ? undefined
              : () =>
                  navigate(
                    `/project/${lastWorkspaceRoute.projectId}/workspace/${lastWorkspaceRoute.workspaceId}`,
                  )
          }
        />
      ) : null}

      <div className="mt-auto flex w-full flex-col items-center pb-2">
        <ActivityBarButton
          icon="icon-[material-symbols--settings]"
          label="设置"
          active={active === "settings"}
          onClick={() => navigate("/settings/ai")}
        />
      </div>
    </div>
  );
}

import { useAtomValue } from "jotai";
import { useLocation } from "wouter";

import { lastProjectIdAtom } from "@/client/state/lastProject";

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
      className={`relative flex w-full items-center justify-center border-l-2 border-l-transparent py-1 transition ${
        interactive ? "hover:text-activity-bar-active-foreground cursor-pointer" : "cursor-default"
      }`}
    >
      {active ? (
        <div
          className="bg-activity-bar-active-foreground view-transition-name-[activity-bar-indicator] pointer-events-none absolute inset-y-0 left-0 w-0.5"
          aria-hidden
        />
      ) : null}
      <span
        className={`${icon} text-2xl ${
          active ? "text-activity-bar-active-foreground" : "text-activity-bar-foreground"
        }`}
      />
    </button>
  );
}

export function ActivityBar({ active }: { active: ActivityBarItem }) {
  const [, navigate] = useLocation();
  const lastProjectId = useAtomValue(lastProjectIdAtom);

  return (
    <div className="bg-activity-bar-background flex w-12 shrink-0 flex-col items-center gap-1 pt-2">
      <ActivityBarButton
        icon="icon-[material-symbols--folder]"
        label="项目"
        active={active === "home"}
        onClick={() => navigate("/")}
      />

      {lastProjectId ? (
        <ActivityBarButton
          icon="icon-[material-symbols--description]"
          label="编辑器"
          active={active === "project"}
          onClick={active === "project" ? undefined : () => navigate(`/project/${lastProjectId}`)}
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

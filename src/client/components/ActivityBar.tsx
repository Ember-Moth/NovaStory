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
      className={`flex w-full items-center justify-center py-1 transition ${
        active
          ? "border-l-2 border-l-activity-bar-active-foreground"
          : "border-l-2 border-l-transparent"
      } ${interactive ? "cursor-pointer hover:text-activity-bar-active-foreground" : "cursor-default"}`}
    >
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
    <div className="flex w-12 shrink-0 flex-col items-center gap-1 bg-activity-bar-background pt-2">
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

import { MotionConfig } from "motion/react";
import { Activity } from "react";

import { useCachedProjectRoute } from "@/app/routing/useCachedProjectRoute";
import { ActivityBar, type ActivityBarItem } from "@/app/shell/ActivityBar";
import { AiConfigSettingsPage } from "@/modules/ai/ui/settings/AiConfigSettingsPage";
import { AiSettingsPage } from "@/modules/ai/ui/settings/AiSettingsPage";
import { PromptLibrarySettingsPage } from "@/modules/ai/ui/settings/PromptLibrarySettingsPage";
import { ProjectsPage } from "@/modules/projects/ui/routes/ProjectsPage";
import { WorkspaceEditorPage } from "@/modules/workspace/ui/editor/WorkspaceEditorPage";

import "./styles.css";

export function App() {
  const {
    route,
    isProjectsPage,
    isSettings,
    isWorkspaceRoute,
    isKnownRoute,
    projectRouteId,
    cachedWorkspaceRoute,
  } = useCachedProjectRoute();
  const projectBranchId = route.kind === "project-branch" ? route.branchId : null;

  if (!isKnownRoute) {
    return (
      <div className="flex h-dvh items-center justify-center bg-editor-background text-foreground-muted">
        404: No such page!
      </div>
    );
  }

  const active: ActivityBarItem = isSettings ? "settings" : isWorkspaceRoute ? "project" : "home";

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex h-dvh w-full select-none overflow-hidden bg-editor-background text-foreground">
        <ActivityBar active={active} />

        <Activity mode={isProjectsPage ? "visible" : "hidden"}>
          <ProjectsPage projectId={projectRouteId} branchId={projectBranchId} />
        </Activity>

        <Activity mode={isSettings ? "visible" : "hidden"}>
          {route.kind === "settings" ? <SettingsPage section={route.section} /> : null}
        </Activity>

        {cachedWorkspaceRoute ? (
          <Activity mode={isWorkspaceRoute ? "visible" : "hidden"}>
            <WorkspaceEditorPage
              key={cachedWorkspaceRoute.workspaceId}
              projectId={cachedWorkspaceRoute.projectId}
              workspaceId={cachedWorkspaceRoute.workspaceId}
            />
          </Activity>
        ) : null}
      </div>
    </MotionConfig>
  );
}

function SettingsPage({ section }: { section: "ai-connections" | "ai" | "prompts" }) {
  if (section === "prompts") {
    return <PromptLibrarySettingsPage />;
  }

  if (section === "ai") {
    return <AiConfigSettingsPage />;
  }

  return <AiSettingsPage />;
}

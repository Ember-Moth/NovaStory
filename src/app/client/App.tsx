import { Activity } from "react";

import { useCachedProjectRoute } from "@/app/routing/useCachedProjectRoute";
import { AiSettingsPage } from "@/modules/ai/ui/settings/AiSettingsPage";
import { ProjectsPage } from "@/modules/projects/ui/ProjectsPage";
import { WorkspaceEditorPage } from "@/modules/workspace/ui/editor/WorkspaceEditorPage";

import "./styles.css";

export function App() {
  const {
    isProjectsPage,
    isSettings,
    isWorkspaceRoute,
    isKnownRoute,
    projectRouteId,
    cachedWorkspaceRoute,
  } = useCachedProjectRoute();

  if (!isKnownRoute) {
    return (
      <div className="flex h-dvh items-center justify-center bg-editor-background text-foreground-muted">
        404: No such page!
      </div>
    );
  }

  return (
    <>
      <Activity mode={isProjectsPage ? "visible" : "hidden"}>
        <ProjectsPage projectId={projectRouteId} />
      </Activity>

      <Activity mode={isSettings ? "visible" : "hidden"}>
        <AiSettingsPage />
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
    </>
  );
}

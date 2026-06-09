import { Activity } from "react";

import { useCachedProjectRoute } from "@/app/routing/useCachedProjectRoute";
import { AiSettingsPage } from "@/modules/ai/ui/settings/AiSettingsPage";
import { ProjectsPage } from "@/modules/projects/ui/ProjectsPage";
import { WorkspaceEditorPage } from "@/modules/workspace/ui/editor/WorkspaceEditorPage";

import "./styles.css";

export function App() {
  const { isHome, isSettings, isProjectRoute, isKnownRoute, cachedProjectId } =
    useCachedProjectRoute();

  if (!isKnownRoute) {
    return (
      <div className="flex h-dvh items-center justify-center bg-editor-background text-foreground-muted">
        404: No such page!
      </div>
    );
  }

  return (
    <>
      <Activity mode={isHome ? "visible" : "hidden"}>
        <ProjectsPage />
      </Activity>

      <Activity mode={isSettings ? "visible" : "hidden"}>
        <AiSettingsPage />
      </Activity>

      {cachedProjectId ? (
        <Activity mode={isProjectRoute ? "visible" : "hidden"}>
          <WorkspaceEditorPage key={cachedProjectId} id={cachedProjectId} />
        </Activity>
      ) : null}
    </>
  );
}

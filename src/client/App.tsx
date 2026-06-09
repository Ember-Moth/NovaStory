import { Activity } from "react";

import { useCachedProjectRoute } from "@/client/hooks/useCachedProjectRoute";
import { AiSettingsPage } from "@/features/ai/AiSettingsPage";
import { HomePage } from "@/features/home/HomePage";
import { ProjectPage } from "@/features/project";

import "./styles.css";

export function App() {
  const { isHome, isSettings, isProjectRoute, isKnownRoute, cachedProjectId } =
    useCachedProjectRoute();

  if (!isKnownRoute) {
    return (
      <div className="bg-editor-background text-foreground-muted flex h-dvh items-center justify-center">
        404: No such page!
      </div>
    );
  }

  return (
    <>
      <Activity mode={isHome ? "visible" : "hidden"}>
        <HomePage />
      </Activity>

      <Activity mode={isSettings ? "visible" : "hidden"}>
        <AiSettingsPage />
      </Activity>

      {cachedProjectId ? (
        <Activity mode={isProjectRoute ? "visible" : "hidden"}>
          <ProjectPage key={cachedProjectId} id={cachedProjectId} />
        </Activity>
      ) : null}
    </>
  );
}

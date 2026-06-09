import { useAtom } from "jotai";
import { useLayoutEffect } from "react";
import { useLocation, useRoute } from "wouter";

import { lastProjectIdAtom } from "@/app/state/lastProject";

export function useCachedProjectRoute() {
  const [location] = useLocation();
  const [lastProjectId, setLastProjectId] = useAtom(lastProjectIdAtom);
  const [projectMatch, projectParams] = useRoute("/project/:id");
  const [projectsMatch, projectsParams] = useRoute("/projects/:id");

  const routeProjectId = projectMatch ? projectParams.id : projectsMatch ? projectsParams.id : null;
  const isProjectRoute = routeProjectId != null;
  const isHome = location === "/";
  const isSettings = location === "/settings/ai";
  const isKnownRoute = isHome || isSettings || isProjectRoute;
  const cachedProjectId = routeProjectId ?? lastProjectId;

  useLayoutEffect(() => {
    if (routeProjectId && routeProjectId !== lastProjectId) {
      setLastProjectId(routeProjectId);
    }
  }, [lastProjectId, routeProjectId, setLastProjectId]);

  return {
    isHome,
    isSettings,
    isProjectRoute,
    isKnownRoute,
    cachedProjectId,
    lastProjectId,
  };
}

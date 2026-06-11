import { useAtom } from "jotai";
import { useLayoutEffect } from "react";
import { useLocation } from "wouter";

import { lastProjectIdAtom, lastWorkspaceRouteAtom } from "@/app/state/lastProject";

export type AppRoute =
  | { kind: "home" }
  | { kind: "settings" }
  | { kind: "project"; projectId: string }
  | { kind: "workspace"; projectId: string; workspaceId: string }
  | { kind: "unknown" };

function decodePathSegment(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function parseAppRoute(location: string): AppRoute {
  const normalizedLocation = location.split(/[?#]/, 1)[0] || "/";

  if (normalizedLocation === "/") {
    return { kind: "home" };
  }

  if (normalizedLocation === "/settings/ai") {
    return { kind: "settings" };
  }

  const workspaceMatch = normalizedLocation.match(/^\/project\/([^/]+)\/workspace\/([^/]+)$/);
  if (workspaceMatch) {
    return {
      kind: "workspace",
      projectId: decodePathSegment(workspaceMatch[1]!),
      workspaceId: decodePathSegment(workspaceMatch[2]!),
    };
  }

  const projectMatch = normalizedLocation.match(/^\/project\/([^/]+)$/);
  if (projectMatch) {
    return {
      kind: "project",
      projectId: decodePathSegment(projectMatch[1]!),
    };
  }

  return { kind: "unknown" };
}

export function resolveCachedWorkspaceRoute(
  route: AppRoute,
  lastWorkspaceRoute: { projectId: string; workspaceId: string } | null,
) {
  if (route.kind === "workspace") {
    return {
      projectId: route.projectId,
      workspaceId: route.workspaceId,
    };
  }

  if (route.kind === "home") {
    return null;
  }

  return lastWorkspaceRoute;
}

export function resolveLastWorkspaceRoute(
  route: AppRoute,
  lastWorkspaceRoute: { projectId: string; workspaceId: string } | null,
) {
  if (route.kind === "workspace") {
    return {
      projectId: route.projectId,
      workspaceId: route.workspaceId,
    };
  }

  if (route.kind === "home") {
    return null;
  }

  return lastWorkspaceRoute;
}

export function resolveProjectRouteTarget(route: AppRoute, lastProjectId: string | null) {
  if (route.kind === "project" || route.kind === "workspace") {
    return `/project/${route.projectId}`;
  }

  if (route.kind === "settings" && lastProjectId) {
    return `/project/${lastProjectId}`;
  }

  return "/";
}

export function useCachedProjectRoute() {
  const [location] = useLocation();
  const [lastProjectId, setLastProjectId] = useAtom(lastProjectIdAtom);
  const [lastWorkspaceRoute, setLastWorkspaceRoute] = useAtom(lastWorkspaceRouteAtom);
  const route = parseAppRoute(location);
  const routeProjectId =
    route.kind === "project" || route.kind === "workspace" ? route.projectId : null;
  const routeWorkspaceProjectId = route.kind === "workspace" ? route.projectId : null;
  const routeWorkspaceId = route.kind === "workspace" ? route.workspaceId : null;
  const routeWorkspace =
    routeWorkspaceProjectId && routeWorkspaceId
      ? {
          projectId: routeWorkspaceProjectId,
          workspaceId: routeWorkspaceId,
        }
      : null;
  const cachedWorkspaceRoute = resolveCachedWorkspaceRoute(route, lastWorkspaceRoute);

  useLayoutEffect(() => {
    if (routeProjectId && routeProjectId !== lastProjectId) {
      setLastProjectId(routeProjectId);
    }
  }, [lastProjectId, routeProjectId, setLastProjectId]);

  useLayoutEffect(() => {
    const nextLastWorkspaceRoute = resolveLastWorkspaceRoute(route, lastWorkspaceRoute);

    if (
      nextLastWorkspaceRoute?.projectId !== lastWorkspaceRoute?.projectId ||
      nextLastWorkspaceRoute?.workspaceId !== lastWorkspaceRoute?.workspaceId
    ) {
      setLastWorkspaceRoute(nextLastWorkspaceRoute);
    }
  }, [lastWorkspaceRoute, route, setLastWorkspaceRoute]);

  return {
    route,
    isHome: route.kind === "home",
    isProjectDetailRoute: route.kind === "project",
    isWorkspaceRoute: route.kind === "workspace",
    isProjectsPage: route.kind === "home" || route.kind === "project",
    isSettings: route.kind === "settings",
    isKnownRoute: route.kind !== "unknown",
    projectRouteId: routeProjectId,
    routeProjectId,
    routeWorkspace,
    cachedWorkspaceRoute,
    lastProjectId,
    lastWorkspaceRoute,
  };
}

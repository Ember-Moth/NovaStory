import { expect, test } from "bun:test";

import {
  parseAppRoute,
  resolveCachedWorkspaceRoute,
  resolveLastWorkspaceRoute,
} from "./useCachedProjectRoute";

test("parseAppRoute recognizes home, detail, workspace, settings, and unknown routes", () => {
  expect(parseAppRoute("/")).toEqual({ kind: "home" });
  expect(parseAppRoute("/settings/ai")).toEqual({ kind: "settings" });
  expect(parseAppRoute("/project/project_1")).toEqual({
    kind: "project",
    projectId: "project_1",
  });
  expect(parseAppRoute("/project/project_1/workspace/workspace_1")).toEqual({
    kind: "workspace",
    projectId: "project_1",
    workspaceId: "workspace_1",
  });
  expect(parseAppRoute("/projects/project_1")).toEqual({ kind: "unknown" });
});

test("resolveCachedWorkspaceRoute clears mounted workspace on home route", () => {
  const lastWorkspaceRoute = {
    projectId: "project_1",
    workspaceId: "workspace_1",
  };

  expect(resolveCachedWorkspaceRoute({ kind: "home" }, lastWorkspaceRoute)).toBeNull();
  expect(
    resolveCachedWorkspaceRoute(
      {
        kind: "project",
        projectId: "project_1",
      },
      lastWorkspaceRoute,
    ),
  ).toEqual(lastWorkspaceRoute);
  expect(
    resolveCachedWorkspaceRoute(
      {
        kind: "workspace",
        projectId: "project_2",
        workspaceId: "workspace_2",
      },
      lastWorkspaceRoute,
    ),
  ).toEqual({
    projectId: "project_2",
    workspaceId: "workspace_2",
  });
});

test("resolveLastWorkspaceRoute clears recent workspace on home route", () => {
  const lastWorkspaceRoute = {
    projectId: "project_1",
    workspaceId: "workspace_1",
  };

  expect(resolveLastWorkspaceRoute({ kind: "home" }, lastWorkspaceRoute)).toBeNull();
  expect(
    resolveLastWorkspaceRoute(
      {
        kind: "project",
        projectId: "project_1",
      },
      lastWorkspaceRoute,
    ),
  ).toEqual(lastWorkspaceRoute);
  expect(
    resolveLastWorkspaceRoute(
      {
        kind: "workspace",
        projectId: "project_2",
        workspaceId: "workspace_2",
      },
      lastWorkspaceRoute,
    ),
  ).toEqual({
    projectId: "project_2",
    workspaceId: "workspace_2",
  });
});

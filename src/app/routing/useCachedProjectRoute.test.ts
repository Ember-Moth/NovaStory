import { expect, test } from "bun:test";

import {
  parseAppRoute,
  resolveCachedWorkspaceRoute,
  resolveLastWorkspaceRoute,
  resolveProjectRouteTarget,
} from "./useCachedProjectRoute";

test("parseAppRoute recognizes home, project, workspace, settings, and unknown routes", () => {
  expect(parseAppRoute("/")).toEqual({ kind: "home" });
  expect(parseAppRoute("/settings/ai")).toEqual({ kind: "settings" });
  expect(parseAppRoute("/project/project_1")).toEqual({
    kind: "project",
    projectId: "project_1",
  });
  expect(parseAppRoute("/project/project_1/branches")).toEqual({ kind: "unknown" });
  expect(parseAppRoute("/project/project_1/branches/branch_1")).toEqual({ kind: "unknown" });
  expect(parseAppRoute("/project/project_1/workspace/workspace_1")).toEqual({
    kind: "workspace",
    projectId: "project_1",
    workspaceId: "workspace_1",
  });
  expect(parseAppRoute("/projects/project_1")).toEqual({ kind: "unknown" });
});

test("parseAppRoute accepts non-uuid project and workspace ids", () => {
  expect(parseAppRoute("/project/V1sibl4A5sWB6UlUjzT4w")).toEqual({
    kind: "project",
    projectId: "V1sibl4A5sWB6UlUjzT4w",
  });
  expect(parseAppRoute("/project/V1sibl4A5sWB6UlUjzT4w/branches/branch_4A5sWB6UlUjzT4w")).toEqual({
    kind: "unknown",
  });
  expect(
    parseAppRoute("/project/V1sibl4A5sWB6UlUjzT4w/workspace/workspace_4A5sWB6UlUjzT4w"),
  ).toEqual({
    kind: "workspace",
    projectId: "V1sibl4A5sWB6UlUjzT4w",
    workspaceId: "workspace_4A5sWB6UlUjzT4w",
  });
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

test("resolveProjectRouteTarget reopens the current or last project detail route", () => {
  expect(resolveProjectRouteTarget({ kind: "project", projectId: "project_1" }, null)).toBe(
    "/project/project_1",
  );

  expect(
    resolveProjectRouteTarget(
      {
        kind: "workspace",
        projectId: "project_1",
        workspaceId: "workspace_1",
      },
      null,
    ),
  ).toBe("/project/project_1");

  expect(
    resolveProjectRouteTarget(
      {
        kind: "settings",
      },
      "project_2",
    ),
  ).toBe("/project/project_2");

  expect(
    resolveProjectRouteTarget(
      {
        kind: "settings",
      },
      null,
    ),
  ).toBe("/");
});

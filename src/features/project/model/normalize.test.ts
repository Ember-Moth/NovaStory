import { expect, test } from "bun:test";

import { buildAuxTreeState, buildContentTreeState, buildTimelineState } from "./normalize";

test("buildContentTreeState normalizes defaults and builds content indexes in preorder", () => {
  const state = buildContentTreeState([
    {
      id: "chapter",
      title: "  ",
      body: null,
      anchorTimelinePointId: "origin",
      children: [
        {
          id: "scene",
          title: "Scene 1",
          body: "Opening",
          anchorTimelinePointId: "point_a",
          children: [],
        },
      ],
    },
  ]);

  expect(state.tree[0]?.title).toBe("未命名节点");
  expect(state.tree[0]?.body).toBe("");
  expect(state.tree[0]?.children[0]?.title).toBe("Scene 1");
  expect(state.flatNodes.map((node) => node.id)).toEqual(["chapter", "scene"]);
  expect(state.nodeMap.get("scene")?.body).toBe("Opening");
  expect(state.parentMap.get("chapter")).toBeNull();
  expect(state.parentMap.get("scene")).toBe("chapter");
});

test("buildTimelineState normalizes labels and builds timeline lookup maps", () => {
  const state = buildTimelineState([
    {
      id: "origin",
      key: "origin",
      label: "Should not show",
      description: null,
      isImplicitOrigin: true,
    },
    {
      id: "point_a",
      key: "point_a",
      label: "Point A",
      description: null,
      isImplicitOrigin: false,
    },
  ]);

  expect(state.points.map((point) => point.label)).toEqual(["原点", "Point A"]);
  expect(state.points.map((point) => point.description)).toEqual(["故事初始状态", ""]);
  expect(state.labelMap.get("origin")).toBe("原点");
  expect([...state.idSet]).toEqual(["origin", "point_a"]);
});

test("buildAuxTreeState filters unsupported nodes and builds aux indexes", () => {
  const state = buildAuxTreeState([
    {
      id: "dir",
      nodeType: "dir",
      name: "  ",
      content: null,
      path: "/dir",
      symlinkTargetPath: null,
      hasTimelineChange: false,
      isDeleted: false,
      children: [
        {
          id: "file",
          nodeType: "file",
          name: "notes.md",
          content: null,
          path: "/dir/notes.md",
          symlinkTargetPath: null,
          hasTimelineChange: true,
          isDeleted: true,
          children: [],
        },
      ],
    },
    {
      id: "ignored",
      nodeType: "unknown",
      name: "ignored",
      content: null,
      path: "/ignored",
      symlinkTargetPath: null,
      hasTimelineChange: true,
      isDeleted: false,
      children: [
        {
          id: "ignored-child",
          nodeType: "file",
          name: "still-ignored.md",
          content: "ignored",
          path: "/ignored/still-ignored.md",
          symlinkTargetPath: null,
          hasTimelineChange: true,
          isDeleted: false,
          children: [],
        },
      ],
    },
  ]);

  expect(state.tree.map((node) => node.id)).toEqual(["dir"]);
  expect(state.tree[0]?.name).toBe("(未命名)");
  expect(state.tree[0]?.children.map((node) => node.id)).toEqual(["file"]);
  expect(state.nodeMap.get("file")?.content).toBe("");
  expect(state.tree[0]?.hasTimelineChange).toBe(false);
  expect(state.nodeMap.get("file")?.hasTimelineChange).toBe(true);
  expect(state.nodeMap.get("file")?.isDeleted).toBe(true);
  expect(state.parentMap.get("dir")).toBeNull();
  expect(state.parentMap.get("file")).toBe("dir");
  expect([...state.idSet]).toEqual(["dir", "file"]);
  expect(state.nodeMap.has("ignored-child")).toBe(false);
});

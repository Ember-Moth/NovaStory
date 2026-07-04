import { expect, test } from "vitest";

import { buildAuxTreeState, buildContentTreeState, buildTimelineState } from "./normalize";
import { getAuxRenameValidationError } from "./tree";

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
      label: "Should not show",
      description: null,
      isImplicitOrigin: true,
    },
    {
      id: "point_a",
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
      nodeType: "dir",
      name: "  ",
      content: null,
      path: "/dir",
      symlinkTargetPath: null,
      hasTimelineChange: false,
      children: [
        {
          nodeType: "file",
          name: "notes.md",
          content: null,
          path: "/dir/notes.md",
          symlinkTargetPath: null,
          hasTimelineChange: true,
          children: [],
        },
      ],
    },
    {
      nodeType: "unknown",
      name: "ignored",
      content: null,
      path: "/ignored",
      symlinkTargetPath: null,
      hasTimelineChange: true,
      children: [
        {
          nodeType: "file",
          name: "still-ignored.md",
          content: "ignored",
          path: "/ignored/still-ignored.md",
          symlinkTargetPath: null,
          hasTimelineChange: true,
          children: [],
        },
      ],
    },
  ]);

  expect(state.tree.map((node) => node.id)).toEqual(["/dir"]);
  expect(state.tree[0]?.name).toBe("(未命名)");
  expect(state.tree[0]?.children.map((node) => node.id)).toEqual(["/dir/notes.md"]);
  expect(state.nodeMap.get("/dir/notes.md")?.content).toBe("");
  expect(state.nodeMap.get("/dir/notes.md")?.symlinkTargetPath).toBeNull();
  expect(state.tree[0]?.hasTimelineChange).toBe(false);
  expect(state.nodeMap.get("/dir/notes.md")?.hasTimelineChange).toBe(true);
  expect(state.parentMap.get("/dir")).toBeNull();
  expect(state.parentMap.get("/dir/notes.md")).toBe("/dir");
  expect([...state.idSet]).toEqual(["/dir", "/dir/notes.md"]);
  expect(state.nodeMap.has("/ignored/still-ignored.md")).toBe(false);
});

test("getAuxRenameValidationError reports empty and duplicate aux names", () => {
  const state = buildAuxTreeState([
    {
      nodeType: "file",
      name: "notes.md",
      content: "notes",
      path: "/notes.md",
      symlinkTargetPath: null,
      hasTimelineChange: false,
      children: [],
    },
    {
      nodeType: "dir",
      name: "state",
      content: null,
      path: "/state",
      symlinkTargetPath: null,
      hasTimelineChange: false,
      children: [],
    },
  ]);

  expect(
    getAuxRenameValidationError({
      tree: state.tree,
      nodeMap: state.nodeMap,
      parentMap: state.parentMap,
      auxRootPath: "/",
      nodeId: "/state",
      name: "  ",
    }),
  ).toBe("无法重命名辅助信息：辅助信息名称不能为空。请输入名称后再保存。");

  expect(
    getAuxRenameValidationError({
      tree: state.tree,
      nodeMap: state.nodeMap,
      parentMap: state.parentMap,
      auxRootPath: "/",
      nodeId: "/state",
      name: " notes.md ",
    }),
  ).toBe(
    "无法重命名辅助信息：同一文件夹中已存在名为「notes.md」的辅助信息（/notes.md）。请换一个名称后再保存。",
  );

  expect(
    getAuxRenameValidationError({
      tree: state.tree,
      nodeMap: state.nodeMap,
      parentMap: state.parentMap,
      auxRootPath: "/",
      nodeId: "/state",
      name: "archive",
    }),
  ).toBeNull();
});

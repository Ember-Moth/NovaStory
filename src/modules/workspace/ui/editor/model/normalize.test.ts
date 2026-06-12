import { expect, test } from "bun:test";

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
      id: "dir",
      nodeType: "dir",
      name: "  ",
      content: null,
      path: "/dir",
      symlinkTargetAuxNodeId: null,
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
          symlinkTargetAuxNodeId: null,
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
      symlinkTargetAuxNodeId: null,
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
          symlinkTargetAuxNodeId: null,
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
  expect(state.nodeMap.get("file")?.symlinkTargetAuxNodeId).toBeNull();
  expect(state.tree[0]?.hasTimelineChange).toBe(false);
  expect(state.nodeMap.get("file")?.hasTimelineChange).toBe(true);
  expect(state.nodeMap.get("file")?.isDeleted).toBe(true);
  expect(state.parentMap.get("dir")).toBeNull();
  expect(state.parentMap.get("file")).toBe("dir");
  expect([...state.idSet]).toEqual(["dir", "file"]);
  expect(state.nodeMap.has("ignored-child")).toBe(false);
});

test("getAuxRenameValidationError reports empty and duplicate aux names", () => {
  const state = buildAuxTreeState([
    {
      id: "notes",
      nodeType: "file",
      name: "notes.md",
      content: "notes",
      path: "/notes.md",
      symlinkTargetAuxNodeId: null,
      symlinkTargetPath: null,
      hasTimelineChange: false,
      isDeleted: false,
      children: [],
    },
    {
      id: "state",
      nodeType: "dir",
      name: "state",
      content: null,
      path: "/state",
      symlinkTargetAuxNodeId: null,
      symlinkTargetPath: null,
      hasTimelineChange: false,
      isDeleted: false,
      children: [],
    },
  ]);

  expect(
    getAuxRenameValidationError({
      tree: state.tree,
      nodeMap: state.nodeMap,
      parentMap: state.parentMap,
      auxRootId: "aux_root",
      nodeId: "state",
      name: "  ",
    }),
  ).toBe("无法重命名辅助信息：辅助信息名称不能为空。请输入名称后再保存。");

  expect(
    getAuxRenameValidationError({
      tree: state.tree,
      nodeMap: state.nodeMap,
      parentMap: state.parentMap,
      auxRootId: "aux_root",
      nodeId: "state",
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
      auxRootId: "aux_root",
      nodeId: "state",
      name: "archive",
    }),
  ).toBeNull();
});

import { expect, test } from "vitest";

import { buildAuxTreeState, buildContentTreeState } from "./normalize";
import {
  type ContentDropPosition,
  collectAuxSubtreeIds,
  collectInvalidAuxSymlinkTargetIds,
  nextAuxFileName,
  nextAuxSymlinkName,
  resolveAuxHierarchyMove,
  resolveContentCreateSiblingPlacement,
  resolveContentMove,
} from "./tree";
import type { AuxTreeNodeVM, RawAuxTreeNode, RawContentTreeNode } from "./types";

function node(id: string, children: RawContentTreeNode[] = []): RawContentTreeNode {
  return {
    id,
    title: id,
    body: null,
    anchorTimelinePointId: "origin",
    children,
  };
}

function resolve(
  tree: RawContentTreeNode[],
  nodeId: string,
  targetId: string,
  position: ContentDropPosition,
) {
  const state = buildContentTreeState(tree);
  return resolveContentMove({
    tree: state.tree,
    parentMap: state.parentMap,
    nodeMap: state.nodeMap,
    nodeId,
    targetId,
    position,
  });
}

test("resolveContentMove moves a top-level node before another node", () => {
  const tree = [node("a"), node("b"), node("c")];
  const move = resolve(tree, "c", "a", "before");

  expect(move).toEqual({
    nodeId: "c",
    newParentId: null,
    afterSiblingId: null,
    position: "before",
  });
});

test("resolveContentMove moves a top-level node after another node", () => {
  const tree = [node("a"), node("b"), node("c")];
  const move = resolve(tree, "a", "c", "after");

  expect(move).toEqual({
    nodeId: "a",
    newParentId: null,
    afterSiblingId: "c",
    position: "after",
  });
});

test("resolveContentMove moves a node across parents", () => {
  const tree = [node("a", [node("a1")]), node("b"), node("c")];
  const move = resolve(tree, "a1", "c", "before");

  expect(move).toEqual({
    nodeId: "a1",
    newParentId: null,
    afterSiblingId: "b",
    position: "before",
  });
});

test("resolveContentMove moves a node inside a target as the last child", () => {
  const tree = [node("a"), node("b", [node("b1")])];
  const move = resolve(tree, "a", "b", "inside");

  expect(move).toEqual({
    nodeId: "a",
    newParentId: "b",
    afterSiblingId: "b1",
    position: "inside",
  });
});

test("resolveContentMove returns null for no-op adjacent moves", () => {
  const tree = [node("a"), node("b"), node("c")];

  expect(resolve(tree, "a", "b", "before")).toBeNull();
  expect(resolve(tree, "b", "a", "after")).toBeNull();
});

test("resolveContentMove rejects moving into itself or its subtree", () => {
  const tree = [node("a", [node("a1", [node("a2")])]), node("b")];

  expect(resolve(tree, "a", "a", "inside")).toBeNull();
  expect(resolve(tree, "a", "a1", "inside")).toBeNull();
  expect(resolve(tree, "a", "a2", "after")).toBeNull();
});

test("resolveContentCreateSiblingPlacement inserts after the active sibling", () => {
  const state = buildContentTreeState([node("a"), node("b"), node("c")]);
  const placement = resolveContentCreateSiblingPlacement({
    activeNode: state.nodeMap.get("b") ?? null,
    tree: state.tree,
    parentMap: state.parentMap,
  });

  expect(placement).toEqual({
    parentId: null,
    afterSiblingId: "b",
  });
});

test("resolveContentCreateSiblingPlacement appends to the top level when nothing is selected", () => {
  const state = buildContentTreeState([node("a"), node("b"), node("c")]);
  const placement = resolveContentCreateSiblingPlacement({
    activeNode: null,
    tree: state.tree,
    parentMap: state.parentMap,
  });

  expect(placement).toEqual({
    parentId: null,
    afterSiblingId: "c",
  });
});

function auxNode(name: string): AuxTreeNodeVM {
  const auxPath = name.startsWith("/") ? name : `/${name}`;
  return {
    id: auxPath,
    nodeType: "file",
    name,
    content: "",
    path: auxPath,
    symlinkTargetPath: null,
    hasTimelineChange: false,
    children: [],
  };
}

function rawAuxNode(
  id: string,
  overrides: Partial<RawAuxTreeNode> = {},
  children: RawAuxTreeNode[] = [],
): RawAuxTreeNode {
  const auxPath = id.startsWith("/") ? id : `/${id}`;
  return {
    nodeType: "file",
    name: id,
    content: "",
    path: auxPath,
    symlinkTargetPath: null,
    hasTimelineChange: false,
    children,
    ...overrides,
  };
}

function resolveAux(nodes: RawAuxTreeNode[], nodeId: string, targetId: string | null) {
  const state = buildAuxTreeState(nodes);
  return resolveAuxHierarchyMove({
    parentMap: state.parentMap,
    nodeMap: state.nodeMap,
    auxRootPath: "/",
    nodeId,
    targetId,
  });
}

test("nextAuxSymlinkName starts with link 1 when there is no conflict", () => {
  expect(nextAuxSymlinkName([auxNode("notes.md")], "notes.md")).toBe("notes.md - 链接 1");
});

test("nextAuxFileName creates markdown files by default", () => {
  expect(nextAuxFileName([])).toBe("新文件 1.md");
});

test("nextAuxFileName increments markdown filenames until unique", () => {
  expect(nextAuxFileName([auxNode("新文件 1.md"), auxNode("新文件 2.md")])).toBe("新文件 3.md");
});

test("nextAuxSymlinkName increments until the name is unique", () => {
  expect(
    nextAuxSymlinkName(
      [auxNode("notes.md"), auxNode("notes.md - 链接 1"), auxNode("notes.md - 链接 2")],
      "notes.md",
    ),
  ).toBe("notes.md - 链接 3");
});

test("nextAuxSymlinkName treats files directories and symlinks as the same collision space", () => {
  expect(
    nextAuxSymlinkName(
      [
        auxNode("notes.md - 链接 1"),
        {
          ...auxNode("notes.md - 链接 2"),
          nodeType: "dir",
        },
        {
          ...auxNode("notes.md - 链接 3"),
          nodeType: "symlink",
          symlinkTargetPath: "/notes.md",
        },
      ],
      "notes.md",
    ),
  ).toBe("notes.md - 链接 4");
});

test("collectAuxSubtreeIds includes descendants", () => {
  const root = {
    ...auxNode("dir"),
    nodeType: "dir" as const,
    children: [{ ...auxNode("child"), children: [auxNode("leaf")] }],
  };

  expect([...collectAuxSubtreeIds(root)]).toEqual(["/dir", "/child", "/leaf"]);
});

test("collectInvalidAuxSymlinkTargetIds marks self and indirect cycles as invalid", () => {
  const state = buildAuxTreeState([
    rawAuxNode("source_link", {
      nodeType: "symlink",
      symlinkTargetPath: "/target_file",
    }),
    rawAuxNode("target_file"),
    rawAuxNode("safe_link", {
      nodeType: "symlink",
      symlinkTargetPath: "/target_file",
    }),
    rawAuxNode("loop_a", {
      nodeType: "symlink",
      symlinkTargetPath: "/loop_b",
    }),
    rawAuxNode("loop_b", {
      nodeType: "symlink",
      symlinkTargetPath: "/source_link",
    }),
  ]);

  expect(collectInvalidAuxSymlinkTargetIds(state.nodeMap, "/source_link")).toEqual(
    new Set(["/source_link", "/loop_a", "/loop_b"]),
  );
});

test("resolveAuxHierarchyMove moves into a hovered directory", () => {
  const move = resolveAux(
    [rawAuxNode("source"), rawAuxNode("dir", { nodeType: "dir" })],
    "/source",
    "/dir",
  );

  expect(move).toEqual({
    nodeId: "/source",
    newParentId: "/dir",
  });
});

test("resolveAuxHierarchyMove maps a hovered file to its parent directory", () => {
  const move = resolveAux(
    [rawAuxNode("source"), rawAuxNode("dir", { nodeType: "dir" }, [rawAuxNode("file")])],
    "/source",
    "/file",
  );

  expect(move).toEqual({
    nodeId: "/source",
    newParentId: "/dir",
  });
});

test("resolveAuxHierarchyMove maps a hovered top-level file to root", () => {
  const move = resolveAux(
    [rawAuxNode("dir", { nodeType: "dir" }, [rawAuxNode("source")]), rawAuxNode("file")],
    "/source",
    "/file",
  );

  expect(move).toEqual({
    nodeId: "/source",
    newParentId: "/",
  });
});

test("resolveAuxHierarchyMove still returns null for top-level no-op moves", () => {
  expect(resolveAux([rawAuxNode("source"), rawAuxNode("file")], "/source", "/file")).toBeNull();
});

test("resolveAuxHierarchyMove maps a blank-area drop to the root", () => {
  const move = resolveAux(
    [rawAuxNode("dir", { nodeType: "dir" }, [rawAuxNode("source")])],
    "/source",
    null,
  );

  expect(move).toEqual({
    nodeId: "/source",
    newParentId: "/",
  });
});

test("resolveAuxHierarchyMove returns null for same-parent moves", () => {
  expect(
    resolveAux(
      [rawAuxNode("dir", { nodeType: "dir" }, [rawAuxNode("source"), rawAuxNode("file")])],
      "/source",
      "/file",
    ),
  ).toBeNull();
});

test("resolveAuxHierarchyMove rejects moving into itself or its subtree", () => {
  const nodes = [
    rawAuxNode("dir", { nodeType: "dir" }, [
      rawAuxNode("child-dir", { nodeType: "dir" }, [rawAuxNode("leaf")]),
    ]),
    rawAuxNode("sibling"),
  ];

  expect(resolveAux(nodes, "/dir", "/dir")).toBeNull();
  expect(resolveAux(nodes, "/dir", "/child-dir")).toBeNull();
  expect(resolveAux(nodes, "/dir", "/leaf")).toBeNull();
});

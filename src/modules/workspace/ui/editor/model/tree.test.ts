import { expect, test } from "bun:test";

import { buildContentTreeState } from "./normalize";
import {
  resolveContentCreateSiblingPlacement,
  resolveContentMove,
  type ContentDropPosition,
} from "./tree";
import type { RawContentTreeNode } from "./types";

const ROOT_ID = "content_root";

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
    contentRootId: ROOT_ID,
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
    newParentId: ROOT_ID,
    afterSiblingId: null,
    position: "before",
  });
});

test("resolveContentMove moves a top-level node after another node", () => {
  const tree = [node("a"), node("b"), node("c")];
  const move = resolve(tree, "a", "c", "after");

  expect(move).toEqual({
    nodeId: "a",
    newParentId: ROOT_ID,
    afterSiblingId: "c",
    position: "after",
  });
});

test("resolveContentMove moves a node across parents", () => {
  const tree = [node("a", [node("a1")]), node("b"), node("c")];
  const move = resolve(tree, "a1", "c", "before");

  expect(move).toEqual({
    nodeId: "a1",
    newParentId: ROOT_ID,
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
    contentRootId: ROOT_ID,
  });

  expect(placement).toEqual({
    parentId: ROOT_ID,
    afterSiblingId: "b",
  });
});

test("resolveContentCreateSiblingPlacement appends to the top level when nothing is selected", () => {
  const state = buildContentTreeState([node("a"), node("b"), node("c")]);
  const placement = resolveContentCreateSiblingPlacement({
    activeNode: null,
    tree: state.tree,
    parentMap: state.parentMap,
    contentRootId: ROOT_ID,
  });

  expect(placement).toEqual({
    parentId: ROOT_ID,
    afterSiblingId: "c",
  });
});

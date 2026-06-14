import type { AuxTreeNodeVM, ContentTreeNodeVM } from "./types";

export type ContentDropPosition = "before" | "inside" | "after";

export interface ContentMoveIntent {
  nodeId: string;
  targetId: string;
  position: ContentDropPosition;
}

export interface ResolvedContentMove {
  nodeId: string;
  newParentId: string;
  afterSiblingId: string | null;
  position: ContentDropPosition;
}

export interface AuxHierarchyMoveIntent {
  nodeId: string;
  targetId: string | null;
}

export interface ResolvedAuxHierarchyMove {
  nodeId: string;
  newParentId: string;
}

export function buildContentNodePath(
  nodeId: string,
  contentParentMap: Map<string, string | null>,
  contentNodeMap: Map<string, ContentTreeNodeVM>,
  contentRootId: string | null,
) {
  const segments: string[] = [];
  let currentId: string | null = nodeId;

  while (currentId && currentId !== contentRootId) {
    const node = contentNodeMap.get(currentId);
    if (!node) {
      break;
    }
    segments.unshift(node.title);
    currentId = contentParentMap.get(currentId) ?? null;
  }

  return segments.join(" / ");
}

export function collectAncestorIds(
  parentMap: Map<string, string | null>,
  nodeId: string,
): string[] {
  const ancestors: string[] = [];
  let currentId = parentMap.get(nodeId) ?? null;

  while (currentId) {
    ancestors.push(currentId);
    currentId = parentMap.get(currentId) ?? null;
  }

  return ancestors;
}

export function listContentSiblings(
  tree: ContentTreeNodeVM[],
  parentId: string | null,
  contentRootId: string | null,
): ContentTreeNodeVM[] {
  if (!parentId || parentId === contentRootId) {
    return tree;
  }

  const parent = findContentNode(tree, parentId);
  return parent?.children ?? [];
}

export function resolveContentCreateSiblingPlacement(input: {
  activeNode: ContentTreeNodeVM | null;
  tree: ContentTreeNodeVM[];
  parentMap: ReadonlyMap<string, string | null>;
  contentRootId: string;
}) {
  if (input.activeNode) {
    return {
      parentId: input.parentMap.get(input.activeNode.id) ?? input.contentRootId,
      afterSiblingId: input.activeNode.id,
    };
  }

  return {
    parentId: input.contentRootId,
    afterSiblingId: input.tree.at(-1)?.id ?? null,
  };
}

export function findContentDeleteFallback(
  tree: ContentTreeNodeVM[],
  parentMap: Map<string, string | null>,
  contentRootId: string | null,
  nodeId: string,
  excludedIds: Set<string>,
): ContentTreeNodeVM | null {
  const parentId = parentMap.get(nodeId) ?? contentRootId;
  const siblings = listContentSiblings(tree, parentId, contentRootId);
  const nodeIndex = siblings.findIndex((sibling) => sibling.id === nodeId);

  if (nodeIndex > 0) {
    const previousSibling = siblings[nodeIndex - 1];
    if (previousSibling && !excludedIds.has(previousSibling.id)) {
      return previousSibling;
    }
  }

  if (parentId && parentId !== contentRootId && !excludedIds.has(parentId)) {
    return findContentNode(tree, parentId);
  }

  return null;
}

export function findContentNode(
  nodes: ContentTreeNodeVM[],
  nodeId: string,
): ContentTreeNodeVM | null {
  for (const node of nodes) {
    if (node.id === nodeId) {
      return node;
    }

    const found = findContentNode(node.children, nodeId);
    if (found) {
      return found;
    }
  }

  return null;
}

export function collectContentSubtreeIds(root: ContentTreeNodeVM): Set<string> {
  const ids = new Set<string>();

  const walk = (node: ContentTreeNodeVM) => {
    ids.add(node.id);
    for (const child of node.children) {
      walk(child);
    }
  };

  walk(root);
  return ids;
}

export function resolveContentMove({
  tree,
  parentMap,
  nodeMap,
  contentRootId,
  nodeId,
  targetId,
  position,
}: {
  tree: ContentTreeNodeVM[];
  parentMap: ReadonlyMap<string, string | null>;
  nodeMap: ReadonlyMap<string, ContentTreeNodeVM>;
  contentRootId: string | null;
  nodeId: string;
  targetId: string;
  position: ContentDropPosition;
}): ResolvedContentMove | null {
  if (!contentRootId || nodeId === targetId) {
    return null;
  }

  const node = nodeMap.get(nodeId);
  const target = nodeMap.get(targetId);
  if (!node || !target) {
    return null;
  }

  const subtreeIds = collectContentSubtreeIds(node);
  if (subtreeIds.has(targetId)) {
    return null;
  }

  const currentParentId = parentMap.get(nodeId) ?? contentRootId;

  if (position === "inside") {
    const siblingsWithoutMoved = target.children.filter((child) => child.id !== nodeId);
    const afterSiblingId = siblingsWithoutMoved.at(-1)?.id ?? null;

    if (currentParentId === targetId && target.children.at(-1)?.id === nodeId) {
      return null;
    }

    return {
      nodeId,
      newParentId: targetId,
      afterSiblingId,
      position,
    };
  }

  const targetParentId = parentMap.get(targetId) ?? contentRootId;
  const siblings = listContentSiblings(tree, targetParentId, contentRootId);
  const fromIndex = siblings.findIndex((sibling) => sibling.id === nodeId);
  const targetIndex = siblings.findIndex((sibling) => sibling.id === targetId);

  if (targetIndex < 0) {
    return null;
  }

  if (currentParentId === targetParentId) {
    if (position === "before" && fromIndex === targetIndex - 1) {
      return null;
    }
    if (position === "after" && fromIndex === targetIndex + 1) {
      return null;
    }
  }

  if (position === "after") {
    return {
      nodeId,
      newParentId: targetParentId,
      afterSiblingId: targetId,
      position,
    };
  }

  const siblingsWithoutMoved = siblings.filter((sibling) => sibling.id !== nodeId);
  const insertIndex = siblingsWithoutMoved.findIndex((sibling) => sibling.id === targetId);
  if (insertIndex < 0) {
    return null;
  }

  return {
    nodeId,
    newParentId: targetParentId,
    afterSiblingId: siblingsWithoutMoved[insertIndex - 1]?.id ?? null,
    position,
  };
}

export function findPreferredContentNode(nodes: ContentTreeNodeVM[]): ContentTreeNodeVM | null {
  for (const node of nodes) {
    const childPreferred = findPreferredContentNode(node.children);
    if (childPreferred) {
      return childPreferred;
    }
    if (node.body.trim()) {
      return node;
    }
  }

  return nodes[0] ?? null;
}

export function omitRecordKey<TValue>(record: Record<string, TValue>, key: string) {
  if (!(key in record)) {
    return record;
  }

  const next = { ...record };
  delete next[key];
  return next;
}

export function buildAuxParentMap(
  nodes: AuxTreeNodeVM[],
  parentId: string | null = null,
): Map<string, string | null> {
  const map = new Map<string, string | null>();

  for (const node of nodes) {
    map.set(node.id, parentId);
    for (const [childId, childParentId] of buildAuxParentMap(node.children, node.id)) {
      map.set(childId, childParentId);
    }
  }

  return map;
}

export function findAuxNode(nodes: AuxTreeNodeVM[], nodeId: string): AuxTreeNodeVM | null {
  for (const node of nodes) {
    if (node.id === nodeId) {
      return node;
    }

    const found = findAuxNode(node.children, nodeId);
    if (found) {
      return found;
    }
  }

  return null;
}

export function collectAuxSubtreeIds(root: AuxTreeNodeVM): Set<string> {
  const ids = new Set<string>();

  const walk = (node: AuxTreeNodeVM) => {
    ids.add(node.id);
    for (const child of node.children) {
      walk(child);
    }
  };

  walk(root);
  return ids;
}

export function wouldRetargetAuxSymlinkCreateCycle(
  nodeMap: ReadonlyMap<string, AuxTreeNodeVM>,
  sourceSymlinkId: string,
  targetPath: string,
) {
  const seen = new Set<string>();
  let current = nodeMap.get(targetPath) ?? null;

  while (current) {
    if (current.id === sourceSymlinkId || seen.has(current.id)) {
      return true;
    }

    seen.add(current.id);
    if (current.nodeType !== "symlink" || !current.symlinkTargetPath) {
      return false;
    }
    current = nodeMap.get(current.symlinkTargetPath) ?? null;
  }

  return false;
}

export function collectInvalidAuxSymlinkTargetIds(
  nodeMap: ReadonlyMap<string, AuxTreeNodeVM>,
  sourceSymlinkId: string,
) {
  const invalidIds = new Set<string>();

  for (const nodeId of nodeMap.keys()) {
    if (wouldRetargetAuxSymlinkCreateCycle(nodeMap, sourceSymlinkId, nodeId)) {
      invalidIds.add(nodeId);
    }
  }

  return invalidIds;
}

export function resolveAuxHierarchyMove({
  parentMap,
  nodeMap,
  auxRootPath,
  nodeId,
  targetId,
}: {
  parentMap: ReadonlyMap<string, string | null>;
  nodeMap: ReadonlyMap<string, AuxTreeNodeVM>;
  auxRootPath: string | null;
  nodeId: string;
  targetId: string | null;
}): ResolvedAuxHierarchyMove | null {
  if (!auxRootPath) {
    return null;
  }

  const node = nodeMap.get(nodeId);
  if (!node) {
    return null;
  }

  const currentParentId = parentMap.get(nodeId) ?? auxRootPath;

  if (targetId === null) {
    if (currentParentId === auxRootPath) {
      return null;
    }

    return {
      nodeId,
      newParentId: auxRootPath,
    };
  }

  if (nodeId === targetId) {
    return null;
  }

  const target = nodeMap.get(targetId);
  if (!target) {
    return null;
  }

  const subtreeIds = collectAuxSubtreeIds(node);
  if (subtreeIds.has(targetId)) {
    return null;
  }

  let newParentId: string | null;
  if (target.nodeType === "dir") {
    newParentId = target.id;
  } else {
    newParentId = parentMap.get(target.id) ?? auxRootPath;
  }

  if (!newParentId || newParentId === currentParentId || subtreeIds.has(newParentId)) {
    return null;
  }

  return {
    nodeId,
    newParentId,
  };
}

export function listAuxSiblings(
  tree: AuxTreeNodeVM[],
  nodeMap: ReadonlyMap<string, AuxTreeNodeVM>,
  parentId: string,
  auxRootPath: string | null,
): AuxTreeNodeVM[] {
  if (auxRootPath && parentId === auxRootPath) {
    return tree;
  }

  const parent = nodeMap.get(parentId);
  return parent?.children ?? [];
}

export function nextAuxDirName(siblings: AuxTreeNodeVM[]): string {
  const existing = new Set(siblings.map((node) => node.name));
  let index = 1;
  while (existing.has(`新文件夹 ${index}`)) {
    index += 1;
  }
  return `新文件夹 ${index}`;
}

export function nextAuxFileName(siblings: AuxTreeNodeVM[]): string {
  const existing = new Set(siblings.map((node) => node.name));
  let index = 1;
  while (existing.has(`新文件 ${index}.md`)) {
    index += 1;
  }
  return `新文件 ${index}.md`;
}

export function nextAuxSymlinkName(siblings: AuxTreeNodeVM[], targetName: string): string {
  const existing = new Set(siblings.map((node) => node.name));
  let index = 1;
  while (existing.has(`${targetName} - 链接 ${index}`)) {
    index += 1;
  }
  return `${targetName} - 链接 ${index}`;
}

export function getAuxRenameValidationError({
  tree,
  nodeMap,
  parentMap,
  auxRootPath,
  nodeId,
  name,
}: {
  tree: AuxTreeNodeVM[];
  nodeMap: ReadonlyMap<string, AuxTreeNodeVM>;
  parentMap: ReadonlyMap<string, string | null>;
  auxRootPath: string | null;
  nodeId: string;
  name: string;
}) {
  const normalizedName = name.trim();
  if (!normalizedName) {
    return "无法重命名辅助信息：辅助信息名称不能为空。请输入名称后再保存。";
  }

  const parentId = parentMap.get(nodeId) ?? auxRootPath;
  if (!parentId) {
    return null;
  }

  const conflict = listAuxSiblings(tree, nodeMap, parentId, auxRootPath).find(
    (node) => node.id !== nodeId && node.name.trim() === normalizedName,
  );
  if (!conflict) {
    return null;
  }

  return `无法重命名辅助信息：同一文件夹中已存在名为「${normalizedName}」的辅助信息（${conflict.path}）。请换一个名称后再保存。`;
}

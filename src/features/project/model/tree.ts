import type { AuxTreeNodeVM, ContentTreeNodeVM } from "./types";

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

export function listAuxSiblings(
  tree: AuxTreeNodeVM[],
  parentId: string,
  auxRootId: string | null,
): AuxTreeNodeVM[] {
  if (auxRootId && parentId === auxRootId) {
    return tree;
  }

  const parent = findAuxNode(tree, parentId);
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
  while (existing.has(`新文件 ${index}`)) {
    index += 1;
  }
  return `新文件 ${index}`;
}

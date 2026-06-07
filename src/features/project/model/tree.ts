import type { ContentTreeNodeVM } from "./types";

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

import type {
  AuxTreeNodeVM,
  ContentTreeNodeVM,
  RawAuxTreeNode,
  RawContentTreeNode,
  RawTimelinePoint,
  TimelinePointVM,
} from "./types";

export function normalizeContentNodes(nodes: RawContentTreeNode[]): ContentTreeNodeVM[] {
  return nodes.map((node) => ({
    id: node.id,
    title: node.title?.trim() || "未命名节点",
    body: node.body ?? "",
    anchorTimelinePointId: node.anchorTimelinePointId,
    children: normalizeContentNodes(node.children),
  }));
}

export function normalizeTimelinePoints(points: RawTimelinePoint[]): TimelinePointVM[] {
  return points.map((point) => ({
    id: point.id,
    key: point.key,
    label: point.isImplicitOrigin ? "原点" : point.label,
    description: point.isImplicitOrigin ? "故事初始状态" : (point.description ?? ""),
    isImplicitOrigin: point.isImplicitOrigin,
  }));
}

export function normalizeAuxNodes(nodes: RawAuxTreeNode[]): AuxTreeNodeVM[] {
  return nodes
    .filter(
      (node): node is RawAuxTreeNode & { nodeType: "dir" | "file" | "symlink" } =>
        node.nodeType === "dir" || node.nodeType === "file" || node.nodeType === "symlink",
    )
    .map((node) => ({
      id: node.id,
      nodeType: node.nodeType,
      name: node.name?.trim() || "(未命名)",
      content: node.content ?? "",
      path: node.path,
      symlinkTargetPath: node.symlinkTargetPath,
      children: normalizeAuxNodes(node.children),
    }));
}

export function flattenContentNodes(nodes: ContentTreeNodeVM[]): ContentTreeNodeVM[] {
  return nodes.flatMap((node) => [node, ...flattenContentNodes(node.children)]);
}

export function flattenAuxNodes(nodes: AuxTreeNodeVM[]): AuxTreeNodeVM[] {
  return nodes.flatMap((node) => [node, ...flattenAuxNodes(node.children)]);
}

export function buildContentParentMap(
  nodes: ContentTreeNodeVM[],
  parentId: string | null = null,
): Map<string, string | null> {
  const map = new Map<string, string | null>();

  for (const node of nodes) {
    map.set(node.id, parentId);
    for (const [childId, childParentId] of buildContentParentMap(node.children, node.id)) {
      map.set(childId, childParentId);
    }
  }

  return map;
}

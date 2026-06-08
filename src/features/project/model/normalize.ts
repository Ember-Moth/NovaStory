import type {
  AuxTreeNodeVM,
  ContentTreeNodeVM,
  RawAuxTreeNode,
  RawContentTreeNode,
  RawTimelinePoint,
  TimelinePointVM,
} from "./types";

export interface ContentTreeState {
  tree: ContentTreeNodeVM[];
  flatNodes: ContentTreeNodeVM[];
  nodeMap: Map<string, ContentTreeNodeVM>;
  parentMap: Map<string, string | null>;
}

export interface TimelineState {
  points: TimelinePointVM[];
  labelMap: Map<string, string>;
  idSet: Set<string>;
}

export interface AuxTreeState {
  tree: AuxTreeNodeVM[];
  nodeMap: Map<string, AuxTreeNodeVM>;
  parentMap: Map<string, string | null>;
  idSet: Set<string>;
}

function isAuxNodeType(
  nodeType: string,
): nodeType is RawAuxTreeNode["nodeType"] & ("dir" | "file" | "symlink") {
  return nodeType === "dir" || nodeType === "file" || nodeType === "symlink";
}

export function buildContentTreeState(nodes: RawContentTreeNode[]): ContentTreeState {
  const flatNodes: ContentTreeNodeVM[] = [];
  const nodeMap = new Map<string, ContentTreeNodeVM>();
  const parentMap = new Map<string, string | null>();

  const tree = nodes.map((node) => buildContentNode(node, null, flatNodes, nodeMap, parentMap));
  return { tree, flatNodes, nodeMap, parentMap };
}

function buildContentNode(
  node: RawContentTreeNode,
  parentId: string | null,
  flatNodes: ContentTreeNodeVM[],
  nodeMap: Map<string, ContentTreeNodeVM>,
  parentMap: Map<string, string | null>,
): ContentTreeNodeVM {
  const normalizedNode: ContentTreeNodeVM = {
    id: node.id,
    title: node.title?.trim() || "未命名节点",
    body: node.body ?? "",
    anchorTimelinePointId: node.anchorTimelinePointId,
    children: [],
  };

  flatNodes.push(normalizedNode);
  nodeMap.set(normalizedNode.id, normalizedNode);
  parentMap.set(normalizedNode.id, parentId);
  normalizedNode.children = node.children.map((child) =>
    buildContentNode(child, normalizedNode.id, flatNodes, nodeMap, parentMap),
  );
  return normalizedNode;
}

export function buildTimelineState(points: RawTimelinePoint[]): TimelineState {
  const normalizedPoints: TimelinePointVM[] = [];
  const labelMap = new Map<string, string>();
  const idSet = new Set<string>();

  for (const point of points) {
    const normalizedPoint: TimelinePointVM = {
      id: point.id,
      key: point.key,
      label: point.isImplicitOrigin ? "原点" : point.label,
      description: point.isImplicitOrigin ? "故事初始状态" : (point.description ?? ""),
      isImplicitOrigin: point.isImplicitOrigin,
    };

    normalizedPoints.push(normalizedPoint);
    labelMap.set(normalizedPoint.id, normalizedPoint.label);
    idSet.add(normalizedPoint.id);
  }

  return {
    points: normalizedPoints,
    labelMap,
    idSet,
  };
}

export function buildAuxTreeState(nodes: RawAuxTreeNode[]): AuxTreeState {
  const nodeMap = new Map<string, AuxTreeNodeVM>();
  const parentMap = new Map<string, string | null>();
  const idSet = new Set<string>();

  const tree = nodes.flatMap((node) => {
    const normalizedNode = buildAuxNode(node, null, nodeMap, parentMap, idSet);
    return normalizedNode ? [normalizedNode] : [];
  });

  return { tree, nodeMap, parentMap, idSet };
}

function buildAuxNode(
  node: RawAuxTreeNode,
  parentId: string | null,
  nodeMap: Map<string, AuxTreeNodeVM>,
  parentMap: Map<string, string | null>,
  idSet: Set<string>,
): AuxTreeNodeVM | null {
  if (!isAuxNodeType(node.nodeType)) {
    return null;
  }

  const normalizedNode: AuxTreeNodeVM = {
    id: node.id,
    nodeType: node.nodeType,
    name: node.name?.trim() || "(未命名)",
    content: node.content ?? "",
    path: node.path,
    symlinkTargetPath: node.symlinkTargetPath,
    hasTimelineChange: node.hasTimelineChange,
    isDeleted: node.isDeleted,
    children: [],
  };

  nodeMap.set(normalizedNode.id, normalizedNode);
  parentMap.set(normalizedNode.id, parentId);
  idSet.add(normalizedNode.id);
  normalizedNode.children = node.children.flatMap((child) => {
    const normalizedChild = buildAuxNode(child, normalizedNode.id, nodeMap, parentMap, idSet);
    return normalizedChild ? [normalizedChild] : [];
  });
  return normalizedNode;
}

import type {
  ExportedContentNode,
  ExportedContentSubtree,
  ResolvedAuxNode,
  TimelinePointView,
} from "@/modules/workspace/domain/types";

import type { AssistantToolSuccess } from "./envelope";

export const CONTENT_TITLE_CHAR_LIMIT = 240;
export const CONTENT_BODY_CHAR_LIMIT = 2_000;
export const WRITING_CONTEXT_AUX_LIMIT = 24;
export const CONTENT_SUBTREE_NODE_LIMIT = 40;
export const TIMELINE_POINT_LIMIT = 120;
export const TIMELINE_AUX_CHANGE_LIMIT = 200;
export const AUX_DIR_ENTRY_LIMIT = 80;

export function trimText(
  value: string | null | undefined,
  maxChars: number,
): { value: string | null; truncated: boolean } {
  if (value == null) {
    return {
      value: null,
      truncated: false,
    };
  }

  if (value.length <= maxChars) {
    return {
      value,
      truncated: false,
    };
  }

  return {
    value: `${value.slice(0, maxChars)}…`,
    truncated: true,
  };
}

export function limitContentNode(
  node: ExportedContentNode,
  state: { remaining: number; truncated: boolean },
): ExportedContentNode | null {
  if (state.remaining <= 0) {
    state.truncated = true;
    return null;
  }

  state.remaining -= 1;
  const title = trimText(node.title, CONTENT_TITLE_CHAR_LIMIT);
  const body = trimText(node.body, CONTENT_BODY_CHAR_LIMIT);
  let children: ExportedContentNode[] = [];

  for (const child of node.children) {
    const limitedChild = limitContentNode(child, state);
    if (!limitedChild) {
      break;
    }
    children.push(limitedChild);
  }

  if (children.length < node.children.length) {
    state.truncated = true;
  }

  if (title.truncated || body.truncated) {
    state.truncated = true;
  }

  return {
    ...node,
    title: title.value,
    body: body.value,
    children,
  };
}

export function limitContentSubtree(
  subtree: ExportedContentSubtree,
): AssistantToolSuccess<ExportedContentSubtree> {
  const state = {
    remaining: CONTENT_SUBTREE_NODE_LIMIT,
    truncated: false,
  };
  const nodes: ExportedContentNode[] = [];

  for (const node of subtree.nodes) {
    const limitedNode = limitContentNode(node, state);
    if (!limitedNode) {
      break;
    }
    nodes.push(limitedNode);
  }

  if (nodes.length < subtree.nodes.length) {
    state.truncated = true;
  }

  return {
    ok: true,
    truncated: state.truncated,
    data: {
      ...subtree,
      nodes,
    },
  };
}

export function sanitizeAuxNode(node: ResolvedAuxNode) {
  return {
    node,
    truncated: false,
  };
}

export function limitAuxNodes(nodes: ResolvedAuxNode[], maxEntries: number) {
  const limited = nodes.slice(0, maxEntries).map((node) => sanitizeAuxNode(node).node);
  const truncated = limited.length < nodes.length;

  return {
    nodes: limited,
    truncated,
  };
}

export function limitTimelinePoints(points: TimelinePointView[]) {
  return {
    points: points.slice(0, TIMELINE_POINT_LIMIT),
    truncated: points.length > TIMELINE_POINT_LIMIT,
  };
}

export function limitItems<T>(items: T[], maxItems: number) {
  return {
    items: items.slice(0, maxItems),
    truncated: items.length > maxItems,
  };
}

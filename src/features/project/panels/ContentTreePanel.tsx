import { motion } from "motion/react";
import {
  type PointerEvent as ReactPointerEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ContentNodeIcon } from "@/features/project/components/icons";
import { InlineEditableText } from "@/features/project/components/InlineEditableText";
import {
  ExpandToggle,
  RowActionButton,
  SidebarListRow,
  TreeNodePanel,
  rowPaddingLeft,
  type TreeRowContext,
} from "@/features/project/components/nodes";
import { PanelPlaceholder } from "@/features/project/components/PanelPlaceholder";
import { actionAnchorId } from "@/features/project/model/action-error";
import {
  collectContentSubtreeIds,
  resolveContentMove,
  type ContentDropPosition,
  type ContentMoveIntent,
} from "@/features/project/model/tree";
import type { ContentTreeNodeVM } from "@/features/project/model/types";
import { cn } from "@/shared/cn";

const CONTENT_ROW_SELECTOR = "[data-content-tree-row-id]";
const DRAG_START_DISTANCE = 4;

type ContentDropIntent = ContentMoveIntent;
type ContentBoundaryDrop = {
  type: "boundary";
  parentId: string | null;
  afterSiblingId: string | null;
  anchorId: string;
  depth: number;
  position: Exclude<ContentDropPosition, "inside">;
};

type BoundaryIndicatorRect = {
  top: number;
  left: number;
  width: number;
};

function dropPositionFromPointer(clientY: number, row: HTMLElement): ContentDropPosition {
  const rect = row.getBoundingClientRect();
  const ratio = (clientY - rect.top) / Math.max(rect.height, 1);

  if (ratio < 0.25) {
    return "before";
  }
  if (ratio > 0.75) {
    return "after";
  }
  return "inside";
}

function ContentTreeNodeRow({
  node,
  depth,
  hasChildren,
  isExpanded,
  isActive,
  onToggle,
  onSelect,
  onRename,
  onCreateChild,
  onDelete,
  onDragStart,
  onDragMove,
  onDragEnd,
  isInsideDropTarget,
  isDragging,
  isDragDisabled,
  timelineLabelMap,
  isBusy,
  canCreate,
}: {
  node: ContentTreeNodeVM;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  isActive: boolean;
  onToggle: (_id: string) => void;
  onSelect: (_node: ContentTreeNodeVM) => void;
  onRename: (_nodeId: string, _title: string | null) => Promise<boolean>;
  onCreateChild: (_node: ContentTreeNodeVM, _anchorId: string) => void;
  onDelete: (_id: string, _anchorId: string) => void;
  onDragStart: (_nodeId: string) => void;
  onDragMove: (_nodeId: string, _point: { x: number; y: number }) => void;
  onDragEnd: (_nodeId: string, _point: { x: number; y: number }) => void;
  isInsideDropTarget: boolean;
  isDragging: boolean;
  isDragDisabled: boolean;
  timelineLabelMap: ReadonlyMap<string, string>;
  isBusy: boolean;
  canCreate: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const pointerDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    dragging: boolean;
  } | null>(null);
  const hasBody = node.body.trim().length > 0;
  const rowAnchorId = actionAnchorId("content", "row", node.id);
  const addChildAnchorId = actionAnchorId("content", "add-child", node.id);
  const deleteAnchorId = actionAnchorId("content", "delete", node.id);
  const dragDisabled = isDragDisabled || isEditing;

  const handleDragPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (dragDisabled || event.button !== 0) {
      return;
    }

    pointerDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleDragPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const dragState = pointerDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const distance = Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY);
    if (!dragState.dragging) {
      if (distance < DRAG_START_DISTANCE) {
        return;
      }

      dragState.dragging = true;
      onDragStart(node.id);
    }

    event.preventDefault();
    onDragMove(node.id, { x: event.clientX, y: event.clientY });
  };

  const handleDragPointerEnd = (event: ReactPointerEvent<HTMLElement>) => {
    const dragState = pointerDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    pointerDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (dragState.dragging) {
      event.preventDefault();
      onDragEnd(node.id, { x: event.clientX, y: event.clientY });
    }
  };

  const dragStartProps = {
    onPointerDown: handleDragPointerDown,
    onPointerMove: handleDragPointerMove,
    onPointerUp: handleDragPointerEnd,
    onPointerCancel: handleDragPointerEnd,
  };

  return (
    <motion.div
      data-content-tree-row-id={node.id}
      className={cn(
        "relative list-none",
        isInsideDropTarget ? "bg-list-hover-background" : "",
        isDragging ? "pointer-events-none z-10 opacity-75 shadow-sm" : "",
      )}
      layout="position"
    >
      <SidebarListRow
        dataNodeId={node.id}
        depth={depth}
        isActive={isActive}
        group
        anchorId={rowAnchorId}
        className={isInsideDropTarget ? "outline-1 -outline-offset-1 outline-drag-border" : ""}
        onClick={() => {
          onSelect(node);
          if (hasChildren && !isExpanded) {
            onToggle(node.id);
          }
        }}
        leading={
          <ExpandToggle
            hasChildren={hasChildren}
            expanded={isExpanded}
            onToggle={() => onToggle(node.id)}
          />
        }
        icon={
          <span className="grid size-4 shrink-0 touch-none place-items-center" {...dragStartProps}>
            <ContentNodeIcon hasBody={hasBody} hasChildren={hasChildren} />
          </span>
        }
        label={
          <span className="min-w-0 flex-1 touch-none" {...dragStartProps}>
            <InlineEditableText
              value={node.title}
              disabled={isBusy}
              allowEmpty
              onEditStart={() => onSelect(node)}
              onEditingChange={setIsEditing}
              onCommit={async (next) => onRename(node.id, next || null)}
              placeholder="未命名节点"
              className="truncate"
            />
          </span>
        }
        trailing={timelineLabelMap.get(node.anchorTimelinePointId) ?? node.anchorTimelinePointId}
        actions={
          <>
            <RowActionButton
              anchorId={addChildAnchorId}
              onClick={() => onCreateChild(node, addChildAnchorId)}
              disabled={isBusy || isEditing || !canCreate}
              title="添加子节点"
              icon="icon-[material-symbols--add]"
            />
            <RowActionButton
              anchorId={deleteAnchorId}
              onClick={() => onDelete(node.id, deleteAnchorId)}
              disabled={isBusy || isEditing}
              title="删除节点"
              icon="icon-[material-symbols--close]"
            />
          </>
        }
      />
    </motion.div>
  );
}

function BoundaryDropIndicator({ rect }: { rect: BoundaryIndicatorRect }) {
  return (
    <span
      className="pointer-events-none absolute z-30 flex h-3 -translate-y-1/2 items-center"
      style={{ top: rect.top, left: rect.left, width: rect.width }}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-drag-border" />
      <span className="h-0.5 min-w-0 flex-1 rounded-full bg-drag-border" />
    </span>
  );
}

export function ContentTreePanel({
  tree,
  expandedIds,
  onToggle,
  onSelect,
  onRename,
  onCreateChild,
  onDelete,
  onMove,
  activeId,
  timelineLabelMap,
  isBusy,
  canCreate,
}: {
  tree: ContentTreeNodeVM[];
  expandedIds: Set<string>;
  onToggle: (_id: string) => void;
  onSelect: (_node: ContentTreeNodeVM) => void;
  onRename: (_nodeId: string, _title: string | null) => Promise<boolean>;
  onCreateChild: (_node: ContentTreeNodeVM, _anchorId: string) => void;
  onDelete: (_id: string, _anchorId: string) => void;
  onMove: (_intent: ContentMoveIntent) => void;
  activeId: string | null;
  timelineLabelMap: ReadonlyMap<string, string>;
  isBusy: boolean;
  canCreate: boolean;
}) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropIntent, setDropIntent] = useState<ContentDropIntent | null>(null);
  const [boundaryIndicatorRect, setBoundaryIndicatorRect] = useState<BoundaryIndicatorRect | null>(
    null,
  );
  const panelRef = useRef<HTMLDivElement>(null);
  const subtreeIdsRef = useRef<Set<string>>(new Set());
  const panelNodeMap = useMemo(() => buildPanelNodeMap(tree), [tree]);
  const panelParentMap = useMemo(() => buildPanelParentMap(tree), [tree]);
  const panelDepthMap = useMemo(() => buildPanelDepthMap(tree), [tree]);
  const visiblePreviousRowMap = useMemo(
    () => buildVisiblePreviousRowMap(tree, expandedIds),
    [expandedIds, tree],
  );
  const boundaryDrop = useMemo(
    () =>
      dropIntent && dropIntent.position !== "inside"
        ? resolveBoundaryDrop(dropIntent, panelParentMap, panelDepthMap, visiblePreviousRowMap)
        : null,
    [dropIntent, panelDepthMap, panelParentMap, visiblePreviousRowMap],
  );

  useLayoutEffect(() => {
    if (!boundaryDrop) {
      setBoundaryIndicatorRect(null);
      return;
    }

    const panelElement = panelRef.current;
    const anchorElement = panelElement?.querySelector(
      `[data-content-tree-row-id="${CSS.escape(boundaryDrop.anchorId)}"]`,
    );

    if (!panelElement || !(anchorElement instanceof HTMLElement)) {
      setBoundaryIndicatorRect(null);
      return;
    }

    const panelRect = panelElement.getBoundingClientRect();
    const anchorRect = anchorElement.getBoundingClientRect();
    const top =
      boundaryDrop.afterSiblingId === null
        ? anchorRect.top - panelRect.top
        : anchorRect.bottom - panelRect.top;
    const clampedTop = Math.min(Math.max(top, 1), Math.max(panelRect.height - 1, 1));
    const left = Math.max(rowPaddingLeft(boundaryDrop.depth) + 8, 8);
    const rightInset = 12;
    const width = Math.max(panelRect.width - left - rightInset, 24);

    setBoundaryIndicatorRect({
      top: clampedTop,
      left,
      width,
    });
  }, [boundaryDrop]);

  if (tree.length === 0) {
    return (
      <PanelPlaceholder
        icon="icon-[material-symbols--edit-note]"
        label="还没有正文节点。点击上方 + 创建。"
      />
    );
  }

  const findDropIntent = (nodeId: string, point: { x: number; y: number }) => {
    const source = document.elementFromPoint(point.x, point.y);
    const row = source?.closest(CONTENT_ROW_SELECTOR);

    if (!(row instanceof HTMLElement)) {
      return null;
    }

    const targetId = row.dataset.contentTreeRowId;
    if (!targetId || targetId === nodeId || subtreeIdsRef.current.has(targetId)) {
      return null;
    }

    const position = dropPositionFromPointer(point.y, row);
    const nextIntent = { nodeId, targetId, position };
    const resolved = resolveContentMove({
      tree,
      parentMap: panelParentMap,
      nodeMap: panelNodeMap,
      contentRootId: "__content_root__",
      ...nextIntent,
    });

    return resolved ? nextIntent : null;
  };

  const handleDragStart = (nodeId: string) => {
    const node = panelNodeMap.get(nodeId) ?? null;
    subtreeIdsRef.current = node ? collectContentSubtreeIds(node) : new Set([nodeId]);
    setDraggedId(nodeId);
    setDropIntent(null);
  };

  const handleDragMove = (nodeId: string, point: { x: number; y: number }) => {
    setDropIntent(findDropIntent(nodeId, point));
  };

  const handleDragEnd = (nodeId: string, point: { x: number; y: number }) => {
    const finalIntent = findDropIntent(nodeId, point) ?? dropIntent;
    setDraggedId(null);
    setDropIntent(null);
    setBoundaryIndicatorRect(null);
    subtreeIdsRef.current = new Set();

    if (finalIntent) {
      onMove(finalIntent);
    }
  };

  const renderRow = (ctx: TreeRowContext<ContentTreeNodeVM>) => (
    <ContentTreeNodeRow
      node={ctx.node}
      depth={ctx.depth}
      hasChildren={ctx.hasChildren}
      isExpanded={ctx.isExpanded}
      isActive={ctx.isActive}
      onToggle={onToggle}
      onSelect={onSelect}
      onRename={onRename}
      onCreateChild={onCreateChild}
      onDelete={onDelete}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      isInsideDropTarget={
        dropIntent?.targetId === ctx.node.id &&
        dropIntent.nodeId !== ctx.node.id &&
        dropIntent.position === "inside"
      }
      isDragging={draggedId === ctx.node.id}
      isDragDisabled={isBusy}
      timelineLabelMap={timelineLabelMap}
      isBusy={isBusy}
      canCreate={canCreate}
    />
  );

  return (
    <div ref={panelRef} className="relative pb-2">
      <TreeNodePanel
        nodes={tree}
        expandedIds={expandedIds}
        activeId={activeId}
        getId={(node) => node.id}
        getChildren={(node) => node.children}
        renderRow={renderRow}
      />
      {boundaryIndicatorRect ? <BoundaryDropIndicator rect={boundaryIndicatorRect} /> : null}
    </div>
  );
}

function resolveBoundaryDrop(
  intent: ContentMoveIntent & { position: Exclude<ContentDropPosition, "inside"> },
  parentMap: ReadonlyMap<string, string | null>,
  depthMap: ReadonlyMap<string, number>,
  previousRowMap: ReadonlyMap<string, string | null>,
): ContentBoundaryDrop {
  const parentId = parentMap.get(intent.targetId) ?? null;
  const previousRowId = previousRowMap.get(intent.targetId) ?? null;
  const afterSiblingId = intent.position === "before" ? previousRowId : intent.targetId;
  const targetDepth = depthMap.get(intent.targetId) ?? 0;
  return {
    type: "boundary",
    parentId,
    afterSiblingId,
    anchorId: intent.position === "before" ? (previousRowId ?? intent.targetId) : intent.targetId,
    depth: targetDepth,
    position: intent.position,
  };
}

function buildPanelNodeMap(nodes: ContentTreeNodeVM[]) {
  const map = new Map<string, ContentTreeNodeVM>();
  const walk = (node: ContentTreeNodeVM) => {
    map.set(node.id, node);
    for (const child of node.children) {
      walk(child);
    }
  };

  for (const node of nodes) {
    walk(node);
  }
  return map;
}

function buildPanelParentMap(nodes: ContentTreeNodeVM[], parentId: string | null = null) {
  const map = new Map<string, string | null>();
  for (const node of nodes) {
    map.set(node.id, parentId);
    for (const [childId, childParentId] of buildPanelParentMap(node.children, node.id)) {
      map.set(childId, childParentId);
    }
  }
  return map;
}

function buildPanelDepthMap(nodes: ContentTreeNodeVM[], depth = 0) {
  const map = new Map<string, number>();
  for (const node of nodes) {
    map.set(node.id, depth);
    for (const [childId, childDepth] of buildPanelDepthMap(node.children, depth + 1)) {
      map.set(childId, childDepth);
    }
  }
  return map;
}

function buildVisiblePreviousRowMap(nodes: ContentTreeNodeVM[], expandedIds: ReadonlySet<string>) {
  const map = new Map<string, string | null>();
  let previousId: string | null = null;

  const walk = (visibleNodes: ContentTreeNodeVM[]) => {
    for (const node of visibleNodes) {
      map.set(node.id, previousId);
      previousId = node.id;

      if (expandedIds.has(node.id)) {
        walk(node.children);
      }
    }
  };

  walk(nodes);
  return map;
}

import { AnimatePresence, motion } from "motion/react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

import { ContentNodeIcon } from "@/modules/workspace/ui/editor/components/icons";
import { InlineEditableText } from "@/shared/ui/InlineEditableText";
import {
  ExpandToggle,
  ROW_GESTURE_HIT_AREA_ATTRIBUTE,
  RowActionButton,
  SidebarListRow,
  TreeNodePanel,
  rowPaddingLeft,
  useRowPointerGesture,
  type TreeRowContext,
} from "@/shared/ui/tree";
import { PanelPlaceholder } from "@/shared/ui/PanelPlaceholder";
import { RefreshOverlay } from "@/shared/ui/RefreshOverlay";
import { actionAnchorId } from "@/modules/workspace/ui/editor/model/action-error";
import {
  collectContentSubtreeIds,
  resolveContentMove,
  type ContentDropPosition,
  type ContentMoveIntent,
} from "@/modules/workspace/ui/editor/model/tree";
import type { ContentTreeNodeVM } from "@/modules/workspace/ui/editor/model/types";
import { cn } from "@/shared/lib/cn";

const CONTENT_ROW_SELECTOR = "[data-row-id]";
type ContentDropIntent = ContentMoveIntent;
type ContentBoundaryIntent = ContentMoveIntent & {
  position: Exclude<ContentDropPosition, "inside">;
};
type ContentBoundaryDrop = {
  type: "boundary";
  parentId: string | null;
  afterSiblingId: string | null;
  anchorId: string;
  depth: number;
  position: Exclude<ContentDropPosition, "inside">;
};

type BoundaryIndicatorRect = {
  mode: "boundary";
  top: number;
  left: number;
  width: number;
};

type InsideIndicatorRect = {
  mode: "inside";
  top: number;
  left: number;
  width: number;
  height: number;
};

type DropIndicatorRect = BoundaryIndicatorRect | InsideIndicatorRect;

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

function isBoundaryDropIntent(intent: ContentDropIntent | null): intent is ContentBoundaryIntent {
  return intent !== null && intent.position !== "inside";
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
  isDragging: boolean;
  isDragDisabled: boolean;
  timelineLabelMap: ReadonlyMap<string, string>;
  isBusy: boolean;
  canCreate: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const hasBody = node.body.trim().length > 0;
  const rowAnchorId = actionAnchorId("content", "row", node.id);
  const addChildAnchorId = actionAnchorId("content", "add-child", node.id);
  const deleteAnchorId = actionAnchorId("content", "delete", node.id);
  const dragDisabled = isDragDisabled || isEditing;
  const labelHitAreaProps = { [ROW_GESTURE_HIT_AREA_ATTRIBUTE]: "label" } as const;
  const gesture = useRowPointerGesture({
    scope: "content",
    rowId: node.id,
    canStartDrag: !dragDisabled,
    onClick: () => {
      onSelect(node);
      if (hasChildren && !isExpanded) {
        onToggle(node.id);
      }
    },
    onDoubleClickLabel: () => {},
    onDragStart,
    onDragMove,
    onDragEnd,
  });

  return (
    <SidebarListRow
      layout="position"
      dataRowId={node.id}
      dataNodeId={node.id}
      depth={depth}
      isActive={isActive}
      isEditing={isEditing}
      group
      anchorId={rowAnchorId}
      className={cn(
        "relative list-none",
        isDragging ? "pointer-events-none z-10 opacity-75 shadow-sm" : "",
      )}
      onClick={gesture.handleClick}
      onPointerDown={gesture.handlePointerDown}
      leading={
        <ExpandToggle
          hasChildren={hasChildren}
          expanded={isExpanded}
          onToggle={() => onToggle(node.id)}
        />
      }
      icon={
        <span
          className="grid size-4 shrink-0 touch-none place-items-center"
          data-drag-handle={node.id}
        >
          <ContentNodeIcon hasBody={hasBody} hasChildren={hasChildren} />
        </span>
      }
      label={
        <span className="min-w-0 flex-1" {...labelHitAreaProps}>
          <InlineEditableText
            value={node.title}
            disabled={isBusy}
            allowEmpty
            onEditStart={() => onSelect(node)}
            onEditingChange={setIsEditing}
            onCommit={async (next) => onRename(node.id, next || null)}
            placeholder="未命名节点"
            className="truncate"
            displayClassName="select-none"
            startEditingSignal={gesture.startEditingSignal}
            nativeDoubleClickEnabled={false}
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
  );
}

function DropIndicatorOverlay({ rect }: { rect: DropIndicatorRect }) {
  const isInside = rect.mode === "inside";
  const top = isInside ? rect.top : rect.top - 6;
  const height = isInside ? rect.height : 12;

  return (
    <motion.span
      className="pointer-events-none absolute z-30 block"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{
        opacity: 1,
        scale: 1,
        top,
        left: rect.left,
        width: rect.width,
        height,
      }}
      exit={{
        opacity: 0,
        scale: 0.96,
        top,
        left: rect.left,
        width: rect.width,
        height,
      }}
      transition={{ duration: 0.14, ease: "easeOut" }}
      style={{
        top,
        left: rect.left,
        width: rect.width,
        height,
        originX: 0,
        originY: 0.5,
      }}
    >
      <motion.span
        className="absolute border border-drag-border bg-list-hover-background/40"
        animate={{
          inset: isInside ? 0 : "5px 0 5px 0",
          opacity: isInside ? 1 : 0,
        }}
        transition={{ duration: 0.14, ease: "easeOut" }}
      />
      <motion.span
        className="absolute top-1/2 left-0 size-1.5 -translate-y-1/2 rounded-full bg-drag-border"
        animate={{ opacity: isInside ? 0 : 1, scale: isInside ? 0.7 : 1 }}
        transition={{ duration: 0.12, ease: "easeOut" }}
      />
      <motion.span
        className="absolute top-1/2 right-0 left-1.5 h-0.5 -translate-y-1/2 rounded-full bg-drag-border"
        animate={{ opacity: isInside ? 0 : 1, scaleX: isInside ? 0.96 : 1 }}
        transition={{ duration: 0.12, ease: "easeOut" }}
        style={{ originX: 0 }}
      />
    </motion.span>
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
  isPending,
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
  isPending: boolean;
  canCreate: boolean;
}) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropIntent, setDropIntent] = useState<ContentDropIntent | null>(null);
  const [dropIndicatorRect, setDropIndicatorRect] = useState<DropIndicatorRect | null>(null);
  const [panelMinHeight, setPanelMinHeight] = useState<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const subtreeIdsRef = useRef<Set<string>>(new Set());
  const panelNodeMap = useMemo(() => buildPanelNodeMap(tree), [tree]);
  const panelParentMap = useMemo(() => buildPanelParentMap(tree), [tree]);
  const panelDepthMap = useMemo(() => buildPanelDepthMap(tree), [tree]);
  const visiblePreviousRowMap = useMemo(
    () => buildVisiblePreviousRowMap(tree, expandedIds),
    [expandedIds, tree],
  );
  const visibleSubtreeTailMap = useMemo(
    () => buildVisibleSubtreeTailMap(tree, expandedIds),
    [expandedIds, tree],
  );
  const boundaryDrop = useMemo(
    () =>
      isBoundaryDropIntent(dropIntent)
        ? resolveBoundaryDrop(
            dropIntent,
            panelParentMap,
            panelDepthMap,
            visiblePreviousRowMap,
            visibleSubtreeTailMap,
          )
        : null,
    [dropIntent, panelDepthMap, panelParentMap, visiblePreviousRowMap, visibleSubtreeTailMap],
  );

  useLayoutEffect(() => {
    const panelElement = panelRef.current;
    const viewportElement = panelElement?.closest(".simplebar-content")?.parentElement;
    if (!(panelElement instanceof HTMLElement) || !(viewportElement instanceof HTMLElement)) {
      setPanelMinHeight(null);
      return;
    }

    const updateMinHeight = () => {
      setPanelMinHeight(viewportElement.clientHeight);
    };

    updateMinHeight();
    const observer = new ResizeObserver(() => {
      updateMinHeight();
    });
    observer.observe(viewportElement);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (dropIntent?.position === "inside") {
      const panelElement = panelRef.current;
      const targetElement = panelElement?.querySelector(
        `[data-row-id="${CSS.escape(dropIntent.targetId)}"]`,
      );
      const tailId = visibleSubtreeTailMap.get(dropIntent.targetId) ?? dropIntent.targetId;
      const tailElement = panelElement?.querySelector(`[data-row-id="${CSS.escape(tailId)}"]`);

      if (
        !panelElement ||
        !(targetElement instanceof HTMLElement) ||
        !(tailElement instanceof HTMLElement)
      ) {
        setDropIndicatorRect(null);
        return;
      }

      const panelRect = panelElement.getBoundingClientRect();
      const targetRect = targetElement.getBoundingClientRect();
      const tailRect = tailElement.getBoundingClientRect();
      setDropIndicatorRect({
        mode: "inside",
        top: targetRect.top - panelRect.top,
        left: Math.max(targetRect.left - panelRect.left, 0),
        width: Math.max(targetRect.width, 24),
        height: Math.max(tailRect.bottom - targetRect.top, targetRect.height),
      });
      return;
    }

    if (!boundaryDrop) {
      setDropIndicatorRect(null);
      return;
    }

    const panelElement = panelRef.current;
    const anchorElement = panelElement?.querySelector(
      `[data-row-id="${CSS.escape(boundaryDrop.anchorId)}"]`,
    );

    if (!panelElement || !(anchorElement instanceof HTMLElement)) {
      setDropIndicatorRect(null);
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
    const width = Math.max(panelRect.width - left, 24);

    setDropIndicatorRect({
      mode: "boundary",
      top: clampedTop,
      left,
      width,
    });
  }, [boundaryDrop, dropIntent, visibleSubtreeTailMap]);

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
      return findBlankAreaDropIntent(nodeId, point);
    }

    const targetId = row.dataset.rowId;
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

  const findBlankAreaDropIntent = (nodeId: string, point: { x: number; y: number }) => {
    const panelElement = panelRef.current;
    const lastTopLevelNode = tree.at(-1);
    if (!panelElement || !lastTopLevelNode) {
      return null;
    }

    const panelRect = panelElement.getBoundingClientRect();
    if (
      point.x < panelRect.left ||
      point.x > panelRect.right ||
      point.y < panelRect.top ||
      point.y > panelRect.bottom
    ) {
      return null;
    }

    const visibleRows = panelElement.querySelectorAll(CONTENT_ROW_SELECTOR);
    const lastVisibleRow = visibleRows.item(visibleRows.length - 1);
    if (!(lastVisibleRow instanceof HTMLElement)) {
      return null;
    }

    if (point.y < lastVisibleRow.getBoundingClientRect().bottom) {
      return null;
    }

    const nextIntent = {
      nodeId,
      targetId: lastTopLevelNode.id,
      position: "after" as const,
    };
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
    setDropIndicatorRect(null);
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
      isDragging={draggedId === ctx.node.id}
      isDragDisabled={isBusy}
      timelineLabelMap={timelineLabelMap}
      isBusy={isBusy}
      canCreate={canCreate}
    />
  );

  return (
    <div
      ref={panelRef}
      className="relative min-h-full pb-2"
      style={panelMinHeight == null ? undefined : { minHeight: panelMinHeight }}
      aria-busy={isPending}
    >
      <RefreshOverlay active={isPending} />
      <div
        inert={isPending}
        className={`transition-opacity duration-150 ease-out motion-reduce:transition-none ${
          isPending ? "pointer-events-none opacity-70 select-none" : "opacity-100"
        }`}
      >
        <TreeNodePanel
          nodes={tree}
          expandedIds={expandedIds}
          activeId={activeId}
          getId={(node) => node.id}
          getChildren={(node) => node.children}
          renderRow={renderRow}
        />
        <AnimatePresence>
          {dropIndicatorRect ? (
            <DropIndicatorOverlay key="content-drop-indicator" rect={dropIndicatorRect} />
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}

function resolveBoundaryDrop(
  intent: ContentBoundaryIntent,
  parentMap: ReadonlyMap<string, string | null>,
  depthMap: ReadonlyMap<string, number>,
  previousRowMap: ReadonlyMap<string, string | null>,
  subtreeTailMap: ReadonlyMap<string, string>,
): ContentBoundaryDrop {
  const parentId = parentMap.get(intent.targetId) ?? null;
  const previousRowId = previousRowMap.get(intent.targetId) ?? null;
  const afterSiblingId = intent.position === "before" ? previousRowId : intent.targetId;
  const targetDepth = depthMap.get(intent.targetId) ?? 0;
  const afterAnchorId = subtreeTailMap.get(intent.targetId) ?? intent.targetId;
  return {
    type: "boundary",
    parentId,
    afterSiblingId,
    anchorId: intent.position === "before" ? (previousRowId ?? intent.targetId) : afterAnchorId,
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

function buildVisibleSubtreeTailMap(nodes: ContentTreeNodeVM[], expandedIds: ReadonlySet<string>) {
  const map = new Map<string, string>();

  const walk = (visibleNodes: ContentTreeNodeVM[]) => {
    for (const node of visibleNodes) {
      map.set(node.id, findVisibleSubtreeTailId(node, expandedIds));
      if (expandedIds.has(node.id)) {
        walk(node.children);
      }
    }
  };

  walk(nodes);
  return map;
}

function findVisibleSubtreeTailId(node: ContentTreeNodeVM, expandedIds: ReadonlySet<string>) {
  if (!expandedIds.has(node.id) || node.children.length === 0) {
    return node.id;
  }

  return findVisibleSubtreeTailId(node.children[node.children.length - 1]!, expandedIds);
}

import { AnimatePresence, motion } from "motion/react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

import { AuxNodeIcon } from "@/modules/workspace/ui/editor/components/icons";
import { InlineEditableText } from "@/shared/ui/InlineEditableText";
import {
  ExpandToggle,
  ROW_GESTURE_HIT_AREA_ATTRIBUTE,
  RowActionButton,
  SidebarListRow,
  TreeNodePanel,
  useRowPointerGesture,
  type TreeRowContext,
} from "@/shared/ui/tree";
import { PanelPlaceholder } from "@/shared/ui/PanelPlaceholder";
import { RefreshOverlay } from "@/shared/ui/RefreshOverlay";
import { actionAnchorId } from "@/modules/workspace/ui/editor/model/action-error";
import {
  buildAuxParentMap,
  collectAuxSubtreeIds,
  resolveAuxHierarchyMove,
  type AuxHierarchyMoveIntent,
} from "@/modules/workspace/ui/editor/model/tree";
import type { AuxTreeNodeVM } from "@/modules/workspace/ui/editor/model/types";
import { cn } from "@/shared/lib/cn";

const AUX_ROW_SELECTOR = "[data-row-id]";
type AuxDropIndicatorTarget = { mode: "node"; nodeId: string } | { mode: "root" };

type DropIndicatorRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

type AuxSymlinkTargetPickerState = {
  active: boolean;
  sourceNodeId: string | null;
  selectedTargetNodeId: string | null;
  invalidTargetNodeIds: ReadonlySet<string>;
  onPickTarget: (_targetPath: string) => void;
};

function AuxTreeNodeRow({
  node,
  depth,
  hasChildren,
  isExpanded,
  isActive,
  onToggle,
  onSelect,
  onRename,
  onCreateChildDir,
  onCreateChildFile,
  onCreateSymlink,
  onStartRetargetSymlink,
  onDelete,
  onRestoreDeleted,
  onDragStart,
  onDragMove,
  onDragEnd,
  isDragging,
  isBusy,
  showTimelineChanges,
  symlinkTargetPicker,
}: {
  node: AuxTreeNodeVM;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  isActive: boolean;
  onToggle: (_id: string) => void;
  onSelect: (_node: AuxTreeNodeVM) => void;
  onRename: (_nodeId: string, _name: string) => Promise<boolean>;
  onCreateChildDir: (_node: AuxTreeNodeVM, _anchorId: string) => void;
  onCreateChildFile: (_node: AuxTreeNodeVM, _anchorId: string) => void;
  onCreateSymlink: (_node: AuxTreeNodeVM, _anchorId: string) => void;
  onStartRetargetSymlink: (_node: AuxTreeNodeVM, _anchorId: string) => void;
  onDelete: (_id: string, _anchorId: string) => void;
  onRestoreDeleted: (_id: string, _anchorId: string) => void;
  onDragStart: (_nodeId: string) => void;
  onDragMove: (_nodeId: string, _point: { x: number; y: number }) => void;
  onDragEnd: (_nodeId: string, _point: { x: number; y: number }) => void;
  isDragging: boolean;
  isBusy: boolean;
  showTimelineChanges: boolean;
  symlinkTargetPicker: AuxSymlinkTargetPickerState;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const isDir = node.nodeType === "dir";
  const isDeleted = node.overlayStatus === "deleted";
  const isSymlinkTargetPickerActive = symlinkTargetPicker.active;
  const isSymlinkTargetSource = symlinkTargetPicker.sourceNodeId === node.id;
  const isSymlinkTargetSelected = symlinkTargetPicker.selectedTargetNodeId === node.id;
  const isSymlinkTargetDisabled = symlinkTargetPicker.invalidTargetNodeIds.has(node.id);
  const dragDisabled = isBusy || isEditing || isSymlinkTargetPickerActive || isDeleted;
  const dragHandleId = !isSymlinkTargetPickerActive && !isDeleted ? node.id : undefined;
  const contentStateClass = isDeleted
    ? "text-deleted-foreground/65"
    : showTimelineChanges && !node.hasTimelineChange
      ? "opacity-55"
      : "opacity-100";
  const labelStateClass = cn(
    contentStateClass,
    isDeleted ? "line-through decoration-deleted-foreground/65 decoration-1" : "",
  );
  const rowAnchorId = actionAnchorId("aux", "row", node.id);
  const addDirAnchorId = actionAnchorId("aux", "add-dir", node.id);
  const addFileAnchorId = actionAnchorId("aux", "add-file", node.id);
  const createSymlinkAnchorId = actionAnchorId("aux", "create-symlink", node.id);
  const retargetSymlinkAnchorId = actionAnchorId("aux", "retarget-symlink", node.id);
  const deleteAnchorId = actionAnchorId("aux", "delete", node.id);
  const restoreDeletedAnchorId = actionAnchorId("aux", "restore-deleted", node.id);
  const labelHitAreaProps = { [ROW_GESTURE_HIT_AREA_ATTRIBUTE]: "label" } as const;
  const symlinkTargetPickerState: "source" | "selected-target" | "disabled-target" | undefined =
    isSymlinkTargetSource
      ? "source"
      : isSymlinkTargetSelected
        ? "selected-target"
        : isSymlinkTargetDisabled
          ? "disabled-target"
          : undefined;

  const handleTargetPickerSelect = () => {
    if (
      !isSymlinkTargetPickerActive ||
      isSymlinkTargetDisabled ||
      isSymlinkTargetSource ||
      isSymlinkTargetSelected
    ) {
      return;
    }

    symlinkTargetPicker.onPickTarget(node.id);
  };
  const gesture = useRowPointerGesture({
    scope: "aux",
    rowId: node.id,
    canStartDrag: !dragDisabled,
    onClick: isSymlinkTargetPickerActive
      ? handleTargetPickerSelect
      : isDeleted
        ? () => {}
        : () => {
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

  const icon = (
    <span
      className={`inline-flex shrink-0 touch-none items-center ${contentStateClass}`}
      data-drag-handle={dragHandleId}
    >
      <AuxNodeIcon
        nodeType={isDir ? (isExpanded ? "dir-open" : "dir") : node.nodeType}
        className={isDeleted ? "text-deleted-foreground/65" : undefined}
      />
    </span>
  );

  const label = (
    <span className={cn("min-w-0 flex-1", labelStateClass)} {...labelHitAreaProps}>
      <InlineEditableText
        value={node.name}
        disabled={isBusy || isSymlinkTargetPickerActive || isDeleted}
        onEditStart={() => {
          if (isDeleted) return;
          onSelect(node);
        }}
        onEditingChange={setIsEditing}
        onCommit={async (next) => onRename(node.id, next)}
        className="truncate"
        displayClassName="select-none"
        startEditingSignal={gesture.startEditingSignal}
        nativeDoubleClickEnabled={false}
      />
    </span>
  );

  const sharedProps = {
    layout: "position" as const,
    dataRowId: node.id,
    dataNodeId: node.id,
    depth,
    isActive,
    isEditing,
    group: !isSymlinkTargetPickerActive,
    anchorId: rowAnchorId,
    dataSymlinkTargetPickerState: symlinkTargetPickerState,
    className: cn(
      "relative list-none",
      isSymlinkTargetSelected && !isActive
        ? "bg-list-hover-background ring-1 ring-inset ring-drag-border"
        : "",
      isSymlinkTargetPickerActive && isSymlinkTargetDisabled && !isSymlinkTargetSource
        ? "opacity-45"
        : "",
      isDragging ? "pointer-events-none z-10 opacity-75 shadow-sm" : "",
    ),
  };

  const deletedActions = isSymlinkTargetPickerActive ? null : (
    <RowActionButton
      anchorId={restoreDeletedAnchorId}
      onClick={() => onRestoreDeleted(node.id, restoreDeletedAnchorId)}
      disabled={isBusy || isEditing}
      title="恢复删除的辅助资料"
      icon="icon-[material-symbols--restore-from-trash]"
    />
  );

  if (isDir) {
    return (
      <SidebarListRow
        {...sharedProps}
        onClick={gesture.handleClick}
        onPointerDown={gesture.handlePointerDown}
        leading={
          <ExpandToggle
            hasChildren={hasChildren && !isDeleted}
            expanded={isExpanded && !isDeleted}
            onToggle={() => onToggle(node.id)}
          />
        }
        icon={icon}
        label={label}
        actions={
          isDeleted ? (
            deletedActions
          ) : isSymlinkTargetPickerActive ? null : (
            <>
              <RowActionButton
                anchorId={addDirAnchorId}
                onClick={() => onCreateChildDir(node, addDirAnchorId)}
                disabled={isBusy || isEditing}
                title="添加子文件夹"
                icon="icon-[material-symbols--create-new-folder]"
              />
              <RowActionButton
                anchorId={addFileAnchorId}
                onClick={() => onCreateChildFile(node, addFileAnchorId)}
                disabled={isBusy || isEditing}
                title="添加子文件"
                icon="icon-[material-symbols--note-add]"
              />
              <RowActionButton
                anchorId={createSymlinkAnchorId}
                onClick={() => onCreateSymlink(node, createSymlinkAnchorId)}
                disabled={isBusy || isEditing}
                title="在同目录创建符号链接"
                icon="icon-[material-symbols--link]"
              />
              <RowActionButton
                anchorId={deleteAnchorId}
                onClick={() => onDelete(node.id, deleteAnchorId)}
                disabled={isBusy || isEditing}
                title="删除节点"
                icon="icon-[material-symbols--close]"
              />
            </>
          )
        }
      />
    );
  }

  return (
    <SidebarListRow
      {...sharedProps}
      onClick={gesture.handleClick}
      onPointerDown={gesture.handlePointerDown}
      leading={<ExpandToggle hasChildren={false} expanded={false} />}
      icon={icon}
      label={label}
      trailing={
        node.nodeType === "symlink" && node.symlinkTargetPath
          ? `→ ${node.symlinkTargetPath}`
          : undefined
      }
      actions={
        isDeleted ? (
          deletedActions
        ) : isSymlinkTargetPickerActive ? null : (
          <>
            {node.nodeType === "symlink" ? (
              <RowActionButton
                anchorId={retargetSymlinkAnchorId}
                onClick={() => onStartRetargetSymlink(node, retargetSymlinkAnchorId)}
                disabled={isBusy || isEditing}
                title="修改符号链接目标"
                icon="icon-[material-symbols--target]"
              />
            ) : null}
            <RowActionButton
              anchorId={createSymlinkAnchorId}
              onClick={() => onCreateSymlink(node, createSymlinkAnchorId)}
              disabled={isBusy || isEditing}
              title="在同目录创建符号链接"
              icon="icon-[material-symbols--link]"
            />
            <RowActionButton
              anchorId={deleteAnchorId}
              onClick={() => onDelete(node.id, deleteAnchorId)}
              disabled={isBusy || isEditing}
              title="删除节点"
              icon="icon-[material-symbols--close]"
            />
          </>
        )
      }
    />
  );
}

function DropIndicatorOverlay({ rect }: { rect: DropIndicatorRect }) {
  return (
    <motion.span
      className="pointer-events-none absolute z-30 block"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{
        opacity: 1,
        scale: 1,
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      }}
      exit={{
        opacity: 0,
        scale: 0.96,
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      }}
      transition={{ duration: 0.14, ease: "easeOut" }}
      style={{
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        originX: 0,
        originY: 0.5,
      }}
    >
      <span className="absolute inset-0 border border-drag-border bg-list-hover-background/40" />
    </motion.span>
  );
}

export function AuxTreePanel({
  tree,
  rootId,
  expandedIds,
  onToggle,
  activeId,
  onSelect,
  onRename,
  onCreateChildDir,
  onCreateChildFile,
  onCreateSymlink,
  onStartRetargetSymlink,
  onMove,
  onDelete,
  onRestoreDeleted,
  symlinkTargetPicker,
  isBusy,
  isPending,
  showTimelineChanges,
}: {
  tree: AuxTreeNodeVM[];
  rootId: string | null;
  expandedIds: Set<string>;
  onToggle: (_id: string) => void;
  activeId: string | null;
  onSelect: (_node: AuxTreeNodeVM) => void;
  onRename: (_nodeId: string, _name: string) => Promise<boolean>;
  onCreateChildDir: (_node: AuxTreeNodeVM, _anchorId: string) => void;
  onCreateChildFile: (_node: AuxTreeNodeVM, _anchorId: string) => void;
  onCreateSymlink: (_node: AuxTreeNodeVM, _anchorId: string) => void;
  onStartRetargetSymlink: (_node: AuxTreeNodeVM, _anchorId: string) => void;
  onMove: (_intent: AuxHierarchyMoveIntent) => void;
  onDelete: (_id: string, _anchorId: string) => void;
  onRestoreDeleted: (_id: string, _anchorId: string) => void;
  symlinkTargetPicker: AuxSymlinkTargetPickerState;
  isBusy: boolean;
  isPending: boolean;
  showTimelineChanges: boolean;
}) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropIntent, setDropIntent] = useState<AuxHierarchyMoveIntent | null>(null);
  const [dropIndicatorRect, setDropIndicatorRect] = useState<DropIndicatorRect | null>(null);
  const [panelMinHeight, setPanelMinHeight] = useState<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const subtreeIdsRef = useRef<Set<string>>(new Set());
  const panelNodeMap = useMemo(() => buildPanelNodeMap(tree), [tree]);
  const panelParentMap = useMemo(() => buildAuxParentMap(tree), [tree]);
  const visibleSubtreeTailMap = useMemo(
    () => buildVisibleSubtreeTailMap(tree, expandedIds),
    [expandedIds, tree],
  );
  const dropIndicatorTarget = useMemo(
    () => resolveDropIndicatorTarget(dropIntent, panelNodeMap, panelParentMap, rootId),
    [dropIntent, panelNodeMap, panelParentMap, rootId],
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
    const panelElement = panelRef.current;
    if (!panelElement || !dropIndicatorTarget) {
      setDropIndicatorRect(null);
      return;
    }

    const panelRect = panelElement.getBoundingClientRect();

    if (dropIndicatorTarget.mode === "root") {
      const visibleRows = panelElement.querySelectorAll(AUX_ROW_SELECTOR);
      const firstVisibleRow = visibleRows.item(0);
      const lastVisibleRow = visibleRows.item(visibleRows.length - 1);
      if (!(firstVisibleRow instanceof HTMLElement) || !(lastVisibleRow instanceof HTMLElement)) {
        setDropIndicatorRect(null);
        return;
      }

      const firstRect = firstVisibleRow.getBoundingClientRect();
      const lastRect = lastVisibleRow.getBoundingClientRect();
      const top = Math.max(firstRect.top - panelRect.top, 0);
      const left = 0;
      const width = Math.max(panelRect.width, 24);
      const bottom = Math.max(panelRect.height, lastRect.bottom - panelRect.top);
      const height = Math.max(bottom - top, firstRect.height);
      setDropIndicatorRect({ top, left, width, height });
      return;
    }

    const targetElement = panelElement.querySelector(
      `[data-row-id="${CSS.escape(dropIndicatorTarget.nodeId)}"]`,
    );
    const tailId =
      visibleSubtreeTailMap.get(dropIndicatorTarget.nodeId) ?? dropIndicatorTarget.nodeId;
    const tailElement = panelElement.querySelector(`[data-row-id="${CSS.escape(tailId)}"]`);
    if (!(targetElement instanceof HTMLElement) || !(tailElement instanceof HTMLElement)) {
      setDropIndicatorRect(null);
      return;
    }

    const targetRect = targetElement.getBoundingClientRect();
    const tailRect = tailElement.getBoundingClientRect();
    setDropIndicatorRect({
      top: targetRect.top - panelRect.top,
      left: Math.max(targetRect.left - panelRect.left, 0),
      width: Math.max(targetRect.width, 24),
      height: Math.max(tailRect.bottom - targetRect.top, targetRect.height),
    });
  }, [dropIndicatorTarget, visibleSubtreeTailMap]);

  if (tree.length === 0) {
    return (
      <PanelPlaceholder
        icon="icon-[material-symbols--folder-off]"
        label="还没有辅助信息。点击上方按钮创建。"
      />
    );
  }

  const findDropIntent = (nodeId: string, point: { x: number; y: number }) => {
    const source = document.elementFromPoint(point.x, point.y);
    const row = source?.closest(AUX_ROW_SELECTOR);

    if (!(row instanceof HTMLElement)) {
      return findBlankAreaDropIntent(nodeId, point);
    }

    const targetId = row.dataset.rowId;
    if (!targetId || targetId === nodeId || subtreeIdsRef.current.has(targetId)) {
      return null;
    }
    const targetNode = panelNodeMap.get(targetId);
    if (targetNode?.overlayStatus === "deleted") {
      return null;
    }

    const nextIntent = { nodeId, targetId };
    const resolved = resolveAuxHierarchyMove({
      parentMap: panelParentMap,
      nodeMap: panelNodeMap,
      auxRootPath: rootId,
      ...nextIntent,
    });
    return resolved ? nextIntent : null;
  };

  const findBlankAreaDropIntent = (nodeId: string, point: { x: number; y: number }) => {
    const panelElement = panelRef.current;
    if (!panelElement) {
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

    const visibleRows = panelElement.querySelectorAll(AUX_ROW_SELECTOR);
    const lastVisibleRow = visibleRows.item(visibleRows.length - 1);
    if (!(lastVisibleRow instanceof HTMLElement)) {
      return null;
    }

    if (point.y < lastVisibleRow.getBoundingClientRect().bottom) {
      return null;
    }

    const nextIntent = {
      nodeId,
      targetId: null,
    };
    const resolved = resolveAuxHierarchyMove({
      parentMap: panelParentMap,
      nodeMap: panelNodeMap,
      auxRootPath: rootId,
      ...nextIntent,
    });
    return resolved ? nextIntent : null;
  };

  const handleDragStart = (nodeId: string) => {
    const node = panelNodeMap.get(nodeId) ?? null;
    if (node?.overlayStatus === "deleted") {
      return;
    }
    subtreeIdsRef.current = node ? collectAuxSubtreeIds(node) : new Set([nodeId]);
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

  const renderRow = (ctx: TreeRowContext<AuxTreeNodeVM>) => (
    <AuxTreeNodeRow
      node={ctx.node}
      depth={ctx.depth}
      hasChildren={ctx.hasChildren}
      isExpanded={ctx.isExpanded}
      isActive={ctx.isActive}
      onToggle={onToggle}
      onSelect={onSelect}
      onRename={onRename}
      onCreateChildDir={onCreateChildDir}
      onCreateChildFile={onCreateChildFile}
      onCreateSymlink={onCreateSymlink}
      onStartRetargetSymlink={onStartRetargetSymlink}
      onDelete={onDelete}
      onRestoreDeleted={onRestoreDeleted}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      isDragging={draggedId === ctx.node.id}
      isBusy={isBusy}
      showTimelineChanges={showTimelineChanges}
      symlinkTargetPicker={symlinkTargetPicker}
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
            <DropIndicatorOverlay key="aux-drop-indicator" rect={dropIndicatorRect} />
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}

function buildPanelNodeMap(nodes: AuxTreeNodeVM[]) {
  const map = new Map<string, AuxTreeNodeVM>();

  const walk = (currentNodes: AuxTreeNodeVM[]) => {
    for (const node of currentNodes) {
      map.set(node.id, node);
      walk(node.children);
    }
  };

  walk(nodes);
  return map;
}

function buildVisibleSubtreeTailMap(nodes: AuxTreeNodeVM[], expandedIds: ReadonlySet<string>) {
  const map = new Map<string, string>();

  const walk = (visibleNodes: AuxTreeNodeVM[]) => {
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

function findVisibleSubtreeTailId(node: AuxTreeNodeVM, expandedIds: ReadonlySet<string>) {
  if (!expandedIds.has(node.id) || node.children.length === 0) {
    return node.id;
  }

  return findVisibleSubtreeTailId(node.children[node.children.length - 1]!, expandedIds);
}

function resolveDropIndicatorTarget(
  intent: AuxHierarchyMoveIntent | null,
  nodeMap: ReadonlyMap<string, AuxTreeNodeVM>,
  parentMap: ReadonlyMap<string, string | null>,
  rootId: string | null,
): AuxDropIndicatorTarget | null {
  if (!intent) {
    return null;
  }

  if (intent.targetId === null) {
    return { mode: "root" };
  }

  const target = nodeMap.get(intent.targetId);
  if (!target) {
    return null;
  }

  if (target.nodeType === "dir") {
    return { mode: "node", nodeId: target.id };
  }

  const parentId = parentMap.get(target.id) ?? rootId;
  if (!parentId) {
    return null;
  }

  if (parentId === rootId) {
    return { mode: "root" };
  }

  return { mode: "node", nodeId: parentId };
}

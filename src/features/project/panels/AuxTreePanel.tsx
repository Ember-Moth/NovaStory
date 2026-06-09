import { useState } from "react";

import { AuxNodeIcon } from "@/features/project/components/icons";
import { InlineEditableText } from "@/features/project/components/InlineEditableText";
import {
  ExpandToggle,
  RowActionButton,
  SidebarListRow,
  TreeNodePanel,
  type TreeRowContext,
} from "@/features/project/components/nodes";
import { PanelPlaceholder } from "@/features/project/components/PanelPlaceholder";
import { RefreshOverlay } from "@/features/project/components/RefreshOverlay";
import { actionAnchorId } from "@/features/project/model/action-error";
import type { AuxTreeNodeVM } from "@/features/project/model/types";

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
  onDelete,
  onRestore,
  isBusy,
  showTimelineChanges,
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
  onDelete: (_id: string, _anchorId: string) => void;
  onRestore: (_id: string, _anchorId: string) => void;
  isBusy: boolean;
  showTimelineChanges: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const isDir = node.nodeType === "dir";
  const isDeleted = node.isDeleted;
  const contentStateClass = isDeleted
    ? "text-red-300 opacity-55"
    : showTimelineChanges && !node.hasTimelineChange
      ? "opacity-55"
      : "opacity-100";
  const rowAnchorId = actionAnchorId("aux", "row", node.id);
  const addDirAnchorId = actionAnchorId("aux", "add-dir", node.id);
  const addFileAnchorId = actionAnchorId("aux", "add-file", node.id);
  const deleteAnchorId = actionAnchorId("aux", "delete", node.id);
  const restoreAnchorId = actionAnchorId("aux", "restore", node.id);
  const canRestore = showTimelineChanges && node.hasTimelineChange;

  const icon = (
    <span className={`inline-flex shrink-0 items-center ${contentStateClass}`}>
      <AuxNodeIcon nodeType={isDir ? (isExpanded ? "dir-open" : "dir") : node.nodeType} />
    </span>
  );

  const label = (
    <span className={`min-w-0 flex-1 ${contentStateClass}`}>
      <InlineEditableText
        value={node.name}
        disabled={isBusy || isDeleted}
        onEditStart={() => {
          if (!isDeleted) {
            onSelect(node);
          }
        }}
        onEditingChange={setIsEditing}
        onCommit={async (next) => onRename(node.id, next)}
        className="truncate"
      />
    </span>
  );

  if (isDir) {
    return (
      <SidebarListRow
        depth={depth}
        isActive={isActive}
        group
        anchorId={rowAnchorId}
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
        icon={icon}
        label={label}
        actions={
          <>
            {canRestore ? (
              <RowActionButton
                anchorId={restoreAnchorId}
                onClick={() => onRestore(node.id, restoreAnchorId)}
                disabled={isBusy || isEditing}
                title="恢复到上一时间点状态"
                icon="icon-[material-symbols--undo]"
              />
            ) : null}
            {isDeleted ? null : (
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
                  anchorId={deleteAnchorId}
                  onClick={() => onDelete(node.id, deleteAnchorId)}
                  disabled={isBusy || isEditing}
                  title="删除节点"
                  icon="icon-[material-symbols--close]"
                />
              </>
            )}
          </>
        }
      />
    );
  }

  return (
    <SidebarListRow
      depth={depth}
      isActive={isActive}
      group
      anchorId={rowAnchorId}
      onClick={() => onSelect(node)}
      leading={<ExpandToggle hasChildren={false} expanded={false} />}
      icon={icon}
      label={label}
      trailing={
        node.nodeType === "symlink" && node.symlinkTargetPath
          ? `→ ${node.symlinkTargetPath}`
          : undefined
      }
      actions={
        <>
          {canRestore ? (
            <RowActionButton
              anchorId={restoreAnchorId}
              onClick={() => onRestore(node.id, restoreAnchorId)}
              disabled={isBusy || isEditing}
              title="恢复到上一时间点状态"
              icon="icon-[material-symbols--undo]"
            />
          ) : null}
          {isDeleted ? null : (
            <RowActionButton
              anchorId={deleteAnchorId}
              onClick={() => onDelete(node.id, deleteAnchorId)}
              disabled={isBusy || isEditing}
              title="删除节点"
              icon="icon-[material-symbols--close]"
            />
          )}
        </>
      }
    />
  );
}

export function AuxTreePanel({
  tree,
  expandedIds,
  onToggle,
  activeId,
  onSelect,
  onRename,
  onCreateChildDir,
  onCreateChildFile,
  onDelete,
  onRestore,
  isBusy,
  isRefreshing,
  showTimelineChanges,
}: {
  tree: AuxTreeNodeVM[];
  expandedIds: Set<string>;
  onToggle: (_id: string) => void;
  activeId: string | null;
  onSelect: (_node: AuxTreeNodeVM) => void;
  onRename: (_nodeId: string, _name: string) => Promise<boolean>;
  onCreateChildDir: (_node: AuxTreeNodeVM, _anchorId: string) => void;
  onCreateChildFile: (_node: AuxTreeNodeVM, _anchorId: string) => void;
  onDelete: (_id: string, _anchorId: string) => void;
  onRestore: (_id: string, _anchorId: string) => void;
  isBusy: boolean;
  isRefreshing: boolean;
  showTimelineChanges: boolean;
}) {
  if (tree.length === 0) {
    return (
      <PanelPlaceholder
        icon="icon-[material-symbols--folder-off]"
        label="还没有辅助信息。点击上方按钮创建。"
      />
    );
  }

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
      onDelete={onDelete}
      onRestore={onRestore}
      isBusy={isBusy}
      showTimelineChanges={showTimelineChanges}
    />
  );

  return (
    <div className="relative pb-2" aria-busy={isRefreshing}>
      <RefreshOverlay active={isRefreshing} />
      <div
        inert={isRefreshing}
        className={`transition-opacity duration-150 ease-out motion-reduce:transition-none ${
          isRefreshing ? "pointer-events-none opacity-70 select-none" : "opacity-100"
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
      </div>
    </div>
  );
}

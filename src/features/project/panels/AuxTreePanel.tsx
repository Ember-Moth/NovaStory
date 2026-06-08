import { useState } from "react";

import { InlineEditableText } from "@/features/project/components/InlineEditableText";
import { PanelPlaceholder } from "@/features/project/components/PanelPlaceholder";
import { AuxNodeIcon } from "@/features/project/components/icons";
import {
  ExpandToggle,
  RowActionButton,
  SidebarListRow,
  TreeNodePanel,
  type TreeRowContext,
} from "@/features/project/components/nodes";
import { actionAnchorId } from "@/features/project/model/action-error";
import type { AuxTreeNodeVM } from "@/features/project/model/types";

function AuxTreeNodeRow({
  node,
  depth,
  isExpanded,
  isActive,
  onToggle,
  onSelect,
  onRename,
  onCreateChildDir,
  onCreateChildFile,
  onDelete,
  isBusy,
}: {
  node: AuxTreeNodeVM;
  depth: number;
  isExpanded: boolean;
  isActive: boolean;
  onToggle: (_id: string) => void;
  onSelect: (_node: AuxTreeNodeVM) => void;
  onRename: (_nodeId: string, _name: string) => Promise<boolean>;
  onCreateChildDir: (_node: AuxTreeNodeVM, _anchorId: string) => void;
  onCreateChildFile: (_node: AuxTreeNodeVM, _anchorId: string) => void;
  onDelete: (_id: string, _anchorId: string) => void;
  isBusy: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const isDir = node.nodeType === "dir";
  const rowAnchorId = actionAnchorId("aux", "row", node.id);
  const addDirAnchorId = actionAnchorId("aux", "add-dir", node.id);
  const addFileAnchorId = actionAnchorId("aux", "add-file", node.id);
  const deleteAnchorId = actionAnchorId("aux", "delete", node.id);

  const label = (
    <InlineEditableText
      value={node.name}
      disabled={isBusy}
      onEditStart={() => onSelect(node)}
      onEditingChange={setIsEditing}
      onCommit={async (next) => onRename(node.id, next)}
      className="truncate"
    />
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
          onToggle(node.id);
        }}
        leading={
          <ExpandToggle hasChildren expanded={isExpanded} onToggle={() => onToggle(node.id)} />
        }
        icon={<AuxNodeIcon nodeType={isExpanded ? "dir-open" : "dir"} />}
        label={label}
        actions={
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
      icon={<AuxNodeIcon nodeType={node.nodeType} />}
      label={label}
      trailing={
        node.nodeType === "symlink" && node.symlinkTargetPath
          ? `→ ${node.symlinkTargetPath}`
          : undefined
      }
      actions={
        <RowActionButton
          anchorId={deleteAnchorId}
          onClick={() => onDelete(node.id, deleteAnchorId)}
          disabled={isBusy || isEditing}
          title="删除节点"
          icon="icon-[material-symbols--close]"
        />
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
  isBusy,
  isRefreshing,
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
  isBusy: boolean;
  isRefreshing: boolean;
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
      isExpanded={ctx.isExpanded}
      isActive={ctx.isActive}
      onToggle={onToggle}
      onSelect={onSelect}
      onRename={onRename}
      onCreateChildDir={onCreateChildDir}
      onCreateChildFile={onCreateChildFile}
      onDelete={onDelete}
      isBusy={isBusy}
    />
  );

  return (
    <div className="relative pb-2">
      {isRefreshing ? (
        <div className="pointer-events-none absolute right-2 top-2 z-10">
          <div className="inline-flex items-center gap-1 rounded-full border border-border bg-sidebar-background/92 px-2 py-1 text-[11px] text-foreground-muted shadow-sm backdrop-blur-sm">
            <span className="icon-[material-symbols--sync] animate-spin text-xs" />
            刷新中...
          </div>
        </div>
      ) : null}
      <TreeNodePanel
        nodes={tree}
        expandedIds={expandedIds}
        activeId={activeId}
        getId={(node) => node.id}
        getChildren={(node) => node.children}
        renderRow={renderRow}
      />
    </div>
  );
}

import { useState } from "react";

import { InlineEditableText } from "@/features/project/components/InlineEditableText";
import { PanelPlaceholder } from "@/features/project/components/PanelPlaceholder";
import { AuxNodeIcon } from "@/features/project/components/icons";
import {
  ExpandToggle,
  RowActionButton,
  RowHoverSlot,
  SidebarListRow,
  TreeNodePanel,
  type TreeRowContext,
} from "@/features/project/components/nodes";
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
  onCreateChildDir: (_node: AuxTreeNodeVM) => void;
  onCreateChildFile: (_node: AuxTreeNodeVM) => void;
  onDelete: (_id: string) => void;
  isBusy: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const isDir = node.nodeType === "dir";

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
          <RowHoverSlot
            actions={
              <>
                <RowActionButton
                  onClick={() => onCreateChildDir(node)}
                  disabled={isBusy || isEditing}
                  title="添加子文件夹"
                  icon="icon-[material-symbols--create-new-folder]"
                />
                <RowActionButton
                  onClick={() => onCreateChildFile(node)}
                  disabled={isBusy || isEditing}
                  title="添加子文件"
                  icon="icon-[material-symbols--note-add]"
                />
                <RowActionButton
                  onClick={() => onDelete(node.id)}
                  disabled={isBusy || isEditing}
                  title="删除节点"
                  icon="icon-[material-symbols--close]"
                />
              </>
            }
          />
        }
      />
    );
  }

  return (
    <SidebarListRow
      depth={depth}
      isActive={isActive}
      group
      onClick={() => onSelect(node)}
      leading={<ExpandToggle hasChildren={false} expanded={false} />}
      icon={<AuxNodeIcon nodeType={node.nodeType} />}
      label={label}
      trailing={
        node.nodeType === "symlink" && node.symlinkTargetPath ? (
          <span className="ml-1 truncate text-[11px] text-accent-foreground">
            → {node.symlinkTargetPath}
          </span>
        ) : undefined
      }
      actions={
        <RowHoverSlot
          actions={
            <RowActionButton
              onClick={() => onDelete(node.id)}
              disabled={isBusy || isEditing}
              title="删除节点"
              icon="icon-[material-symbols--close]"
            />
          }
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
}: {
  tree: AuxTreeNodeVM[];
  expandedIds: Set<string>;
  onToggle: (_id: string) => void;
  activeId: string | null;
  onSelect: (_node: AuxTreeNodeVM) => void;
  onRename: (_nodeId: string, _name: string) => Promise<boolean>;
  onCreateChildDir: (_node: AuxTreeNodeVM) => void;
  onCreateChildFile: (_node: AuxTreeNodeVM) => void;
  onDelete: (_id: string) => void;
  isBusy: boolean;
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
    <div className="pb-2">
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

import { PanelPlaceholder } from "@/features/project/components/PanelPlaceholder";
import { AuxNodeIcon } from "@/features/project/components/icons";
import {
  ExpandToggle,
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
}: {
  node: AuxTreeNodeVM;
  depth: number;
  isExpanded: boolean;
  isActive: boolean;
  onToggle: (_id: string) => void;
  onSelect: (_node: AuxTreeNodeVM) => void;
}) {
  const isDir = node.nodeType === "dir";

  if (isDir) {
    return (
      <SidebarListRow
        depth={depth}
        isActive={isActive}
        onClick={() => {
          onSelect(node);
          onToggle(node.id);
        }}
        leading={
          <ExpandToggle hasChildren expanded={isExpanded} onToggle={() => onToggle(node.id)} />
        }
        icon={<AuxNodeIcon nodeType={isExpanded ? "dir-open" : "dir"} />}
        label={<span className="truncate">{node.name}</span>}
      />
    );
  }

  return (
    <SidebarListRow
      depth={depth + 1}
      isActive={isActive}
      onClick={() => onSelect(node)}
      leading={<ExpandToggle hasChildren={false} expanded={false} />}
      icon={<AuxNodeIcon nodeType={node.nodeType} />}
      label={<span className="truncate">{node.name}</span>}
      trailing={
        node.nodeType === "symlink" && node.symlinkTargetPath ? (
          <span className="ml-1 truncate text-[11px] text-accent-foreground">
            → {node.symlinkTargetPath}
          </span>
        ) : undefined
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
}: {
  tree: AuxTreeNodeVM[];
  expandedIds: Set<string>;
  onToggle: (_id: string) => void;
  activeId: string | null;
  onSelect: (_node: AuxTreeNodeVM) => void;
}) {
  if (tree.length === 0) {
    return (
      <PanelPlaceholder
        icon="icon-[material-symbols--folder-off]"
        label="该时间点下暂无辅助信息。"
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

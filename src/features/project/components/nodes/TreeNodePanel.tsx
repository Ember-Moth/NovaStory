import { type ReactNode } from "react";

export interface TreeRowContext<T> {
  node: T;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  isActive: boolean;
}

export function TreeNodePanel<T>({
  nodes,
  depth = 0,
  expandedIds,
  activeId,
  getId,
  getChildren,
  renderRow,
}: {
  nodes: T[];
  depth?: number;
  expandedIds: Set<string>;
  activeId: string | null;
  getId: (_node: T) => string;
  getChildren: (_node: T) => T[];
  renderRow: (_ctx: TreeRowContext<T>) => ReactNode;
}) {
  return (
    <>
      {nodes.map((node) => {
        const id = getId(node);
        const children = getChildren(node);
        const hasChildren = children.length > 0;
        const isExpanded = expandedIds.has(id);
        const isActive = activeId === id;

        return (
          <div key={id}>
            {renderRow({ node, depth, hasChildren, isExpanded, isActive })}
            {hasChildren && isExpanded ? (
              <TreeNodePanel
                nodes={children}
                depth={depth + 1}
                expandedIds={expandedIds}
                activeId={activeId}
                getId={getId}
                getChildren={getChildren}
                renderRow={renderRow}
              />
            ) : null}
          </div>
        );
      })}
    </>
  );
}

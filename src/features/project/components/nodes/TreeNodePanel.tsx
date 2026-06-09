import { type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";

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
  const rows = nodes.map((node) => {
    const id = getId(node);
    const children = getChildren(node);
    const hasChildren = children.length > 0;
    const isExpanded = expandedIds.has(id);
    const isActive = activeId === id;
    const content = (
      <>
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
      </>
    );

    return (
      <motion.div
        key={id}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.14, ease: "easeOut" }}
      >
        {content}
      </motion.div>
    );
  });

  return (
    <AnimatePresence initial={false} mode="popLayout">
      {rows}
    </AnimatePresence>
  );
}

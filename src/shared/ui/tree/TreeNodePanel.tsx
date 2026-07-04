import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";

export interface TreeRowContext<T> {
  node: T;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  isActive: boolean;
}

interface TreeRow<T> {
  id: string;
  context: TreeRowContext<T>;
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
  const rows = collectRows({
    nodes,
    depth,
    expandedIds,
    activeId,
    getId,
    getChildren,
  });

  return (
    <AnimatePresence initial={false} mode="popLayout">
      {rows.map(({ id, context }) => (
        <motion.div
          key={id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14, ease: "easeOut" }}
        >
          {renderRow(context)}
        </motion.div>
      ))}
    </AnimatePresence>
  );
}

function collectRows<T>({
  nodes,
  depth,
  expandedIds,
  activeId,
  getId,
  getChildren,
}: {
  nodes: T[];
  depth: number;
  expandedIds: Set<string>;
  activeId: string | null;
  getId: (_node: T) => string;
  getChildren: (_node: T) => T[];
}) {
  const rows: TreeRow<T>[] = [];

  for (const node of nodes) {
    const id = getId(node);
    const children = getChildren(node);
    const hasChildren = children.length > 0;
    const isExpanded = expandedIds.has(id);

    rows.push({
      id,
      context: {
        node,
        depth,
        hasChildren,
        isExpanded,
        isActive: activeId === id,
      },
    });

    if (hasChildren && isExpanded) {
      rows.push(
        ...collectRows({
          nodes: children,
          depth: depth + 1,
          expandedIds,
          activeId,
          getId,
          getChildren,
        }),
      );
    }
  }

  return rows;
}

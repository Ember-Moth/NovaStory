import {
  Children,
  type ComponentProps,
  Fragment,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";

import { cn } from "@/shared/lib/cn";
import { MarkdownTable } from "@/shared/ui/markdown/MarkdownTable";

interface ParsedSidebarTableRow {
  key: string;
  cells: Array<{
    key: string;
    label: string;
    content: ReactNode;
  }>;
}

export function SidebarMarkdownTable({
  children,
  className,
  node: _node,
  ...props
}: ComponentProps<"table"> & {
  children?: ReactNode;
  node?: unknown;
}) {
  const parsedRows = parseSidebarTableRows(children);

  if (parsedRows == null) {
    return (
      <MarkdownTable {...props} className={className}>
        {children}
      </MarkdownTable>
    );
  }

  return (
    <div
      className="my-4 overflow-hidden rounded-md border border-border bg-editor-background"
      data-ai-sidebar-table="root"
      data-streamdown="table-wrapper"
    >
      {parsedRows.map((row, rowIndex) => (
        <div
          key={row.key}
          className={cn(rowIndex > 0 ? "border-border/70 border-t" : undefined)}
          data-ai-sidebar-table="row"
        >
          {row.cells.map((cell, cellIndex) => (
            <div
              key={cell.key}
              className={cn("px-2.5 py-2", cellIndex > 0 ? "pt-1" : undefined)}
              data-ai-sidebar-table="cell"
            >
              <div
                className="mb-1 text-[10px] text-foreground-muted leading-4"
                data-ai-sidebar-table="label"
              >
                {cell.label}
              </div>
              <div
                className="min-w-0 break-words text-[12px] text-foreground leading-5"
                data-ai-sidebar-table="value"
              >
                {cell.content}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function parseSidebarTableRows(children: ReactNode): ParsedSidebarTableRow[] | null {
  const tableChildren = flattenElements(children);
  const thead = tableChildren.find((child) => getTagName(child) === "thead");
  const tbody = tableChildren.find((child) => getTagName(child) === "tbody");

  if (!thead || !tbody) {
    return null;
  }

  const headerRow = flattenElements(getElementChildren(thead)).find(
    (child) => getTagName(child) === "tr",
  );
  if (!headerRow) {
    return null;
  }

  const headerCells = flattenElements(getElementChildren(headerRow)).filter((child) => {
    const tagName = getTagName(child);
    return tagName === "th" || tagName === "td";
  });
  if (headerCells.length === 0) {
    return null;
  }

  const labels = headerCells.map((cell) => getNodeText(getElementChildren(cell)).trim());
  if (labels.some((label) => label.length === 0)) {
    return null;
  }

  const bodyRows = flattenElements(getElementChildren(tbody)).filter(
    (child) => getTagName(child) === "tr",
  );
  if (bodyRows.length === 0) {
    return null;
  }

  const parsedRows = bodyRows.map((row, rowIndex) => {
    const cells = flattenElements(getElementChildren(row)).filter((child) => {
      const tagName = getTagName(child);
      return tagName === "td" || tagName === "th";
    });
    if (cells.length !== labels.length) {
      return null;
    }

    return {
      key: `row:${rowIndex}`,
      cells: cells.map((cell, cellIndex) => ({
        key: `row:${rowIndex}:cell:${cellIndex}`,
        label: labels[cellIndex]!,
        content: getElementChildren(cell),
      })),
    };
  });

  return parsedRows.every((row) => row != null) ? parsedRows : null;
}

function flattenElements(children: ReactNode): ReactElement[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement(child)) {
      return [];
    }

    if (child.type === Fragment) {
      return flattenElements(getElementChildren(child));
    }

    return [child];
  });
}

function getTagName(element: ReactElement) {
  if (typeof element.type === "string") {
    return element.type;
  }

  const node =
    "node" in (element.props as Record<string, unknown>)
      ? ((element.props as { node?: { tagName?: unknown } }).node ?? null)
      : null;
  return typeof node?.tagName === "string" ? node.tagName : null;
}

function getElementChildren(element: ReactElement) {
  return (element.props as { children?: ReactNode }).children;
}

function getNodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(getNodeText).join("");
  }

  if (isValidElement(node)) {
    return getNodeText(getElementChildren(node));
  }

  return "";
}

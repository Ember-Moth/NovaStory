import { useEffect, useRef, useState } from "react";

import { PanelPlaceholder } from "./PanelPlaceholder";
import { ContentNodeIcon } from "./icons";
import type { ContentTreeNodeVM } from "./types";

function ContentTreeNodeRow({
  node,
  depth,
  expandedIds,
  editingNodeId,
  editingTitle,
  onToggle,
  onSelect,
  onRenameStart,
  onRenameDraftChange,
  onRenameCommit,
  onRenameCancel,
  onCreateChild,
  onDelete,
  activeId,
  timelineLabelMap,
  isBusy,
}: {
  node: ContentTreeNodeVM;
  depth: number;
  expandedIds: Set<string>;
  editingNodeId: string | null;
  editingTitle: string;
  onToggle: (_id: string) => void;
  onSelect: (_node: ContentTreeNodeVM) => void;
  onRenameStart: (_node: ContentTreeNodeVM) => void;
  onRenameDraftChange: (_title: string) => void;
  onRenameCommit: (_node: ContentTreeNodeVM) => Promise<void>;
  onRenameCancel: () => void;
  onCreateChild: (_node: ContentTreeNodeVM) => void;
  onDelete: (_id: string) => void;
  activeId: string | null;
  timelineLabelMap: ReadonlyMap<string, string>;
  isBusy: boolean;
}) {
  const titleInputRef = useRef<HTMLInputElement>(null);
  const hasChildren = node.children.length > 0;
  const hasBody = node.body.trim().length > 0;
  const isExpanded = expandedIds.has(node.id);
  const isActive = activeId === node.id;
  const isRenaming = editingNodeId === node.id;

  useEffect(() => {
    if (!isRenaming) {
      return;
    }

    titleInputRef.current?.focus();
    titleInputRef.current?.select();
  }, [isRenaming]);

  return (
    <div>
      <div
        className={`group flex w-full items-center gap-1 h-7 pr-2 text-[13px] ${
          isActive
            ? "bg-list-active-background text-foreground"
            : "text-foreground hover:bg-list-hover-background"
        }`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            className={`w-4 shrink-0 text-base ${
              isExpanded
                ? "icon-[material-symbols--keyboard-arrow-down]"
                : "icon-[material-symbols--keyboard-arrow-right]"
            }`}
            onClick={() => onToggle(node.id)}
          />
        ) : (
          <span className="w-4 shrink-0" />
        )}
        {isRenaming ? (
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <ContentNodeIcon hasBody={hasBody} hasChildren={hasChildren} />
            <input
              ref={titleInputRef}
              value={editingTitle}
              disabled={isBusy}
              onChange={(event) => onRenameDraftChange(event.target.value)}
              onBlur={() => void onRenameCommit(node)}
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void onRenameCommit(node);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  onRenameCancel();
                }
              }}
              className="min-w-0 flex-1 rounded border border-border bg-editor-background px-1.5 text-[13px] leading-5.5 text-foreground outline-none select-text focus:border-accent-foreground"
              placeholder="未命名节点"
            />
          </div>
        ) : (
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-1"
            onClick={() => {
              onSelect(node);
              if (hasChildren && !isExpanded) {
                onToggle(node.id);
              }
            }}
            onDoubleClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onRenameStart(node);
            }}
          >
            <ContentNodeIcon hasBody={hasBody} hasChildren={hasChildren} />
            <span className="truncate">{node.title}</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => onCreateChild(node)}
          disabled={isBusy || isRenaming}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-foreground-muted opacity-0 transition hover:bg-button-hover-background hover:text-foreground group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
          title="添加子节点"
        >
          <span className="icon-[material-symbols--add] text-sm leading-none" />
        </button>
        <button
          type="button"
          onClick={() => onDelete(node.id)}
          disabled={isBusy || isRenaming}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-foreground-muted opacity-0 transition hover:bg-button-hover-background hover:text-foreground group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30"
          title="删除节点"
        >
          <span className="icon-[material-symbols--close] text-sm leading-none" />
        </button>
        <span className="shrink-0 self-center text-[10px] leading-none text-accent-foreground opacity-70">
          {timelineLabelMap.get(node.anchorTimelinePointId) ?? node.anchorTimelinePointId}
        </span>
      </div>
      {hasChildren && isExpanded ? (
        <div>
          {node.children.map((child) => (
            <ContentTreeNodeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              expandedIds={expandedIds}
              editingNodeId={editingNodeId}
              editingTitle={editingTitle}
              onToggle={onToggle}
              onSelect={onSelect}
              onRenameStart={onRenameStart}
              onRenameDraftChange={onRenameDraftChange}
              onRenameCommit={onRenameCommit}
              onRenameCancel={onRenameCancel}
              onCreateChild={onCreateChild}
              onDelete={onDelete}
              activeId={activeId}
              timelineLabelMap={timelineLabelMap}
              isBusy={isBusy}
            />
          ))}
        </div>
      ) : null}
    </div>
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
  activeId,
  timelineLabelMap,
  isBusy,
}: {
  tree: ContentTreeNodeVM[];
  expandedIds: Set<string>;
  onToggle: (_id: string) => void;
  onSelect: (_node: ContentTreeNodeVM) => void;
  onRename: (_nodeId: string, _title: string | null) => Promise<boolean>;
  onCreateChild: (_node: ContentTreeNodeVM) => void;
  onDelete: (_id: string) => void;
  activeId: string | null;
  timelineLabelMap: ReadonlyMap<string, string>;
  isBusy: boolean;
}) {
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  if (tree.length === 0) {
    return (
      <PanelPlaceholder
        icon="icon-[material-symbols--edit-note]"
        label="还没有正文节点。点击上方 + 创建。"
      />
    );
  }

  const handleRenameStart = (node: ContentTreeNodeVM) => {
    if (isBusy) {
      return;
    }

    onSelect(node);
    setEditingNodeId(node.id);
    setEditingTitle(node.title);
  };

  const handleRenameCancel = () => {
    setEditingNodeId(null);
    setEditingTitle("");
  };

  const handleRenameCommit = async (node: ContentTreeNodeVM) => {
    if (editingNodeId !== node.id) {
      return;
    }

    const normalizedTitle = editingTitle.trim();
    if (normalizedTitle === node.title) {
      handleRenameCancel();
      return;
    }

    const renamed = await onRename(node.id, normalizedTitle || null);
    if (renamed) {
      handleRenameCancel();
    }
  };

  return (
    <div className="pb-2">
      {tree.map((node) => (
        <ContentTreeNodeRow
          key={node.id}
          node={node}
          depth={0}
          expandedIds={expandedIds}
          editingNodeId={editingNodeId}
          editingTitle={editingTitle}
          onToggle={onToggle}
          onSelect={onSelect}
          onRenameStart={handleRenameStart}
          onRenameDraftChange={setEditingTitle}
          onRenameCommit={handleRenameCommit}
          onRenameCancel={handleRenameCancel}
          onCreateChild={onCreateChild}
          onDelete={onDelete}
          activeId={activeId}
          timelineLabelMap={timelineLabelMap}
          isBusy={isBusy}
        />
      ))}
    </div>
  );
}

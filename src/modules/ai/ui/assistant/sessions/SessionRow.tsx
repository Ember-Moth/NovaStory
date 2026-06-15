import { useEffect, useRef } from "react";
import { motion } from "motion/react";

import type { AgentThreadView } from "@/modules/ai/domain/types";
import { InlineEditInput } from "@/shared/ui/InlineEditableText";

import { HEAD_ROW_HEIGHT } from "../layout/assistantSheetLayout";

function SessionActionButton({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: string;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="flex size-6 items-center justify-center rounded-md text-foreground-muted transition hover:bg-list-hover-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span className={`text-[16px] ${icon}`} />
    </button>
  );
}

function HeadRow({
  thread,
  isActive,
  isEditing,
  editingName,
  isBusy,
  onActivate,
  onEditingNameChange,
  onRenameStart,
  onRenameCancel,
  onRenameSubmit,
  onArchive,
  onRestore,
}: {
  thread: AgentThreadView;
  isActive: boolean;
  isEditing: boolean;
  editingName: string;
  isBusy: boolean;
  onActivate: () => void;
  onEditingNameChange: (_value: string) => void;
  onRenameStart: () => void;
  onRenameCancel: () => void;
  onRenameSubmit: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  const editingInputRef = useRef<HTMLInputElement>(null);
  const isArchived = thread.archivedAt != null;

  useEffect(() => {
    if (!isEditing) {
      return;
    }

    editingInputRef.current?.focus();
    editingInputRef.current?.select();
  }, [isEditing]);

  const titleLabel = isActive ? "当前会话" : isArchived ? "已归档" : "点击切换";
  const rowClassName = `group flex w-full items-center gap-2 overflow-hidden px-3 py-2 text-left transition ${
    isActive || isEditing
      ? "bg-list-active-background text-foreground"
      : "text-foreground-muted hover:bg-list-hover-background hover:text-foreground"
  } ${isBusy ? "opacity-50" : ""}`;
  const rowContentClassName = "flex min-w-0 flex-1 items-center gap-2 text-left";

  if (isEditing) {
    return (
      <div className={rowClassName} style={{ height: `${HEAD_ROW_HEIGHT}px` }}>
        <span
          className={`shrink-0 text-[16px] ${
            isArchived
              ? "icon-[material-symbols--inventory-2] text-foreground-muted"
              : isActive
                ? "icon-[material-symbols--chat] text-accent-foreground"
                : "icon-[material-symbols--chat-outline]"
          }`}
        />
        <InlineEditInput
          inputRef={editingInputRef}
          inputProps={{
            value: editingName,
            disabled: isBusy,
            onChange: (event) => onEditingNameChange(event.target.value),
            onBlur: () => void onRenameSubmit(),
            onClick: (event) => event.stopPropagation(),
            onDoubleClick: (event) => event.stopPropagation(),
            onKeyDown: (event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void onRenameSubmit();
              } else if (event.key === "Escape") {
                event.preventDefault();
                onRenameCancel();
              }
            },
          }}
          placeholder="会话名称"
          className="box-border h-5.5 min-w-0 flex-1 rounded border border-border bg-editor-background px-1.5 text-[12px] leading-5.5 text-foreground outline-none select-text focus:border-accent-foreground"
        />
      </div>
    );
  }

  return (
    <div style={{ height: `${HEAD_ROW_HEIGHT}px` }} className={rowClassName}>
      {isArchived ? (
        <div className={rowContentClassName}>
          <span className="icon-[material-symbols--inventory-2] shrink-0 text-[16px] text-foreground-muted" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-medium">{thread.title}</span>
            <span className="block text-[10px] text-foreground-muted">{titleLabel}</span>
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={onActivate}
          disabled={isBusy}
          className={`${rowContentClassName} disabled:cursor-not-allowed`}
        >
          <span
            className={`shrink-0 text-[16px] ${
              isActive
                ? "icon-[material-symbols--chat] text-accent-foreground"
                : "icon-[material-symbols--chat-outline]"
            }`}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-medium">{thread.title}</span>
            <span className="block text-[10px] text-foreground-muted">{titleLabel}</span>
          </span>
        </button>
      )}
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
        {!isArchived ? (
          <>
            <SessionActionButton
              icon="icon-[material-symbols--edit-outline]"
              label="重命名会话"
              disabled={isBusy}
              onClick={onRenameStart}
            />
            <SessionActionButton
              icon="icon-[material-symbols--archive-outline]"
              label="归档会话"
              disabled={isBusy}
              onClick={onArchive}
            />
          </>
        ) : (
          <SessionActionButton
            icon="icon-[material-symbols--unarchive-outline]"
            label="恢复会话"
            disabled={isBusy}
            onClick={onRestore}
          />
        )}
      </div>
    </div>
  );
}

export function AnimatedHeadRow(props: Parameters<typeof HeadRow>[0] & { className?: string }) {
  const { className, ...rest } = props;
  return (
    <motion.div
      className={className}
      layout="position"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
    >
      <HeadRow {...rest} />
    </motion.div>
  );
}

export function ArchivedSectionToggleRow({
  count,
  expanded,
  onToggle,
}: {
  count: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
      className="mt-1 border-t border-border pt-1.5"
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-3 py-1.5 text-[11px] text-foreground-muted transition hover:bg-list-hover-background hover:text-foreground"
      >
        <span>归档会话</span>
        <span className="flex items-center gap-1">
          <span>{count}</span>
          <span
            className={
              expanded
                ? "icon-[material-symbols--expand-less]"
                : "icon-[material-symbols--expand-more]"
            }
          />
        </span>
      </button>
    </motion.div>
  );
}

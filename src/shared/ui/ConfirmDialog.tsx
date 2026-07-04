import { useEffect, useRef } from "react";

export function ConfirmDialog({
  open,
  title,
  description,
  items = [],
  confirmLabel = "确认",
  cancelLabel = "取消",
  isPending = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  items?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  isPending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    if (open && !dialog.open) {
      dialog.showModal();
      return;
    }

    if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        if (!isPending) {
          onCancel();
        }
      }}
      className="w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-border bg-sidebar-background p-0 text-foreground shadow-lg backdrop:bg-black/50"
    >
      <div className="flex items-center gap-2 border-border border-b px-4 py-2">
        <span className="icon-[material-symbols--warning] text-accent-foreground text-base" />
        <span className="font-medium text-sm">{title}</span>
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="ml-auto rounded p-0.5 text-foreground-muted transition hover:bg-button-hover-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span className="icon-[material-symbols--close] text-base leading-none" />
        </button>
      </div>

      <div className="space-y-3 p-4">
        <p className="text-foreground-muted text-sm leading-relaxed">{description}</p>
        {items.length > 0 ? (
          <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border bg-editor-background px-3 py-2 text-sm">
            {items.map((item) => (
              <li key={item} className="truncate font-mono text-foreground text-xs">
                {item}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="flex items-center justify-end gap-2 border-border border-t px-4 py-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="rounded-md border border-border px-3 py-1.5 font-medium text-foreground text-sm transition hover:bg-list-hover-background disabled:cursor-not-allowed disabled:opacity-40"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isPending}
          className="rounded-md bg-accent-background px-3 py-1.5 font-medium text-foreground text-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="icon-[material-symbols--sync] animate-spin text-base" />
              处理中
            </span>
          ) : (
            confirmLabel
          )}
        </button>
      </div>
    </dialog>
  );
}

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
      className="border-border bg-sidebar-background text-foreground w-[min(28rem,calc(100vw-2rem))] rounded-lg border p-0 shadow-lg backdrop:bg-black/50"
    >
      <div className="border-border flex items-center gap-2 border-b px-4 py-2">
        <span className="icon-[material-symbols--warning] text-accent-foreground text-base" />
        <span className="text-sm font-medium">{title}</span>
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="text-foreground-muted hover:bg-button-hover-background hover:text-foreground ml-auto rounded p-0.5 transition disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span className="icon-[material-symbols--close] text-base leading-none" />
        </button>
      </div>

      <div className="space-y-3 p-4">
        <p className="text-foreground-muted text-sm leading-relaxed">{description}</p>
        {items.length > 0 ? (
          <ul className="border-border bg-editor-background max-h-48 space-y-1 overflow-y-auto rounded-md border px-3 py-2 text-sm">
            {items.map((item) => (
              <li key={item} className="text-foreground truncate font-mono text-xs">
                {item}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="border-border flex items-center justify-end gap-2 border-t px-4 py-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="border-border text-foreground hover:bg-list-hover-background rounded-md border px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={isPending}
          className="bg-accent-background text-foreground rounded-md px-3 py-1.5 text-sm font-medium transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
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

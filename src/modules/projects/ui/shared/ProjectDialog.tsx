import type { FormEvent, ReactNode } from "react";

import { cn } from "@/shared/lib/cn";

import { InlineError, primaryButton, secondaryButton } from "./projectUi";

export function ProjectDialog({
  dialogRef,
  title,
  icon,
  widthClassName,
  onClose,
  onSubmit,
  error,
  isPending,
  pendingLabel,
  submitLabel,
  children,
}: {
  dialogRef: React.RefObject<HTMLDialogElement | null>;
  title: string;
  icon: string;
  widthClassName?: string;
  onClose: () => void;
  onSubmit: (_event: FormEvent<HTMLFormElement>) => void;
  error: string | null;
  isPending: boolean;
  pendingLabel: string;
  submitLabel: string;
  children: ReactNode;
}) {
  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-sidebar-background p-0 text-foreground shadow-lg backdrop:bg-black/50",
        widthClassName ?? "w-[min(28rem,calc(100vw-2rem))]",
      )}
    >
      <form onSubmit={onSubmit} className="min-w-0">
        <div className="flex items-center gap-2 border-border border-b px-4 py-2">
          <span className={cn(icon, "text-accent-foreground text-base")} />
          <span className="font-medium text-sm">{title}</span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded p-0.5 text-foreground-muted transition hover:bg-button-hover-background hover:text-foreground"
          >
            <span className="icon-[material-symbols--close] text-base leading-none" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          {children}
          {error ? <InlineError message={error} /> : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-border border-t px-4 py-3">
          <button type="button" onClick={onClose} className={secondaryButton}>
            取消
          </button>
          <button type="submit" disabled={isPending} className={primaryButton}>
            {isPending ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="icon-[material-symbols--sync] animate-spin text-base" />
                {pendingLabel}
              </span>
            ) : (
              submitLabel
            )}
          </button>
        </div>
      </form>
    </dialog>
  );
}

import { type ReactNode } from "react";

export const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "short",
});

const buttonBase =
  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50";

export const secondaryButton = `${buttonBase} border border-border bg-sidebar-background text-foreground hover:bg-list-hover-background`;
export const primaryButton = `${buttonBase} bg-accent-background text-foreground hover:brightness-110`;

export function InlineError({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-editor-background px-3 py-2 text-sm text-accent-foreground">
      <span className="icon-[material-symbols--warning] shrink-0 text-base" />
      {message}
    </div>
  );
}

export function PageHeader({
  icon,
  title,
  subtitle,
  trailing,
}: {
  icon: string;
  title: string;
  subtitle: string;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border bg-title-bar-background px-4 py-2">
      <span className={`${icon} text-xl text-icon-folder`} />
      <div className="min-w-0">
        <h1 className="text-[14px] font-semibold text-foreground">{title}</h1>
        <p className="text-[11px] text-foreground-muted">{subtitle}</p>
      </div>
      {trailing ? <div className="ml-auto">{trailing}</div> : null}
    </div>
  );
}

export function formatCommitId(id: string) {
  return id;
}

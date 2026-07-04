import type { ReactNode } from "react";

export const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "short",
});

const relativeTimeFormatter = new Intl.RelativeTimeFormat("zh-CN", {
  numeric: "auto",
});

const buttonBase =
  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50";

export const secondaryButton = `${buttonBase} border border-border bg-sidebar-background text-foreground hover:bg-list-hover-background`;
export const primaryButton = `${buttonBase} bg-accent-background text-foreground hover:brightness-110`;

const compactButtonBase =
  "inline-flex h-7 items-center gap-1 rounded px-2 text-xs font-medium leading-none transition disabled:cursor-not-allowed disabled:opacity-50";

export const compactSecondaryButton = `${compactButtonBase} border border-border bg-sidebar-background text-foreground hover:bg-list-hover-background`;
export const compactPrimaryButton = `${compactButtonBase} bg-accent-background text-foreground hover:brightness-110`;

export function InlineError({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-editor-background px-3 py-2 text-accent-foreground text-sm">
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
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-border border-b bg-title-bar-background px-4 py-2">
      <span className={`${icon} text-icon-folder text-xl`} />
      <div className="min-w-0 flex-1">
        <h1 className="truncate font-semibold text-[14px] text-foreground">{title}</h1>
        <p className="truncate text-[11px] text-foreground-muted">{subtitle}</p>
      </div>
      {trailing ? <div className="ml-auto min-w-0 max-w-full">{trailing}</div> : null}
    </div>
  );
}

export function formatCommitId(id: string) {
  return id;
}

export function formatDateTimePreferredRelative(value: Date | number) {
  const date = value instanceof Date ? value : new Date(value);
  const timestamp = date.getTime();

  if (Number.isNaN(timestamp)) {
    return "—";
  }

  const diffSeconds = Math.round((timestamp - Date.now()) / 1000);
  const absSeconds = Math.abs(diffSeconds);

  if (absSeconds < 60) {
    return "刚刚";
  }

  if (absSeconds < 60 * 60) {
    return relativeTimeFormatter.format(Math.round(diffSeconds / 60), "minute");
  }

  if (absSeconds < 60 * 60 * 24) {
    return relativeTimeFormatter.format(Math.round(diffSeconds / (60 * 60)), "hour");
  }

  if (absSeconds < 60 * 60 * 24 * 30) {
    return relativeTimeFormatter.format(Math.round(diffSeconds / (60 * 60 * 24)), "day");
  }

  if (absSeconds < 60 * 60 * 24 * 365) {
    return relativeTimeFormatter.format(Math.round(diffSeconds / (60 * 60 * 24 * 30)), "month");
  }

  return relativeTimeFormatter.format(Math.round(diffSeconds / (60 * 60 * 24 * 365)), "year");
}

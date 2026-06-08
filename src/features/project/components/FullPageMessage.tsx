export function FullPageMessage({
  icon,
  title,
  description,
  embedded = false,
}: {
  icon: string;
  title: string;
  description: string;
  embedded?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-center px-6 text-foreground ${embedded ? "h-full" : "h-dvh bg-editor-background"}`}
    >
      <div className="flex max-w-md flex-col items-center gap-3 rounded-lg border border-border bg-sidebar-background px-6 py-8 text-center">
        <span className={`${icon} text-3xl text-foreground-muted`} />
        <h1 className="text-base font-semibold">{title}</h1>
        <p className="text-sm text-foreground-muted">{description}</p>
      </div>
    </div>
  );
}

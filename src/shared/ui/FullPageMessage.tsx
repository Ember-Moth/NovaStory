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
      className={`flex items-center justify-center text-foreground ${embedded ? "h-full px-3" : "h-dvh bg-editor-background px-6"}`}
    >
      <div
        className={`flex max-w-md flex-col items-center gap-3 rounded-lg border border-border bg-sidebar-background text-center ${embedded ? "px-3 py-6" : "px-6 py-8"}`}
      >
        <span className={`${icon} text-3xl text-foreground-muted`} />
        <h1 className="font-semibold text-base">{title}</h1>
        <p className="text-foreground-muted text-sm">{description}</p>
      </div>
    </div>
  );
}

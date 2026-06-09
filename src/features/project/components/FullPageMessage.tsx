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
      className={`text-foreground flex items-center justify-center px-6 ${embedded ? "h-full" : "bg-editor-background h-dvh"}`}
    >
      <div className="border-border bg-sidebar-background flex max-w-md flex-col items-center gap-3 rounded-lg border px-6 py-8 text-center">
        <span className={`${icon} text-foreground-muted text-3xl`} />
        <h1 className="text-base font-semibold">{title}</h1>
        <p className="text-foreground-muted text-sm">{description}</p>
      </div>
    </div>
  );
}

export function PanelPlaceholder({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="text-foreground-muted flex items-center gap-2 px-3 py-3 text-sm">
      <span className={`${icon} shrink-0 text-base`} />
      <span>{label}</span>
    </div>
  );
}

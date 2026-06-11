export function ExpandToggle({
  hasChildren,
  expanded,
  onToggle,
}: {
  hasChildren: boolean;
  expanded: boolean;
  onToggle?: () => void;
}) {
  if (!hasChildren) {
    return <span className="w-4 shrink-0" />;
  }

  return (
    <button
      type="button"
      data-no-row-gesture
      className={`w-4 shrink-0 text-base ${
        expanded
          ? "icon-[material-symbols--keyboard-arrow-down]"
          : "icon-[material-symbols--keyboard-arrow-right]"
      }`}
      onClick={(event) => {
        event.stopPropagation();
        onToggle?.();
      }}
    />
  );
}

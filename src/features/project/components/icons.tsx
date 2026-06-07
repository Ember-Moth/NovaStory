export function ContentNodeIcon({
  hasBody,
  hasChildren,
}: {
  hasBody: boolean;
  hasChildren: boolean;
}) {
  const icon =
    !hasBody && !hasChildren
      ? "icon-[material-symbols--circle] text-icon-empty"
      : hasBody && !hasChildren
        ? "icon-[material-symbols--description] text-icon-leaf"
        : !hasBody && hasChildren
          ? "icon-[material-symbols--account-tree] text-icon-folder"
          : "icon-[material-symbols--overview] text-icon-mixed";

  return <span className={`${icon} shrink-0 text-base`} />;
}

export function AuxNodeIcon({ nodeType }: { nodeType: string }) {
  const iconMap: Record<string, string> = {
    dir: "icon-[material-symbols--folder] text-icon-folder",
    "dir-open": "icon-[material-symbols--folder-open] text-icon-folder",
    file: "icon-[material-symbols--description] text-foreground-muted",
    symlink: "icon-[material-symbols--link] text-accent-foreground",
  };

  return (
    <span
      className={`${iconMap[nodeType] ?? "icon-[material-symbols--description] text-foreground-muted"} shrink-0 text-base`}
    />
  );
}

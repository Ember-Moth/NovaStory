import { cn } from "@/shared/lib/cn";

import type { ChangeAreas } from "../../shared/projectTypes";

const workingTreeChangeKindLabels: Record<
  ChangeAreas["content"]["changes"][number]["kind"],
  string
> = {
  added: "新增",
  modified: "修改",
  deleted: "删除",
};

const workingTreeAreaLabels = {
  content: "正文",
  timeline: "时间线",
  aux: "辅助信息",
} as const;

/**
 * 渲染一组语义化变更（正文 / 时间线 / 辅助信息）。
 * 由「未提交变更」面板与「提交差异」面板共用，保证两处呈现一致。
 *
 * 当提供 `onRevertContentChange` 时，正文区域的变更项会在 chip 上显示撤回按钮。
 */
export function ChangeAreasView({
  areas,
  onRevertContentChange,
  onRevertTimelineChange,
  onRevertAuxChange,
}: {
  areas: ChangeAreas;
  onRevertContentChange?: (
    nodeId: string,
    kind: ChangeAreas["content"]["changes"][number]["kind"],
  ) => void;
  onRevertTimelineChange?: (
    pointId: string,
    kind: ChangeAreas["timeline"]["changes"][number]["kind"],
  ) => void;
  onRevertAuxChange?: (
    filepath: string,
    kind: ChangeAreas["aux"]["changes"][number]["kind"],
  ) => void;
}) {
  return (
    <div className="space-y-2">
      {(Object.keys(workingTreeAreaLabels) as Array<keyof typeof workingTreeAreaLabels>).map(
        (areaKey) => {
          const area = areas[areaKey];
          if (!area.changed) {
            return null;
          }

          return (
            <div key={areaKey}>
              <div className="text-xs font-medium text-foreground-muted">
                {workingTreeAreaLabels[areaKey]}
              </div>
              {areaKey === "content"
                ? renderContentArea(areas.content.changes, onRevertContentChange)
                : areaKey === "timeline"
                  ? renderTimelineArea(areas.timeline.changes, onRevertTimelineChange)
                  : renderPathArea(areas.aux.changes, true, onRevertAuxChange)}
            </div>
          );
        },
      )}
    </div>
  );
}

function renderContentArea(
  changes: ChangeAreas["content"]["changes"],
  onRevertContentChange?: (
    nodeId: string,
    kind: ChangeAreas["content"]["changes"][number]["kind"],
  ) => void,
) {
  return (
    <ul className="mt-1 space-y-1">
      {changes.map((change) => (
        <li
          key={`content-${change.kind}-${change.nodeId}`}
          className="flex items-start gap-2 text-sm text-foreground"
        >
          <WorkingTreeChangeBadge
            kind={change.kind}
            itemId={change.nodeId}
            revertable={change.revertable}
            onRevert={onRevertContentChange}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <ContentChangeBreadcrumb change={change} />
            </div>
            <WorkingTreeContentChangeDetails change={change} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function renderTimelineArea(
  changes: ChangeAreas["timeline"]["changes"],
  onRevertTimelineChange?: (
    pointId: string,
    kind: ChangeAreas["timeline"]["changes"][number]["kind"],
  ) => void,
) {
  return (
    <ul className="mt-1 space-y-1">
      {changes.map((change) => (
        <li
          key={`timeline-${change.kind}-${change.pointId}`}
          className="flex items-start gap-2 text-sm text-foreground"
        >
          <WorkingTreeChangeBadge
            kind={change.kind}
            itemId={change.pointId}
            revertable={change.revertable}
            onRevert={onRevertTimelineChange}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="min-w-0 truncate font-medium">{change.label}</span>
            </div>
            <WorkingTreeTimelineChangeDetails change={change} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function renderPathArea(
  changes: ChangeAreas["aux"]["changes"],
  emphasizeTimeline: boolean,
  onRevertAuxChange?: (
    filepath: string,
    kind: ChangeAreas["aux"]["changes"][number]["kind"],
  ) => void,
) {
  return (
    <ul className="mt-1 space-y-1">
      {changes.map((change) => (
        <li
          key={`${change.kind}-${change.label}`}
          className="flex items-start gap-2 text-sm text-foreground"
        >
          <WorkingTreeChangeBadge
            kind={change.kind}
            itemId={change.label}
            revertable={change.revertable}
            onRevert={onRevertAuxChange}
          />
          <WorkingTreeChangeLabel change={change} emphasizeTimeline={emphasizeTimeline} />
        </li>
      ))}
    </ul>
  );
}

function WorkingTreeChangeLabel({
  change,
  emphasizeTimeline,
}: {
  change: ChangeAreas["aux"]["changes"][number];
  emphasizeTimeline: boolean;
}) {
  const label = change.label;
  if (!emphasizeTimeline) {
    return <span className="min-w-0 truncate">{label}</span>;
  }

  const rawPath = change.path || label;
  const segments = rawPath.split("/").filter(Boolean);
  const filename = segments.at(-1) ?? rawPath;
  const parents = segments.slice(0, -1);
  const isWhiteout = change.isWhiteout === true && filename.startsWith(".wh.");
  const whiteoutTarget = isWhiteout ? filename.slice(4) : null;
  const timelineLabel = change.timelinePointLabel ?? change.timelinePointId ?? "辅助信息";
  const sourceTimelineLabel =
    change.sourceTimelinePointLabel ?? change.sourceTimelinePointId ?? "辅助信息";
  const sourcePath = change.sourcePath ?? null;
  const sourceValue =
    sourcePath == null
      ? null
      : sourceTimelineLabel === timelineLabel
        ? sourcePath || "/"
        : `${sourceTimelineLabel} · ${sourcePath || "/"}`;

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-1 overflow-hidden">
        {parents.map((segment, index) => (
          <span
            key={`${change.label}-${segment}-${index}`}
            className="flex min-w-0 shrink items-center gap-1"
          >
            {index > 0 ? (
              <span className="shrink-0 text-sm text-foreground-muted/55">{"/"}</span>
            ) : null}
            <span className="min-w-0 truncate text-sm text-foreground-muted">{segment}</span>
          </span>
        ))}
        {parents.length > 0 ? (
          <span className="shrink-0 text-sm text-foreground-muted/55">{"/"}</span>
        ) : null}
        {isWhiteout ? (
          <>
            <span className="shrink-0 rounded-sm border border-red-500/20 bg-red-500/10 px-1 py-0.5 text-[10px] leading-none text-red-200/85">
              .wh
            </span>
            <span className="min-w-0 truncate font-medium text-foreground">
              {whiteoutTarget || filename}
            </span>
          </>
        ) : (
          <span className="min-w-0 truncate font-medium text-foreground">{filename || "/"}</span>
        )}
      </div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        <SemanticPlacementChip label="位于" value={timelineLabel} tone="sky" />
        {sourceValue ? (
          <SemanticPlacementChip
            label={change.sourceKind === "copy" ? "复制自" : "来自"}
            value={sourceValue}
            tone="slate"
          />
        ) : null}
      </div>
    </div>
  );
}

function WorkingTreeChangeBadge({
  kind,
  itemId,
  revertable,
  onRevert,
}: {
  kind: ChangeAreas["timeline"]["changes"][number]["kind"];
  itemId?: string;
  revertable?: boolean;
  onRevert?: (itemId: string, kind: ChangeAreas["content"]["changes"][number]["kind"]) => void;
}) {
  const label = workingTreeChangeKindLabels[kind];
  const className =
    kind === "added"
      ? "bg-emerald-500/15 text-emerald-200"
      : kind === "deleted"
        ? "bg-red-500/15 text-red-200"
        : "bg-amber-500/15 text-amber-200";

  const revertLabel = kind === "added" ? "删除" : kind === "deleted" ? "恢复" : "恢复";
  const canRevert = revertable !== false;
  const hasRevert = typeof itemId === "string" && typeof onRevert === "function";

  return (
    <span
      className={cn(
        "group relative shrink-0 overflow-hidden rounded px-1.5 py-0.5 text-[10px] font-medium",
        className,
      )}
    >
      <span className={cn("transition-opacity", hasRevert && "group-hover:opacity-0")}>
        {label}
      </span>
      {hasRevert ? (
        <button
          type="button"
          disabled={!canRevert}
          onClick={(event) => {
            event.stopPropagation();
            if (canRevert) {
              onRevert(itemId, kind);
            }
          }}
          className={cn(
            "absolute inset-0 flex items-center justify-center rounded px-1.5 text-[10px] font-medium opacity-0 transition-opacity",
            "group-hover:opacity-100",
            canRevert ? "cursor-pointer hover:brightness-110" : "cursor-default opacity-30",
          )}
        >
          {revertLabel}
        </button>
      ) : null}
    </span>
  );
}

function WorkingTreeTimelineChangeDetails({
  change,
}: {
  change: ChangeAreas["timeline"]["changes"][number];
}) {
  if (change.kind === "added") {
    return (
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] leading-relaxed text-foreground-muted">
        {change.prevPointLabel ? (
          <SemanticPlacementChip label="插入到" value={change.prevPointLabel} tone="sky" />
        ) : null}
        {change.description ? (
          <SemanticPlacementChip label="描述" value={change.description} tone="emerald" />
        ) : null}
      </div>
    );
  }

  if (change.kind === "deleted") {
    return (
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] leading-relaxed text-foreground-muted">
        {change.previousPrevPointLabel ? (
          <SemanticPlacementChip label="原位置" value={change.previousPrevPointLabel} tone="red" />
        ) : null}
        {change.previousDescription ? (
          <SemanticPlacementChip label="原描述" value={change.previousDescription} tone="red" />
        ) : null}
      </div>
    );
  }

  const labelChanged =
    change.changedAspects.includes("label") &&
    change.previousLabel &&
    change.previousLabel !== change.label;
  const descriptionChanged =
    change.changedAspects.includes("description") &&
    (change.previousDescription ?? "") !== (change.description ?? "");
  const orderChanged = change.changedAspects.includes("order");

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] leading-relaxed text-foreground-muted">
      {labelChanged ? (
        <SemanticTransitionChip
          label="标题"
          from={change.previousLabel ?? "未命名"}
          to={change.label}
          fromTone="red"
          toTone="emerald"
        />
      ) : null}
      {descriptionChanged ? (
        <SemanticTransitionChip
          label="描述"
          from={change.previousDescription ?? "空"}
          to={change.description ?? "空"}
          fromTone="slate"
          toTone="sky"
        />
      ) : null}
      {orderChanged ? (
        <SemanticTransitionChip
          label="顺序"
          from={change.previousPrevPointLabel ?? "原点"}
          to={change.prevPointLabel ?? "原点"}
          fromTone="slate"
          toTone="sky"
        />
      ) : null}
    </div>
  );
}

function ContentChangeBreadcrumb({
  change,
}: {
  change: ChangeAreas["content"]["changes"][number];
}) {
  const parentPath =
    change.kind === "deleted"
      ? (change.previousParentPathLabel ?? change.parentPathLabel)
      : change.parentPathLabel;
  const parentSegments = parentPath === "顶层" ? [] : parentPath.split(" / ");
  const segments = [...parentSegments, change.label];

  return (
    <div className="flex min-w-0 items-center gap-1 overflow-hidden">
      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1;
        return (
          <span
            key={`${change.nodeId}-${segment}-${index}`}
            className="flex min-w-0 items-center gap-1"
          >
            {index > 0 ? (
              <span className="shrink-0 text-sm text-foreground-muted/55">{"/"}</span>
            ) : null}
            <span
              className={cn(
                "min-w-0 truncate text-sm",
                isLast ? "font-medium text-foreground" : "text-foreground-muted",
              )}
            >
              {segment}
            </span>
          </span>
        );
      })}
    </div>
  );
}

function WorkingTreeContentChangeDetails({
  change,
}: {
  change: ChangeAreas["content"]["changes"][number];
}) {
  if (change.kind === "added") {
    return (
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] leading-relaxed text-foreground-muted">
        {change.anchorTimelinePointLabel && change.anchorTimelinePointLabel !== "原点" ? (
          <SemanticPlacementChip
            label="锚定到"
            value={change.anchorTimelinePointLabel}
            tone="sky"
          />
        ) : null}
      </div>
    );
  }

  if (change.kind === "deleted") {
    return (
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] leading-relaxed text-foreground-muted">
        {change.previousAnchorTimelinePointLabel &&
        change.previousAnchorTimelinePointLabel !== "原点" ? (
          <SemanticPlacementChip
            label="原锚点"
            value={change.previousAnchorTimelinePointLabel}
            tone="red"
          />
        ) : null}
      </div>
    );
  }

  const parentDetail = change.changedAspects.includes("parent")
    ? `${change.previousParentLabel ?? "根目录"} -> ${change.parentLabel ?? "根目录"}`
    : null;
  const anchorDetail = change.changedAspects.includes("anchor")
    ? `${change.previousAnchorTimelinePointLabel ?? "原点"} -> ${change.anchorTimelinePointLabel ?? "原点"}`
    : null;
  const bodyChanged = change.changedAspects.includes("body");
  const orderChanged = change.changedAspects.includes("order");
  const parentChanged = change.changedAspects.includes("parent");
  const anchorChanged = change.changedAspects.includes("anchor");
  const titleChanged =
    change.changedAspects.includes("title") &&
    change.previousTitle &&
    change.previousTitle !== (change.title ?? change.label);
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] leading-relaxed text-foreground-muted">
      {bodyChanged && change.bodyCharDelta ? (
        <SemanticBodyDeltaChip
          added={change.bodyCharDelta.added}
          removed={change.bodyCharDelta.removed}
        />
      ) : null}
      {orderChanged ? <SemanticChangeChip label="同级顺序调整" tone="slate" /> : null}
      {titleChanged ? (
        <SemanticTransitionChip
          label="标题"
          from={change.previousTitle ?? "未命名"}
          to={change.title ?? change.label}
          fromTone="red"
          toTone="emerald"
        />
      ) : null}
      {parentChanged && parentDetail ? (
        <SemanticTransitionChip
          label="移动位置"
          from={change.previousParentLabel ?? "根目录"}
          to={change.parentLabel ?? "根目录"}
          fromTone="slate"
          toTone="sky"
        />
      ) : null}
      {anchorChanged && anchorDetail ? (
        <SemanticTransitionChip
          label="锚点切换"
          from={change.previousAnchorTimelinePointLabel ?? "原点"}
          to={change.anchorTimelinePointLabel ?? "原点"}
          fromTone="slate"
          toTone="sky"
        />
      ) : null}
    </div>
  );
}

function SemanticChangeChip({ tone, label }: { tone: "amber" | "slate"; label: string }) {
  const className =
    tone === "amber"
      ? "border-amber-500/20 bg-amber-500/10 text-amber-100"
      : "border-border bg-sidebar-background text-foreground-muted";
  return (
    <span
      className={cn(
        "inline-flex h-5.5 items-center rounded-sm border px-1.5 text-[10px] leading-none",
        className,
      )}
    >
      {label}
    </span>
  );
}

function SemanticBodyDeltaChip({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="inline-flex h-5.5 items-stretch overflow-hidden rounded-sm border border-border bg-sidebar-background/70 align-middle text-[10px] leading-none">
      {added > 0 ? (
        <span className="inline-flex items-center bg-emerald-500/14 px-1.5 text-emerald-100">
          {`+${added}`}
        </span>
      ) : null}
      {removed > 0 ? (
        <span className="inline-flex items-center bg-red-500/14 px-1.5 text-red-200/85">
          {`-${removed}`}
        </span>
      ) : null}
    </span>
  );
}

function SemanticTransitionChip({
  label,
  from,
  to,
  fromTone,
  toTone,
}: {
  label: string;
  from: string;
  to: string;
  fromTone: "red" | "slate";
  toTone: "emerald" | "sky";
}) {
  const fromClassName =
    fromTone === "red"
      ? "bg-red-500/14 text-red-200/85 line-through decoration-red-300/50"
      : "bg-foreground-muted/8 text-foreground-muted";
  const toClassName =
    toTone === "emerald"
      ? "bg-emerald-500/14 font-medium text-emerald-100"
      : "bg-sky-500/14 text-sky-100";
  return (
    <span className="inline-flex h-5.5 items-stretch overflow-hidden rounded-sm border border-border bg-sidebar-background/70 align-middle text-[10px] leading-none">
      <span className="inline-flex items-center px-1.5 text-foreground-muted/70">{label}</span>
      <span className={cn("inline-flex items-center px-1.5 leading-none", fromClassName)}>
        {from}
      </span>
      <span className="inline-flex items-center px-1 text-foreground-muted/60">{"→"}</span>
      <span className={cn("inline-flex items-center px-1.5 leading-none", toClassName)}>{to}</span>
    </span>
  );
}

function SemanticPlacementChip({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "emerald" | "sky" | "slate" | "red";
}) {
  const valueClassName =
    tone === "emerald"
      ? "bg-emerald-500/14 text-emerald-100"
      : tone === "red"
        ? "bg-red-500/14 text-red-200/85"
        : tone === "sky"
          ? "bg-sky-500/14 text-sky-100"
          : "bg-foreground-muted/8 text-foreground-muted";
  return (
    <span className="inline-flex h-5.5 items-stretch overflow-hidden rounded-sm border border-border bg-sidebar-background/70 align-middle text-[10px] leading-none">
      <span className="inline-flex items-center px-1.5 text-foreground-muted/70">{label}</span>
      <span className={cn("inline-flex items-center px-1.5 leading-none", valueClassName)}>
        {value}
      </span>
    </span>
  );
}

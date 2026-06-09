import { InlineEditableText } from "@/features/project/components/InlineEditableText";
import {
  FlatListPanel,
  RowActionButton,
  SidebarListRow,
} from "@/features/project/components/nodes";
import { actionAnchorId } from "@/features/project/model/action-error";
import type { TimelinePointVM } from "@/features/project/model/types";

export function TimelinePanel({
  points,
  activeId,
  anchoredPointId = null,
  canSetAnchor = false,
  isBusy,
  onSelect,
  onSetAnchor,
  onReorder,
  onDelete,
  onRename,
}: {
  points: TimelinePointVM[];
  activeId: string | null;
  anchoredPointId?: string | null;
  canSetAnchor?: boolean;
  isBusy: boolean;
  onSelect: (_id: string) => void;
  onSetAnchor?: (_id: string, _anchorId: string) => void;
  onReorder: (_fromIndex: number, _toIndex: number) => void;
  onDelete: (_id: string, _anchorId: string) => void;
  onRename: (_pointId: string, _label: string) => Promise<boolean>;
}) {
  return (
    <div className="pb-2">
      <FlatListPanel
        items={points}
        activeId={activeId}
        isBusy={isBusy}
        getId={(point) => point.id}
        onReorder={onReorder}
        isDragDisabled={(point) => point.isImplicitOrigin}
        renderRow={({ item: point, isActive, draggable, dragProps }) => {
          const isAnchored = anchoredPointId === point.id;
          const showSetAnchor = canSetAnchor && !isAnchored && onSetAnchor;
          const showDelete = !point.isImplicitOrigin;
          const rowAnchorId = actionAnchorId("timeline", "row", point.id);
          const anchorActionId = actionAnchorId("timeline", "anchor", point.id);
          const deleteAnchorId = actionAnchorId("timeline", "delete", point.id);

          return (
            <SidebarListRow
              depth={0}
              isActive={isActive}
              group={!!showSetAnchor || !point.isImplicitOrigin}
              anchorId={rowAnchorId}
              className={point.isImplicitOrigin ? "opacity-90" : ""}
              onClick={() => onSelect(point.id)}
              draggable={draggable}
              dragProps={dragProps}
              icon={
                <span className="icon-[material-symbols--radio-button-checked] text-foreground-muted shrink-0 text-sm" />
              }
              label={
                <InlineEditableText
                  value={point.label}
                  editable={!point.isImplicitOrigin}
                  disabled={isBusy}
                  onEditStart={() => onSelect(point.id)}
                  onCommit={(label) => onRename(point.id, label)}
                  className={`min-w-0 flex-1 truncate leading-5.5${isAnchored ? "text-accent-foreground font-bold" : ""}`}
                />
              }
              trailing={point.description || undefined}
              actions={
                showSetAnchor || showDelete ? (
                  <>
                    {showSetAnchor ? (
                      <RowActionButton
                        anchorId={anchorActionId}
                        onClick={() => onSetAnchor(point.id, anchorActionId)}
                        disabled={isBusy}
                        title="设为锚点"
                        icon="icon-[material-symbols--anchor]"
                      />
                    ) : null}
                    {showDelete ? (
                      <RowActionButton
                        anchorId={deleteAnchorId}
                        onClick={() => onDelete(point.id, deleteAnchorId)}
                        disabled={isBusy}
                        title="删除时间点"
                        icon="icon-[material-symbols--close]"
                      />
                    ) : null}
                  </>
                ) : undefined
              }
            />
          );
        }}
      />
    </div>
  );
}

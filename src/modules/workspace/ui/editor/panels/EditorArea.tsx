import { AuxNodeIcon, ContentNodeIcon } from "@/modules/workspace/ui/editor/components/icons";
import { MainTextEditor } from "@/shared/ui/editor/MainTextEditor";
import type {
  AuxTreeNodeVM,
  ContentTreeNodeVM,
  SaveState,
} from "@/modules/workspace/ui/editor/model/types";

const EDITOR_HEADER_CLASS =
  "flex h-10 shrink-0 items-center gap-2 border-b border-border bg-title-bar-background px-4";
const STATUS_LABEL_CLASS = "ml-auto shrink-0 text-[11px] text-foreground-muted";
const TIMELINE_LABEL_CLASS = "shrink-0 text-[11px] text-accent-foreground";

function SaveStatus({
  saveState,
  isPending = false,
}: {
  saveState: SaveState;
  isPending?: boolean;
}) {
  if (saveState.error) {
    return <span className="ml-auto shrink-0 text-[11px] text-red-300">{saveState.error}</span>;
  }

  if (saveState.isSaving || isPending) {
    return <span className={STATUS_LABEL_CLASS}>保存中</span>;
  }

  if (saveState.isDirty) {
    return <span className={STATUS_LABEL_CLASS}>待保存</span>;
  }

  return <span className={STATUS_LABEL_CLASS}>已同步</span>;
}

function PendingStatus({ isPending }: { isPending: boolean }) {
  if (!isPending) {
    return null;
  }

  return <span className={STATUS_LABEL_CLASS}>保存中</span>;
}

export function EditorArea({
  target,
  contentNode,
  auxNode,
  body,
  auxContent,
  timelineLabel,
  contentSaveState,
  auxSaveState,
  auxPending,
  isAuxSymlinkTargetPickerActive,
  onBodyChange,
  onAuxContentChange,
}: {
  target: "content" | "aux" | null;
  contentNode: ContentTreeNodeVM | null;
  auxNode: AuxTreeNodeVM | null;
  body: string;
  auxContent: string;
  timelineLabel: string;
  contentSaveState: SaveState;
  auxSaveState: SaveState;
  auxPending: boolean;
  isAuxSymlinkTargetPickerActive: boolean;
  onBodyChange: (_value: string) => void;
  onAuxContentChange: (_value: string) => void;
}) {
  if (!target) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-foreground-muted">
        选择一个正文节点或辅助文件开始编辑
      </div>
    );
  }

  if (target === "content" && contentNode) {
    return (
      <div className="flex h-full flex-col">
        <div className={EDITOR_HEADER_CLASS}>
          <ContentNodeIcon
            hasBody={contentNode.body.trim().length > 0}
            hasChildren={contentNode.children.length > 0}
          />
          <span className="text-[14px] text-foreground">{contentNode.title}</span>
          <SaveStatus saveState={contentSaveState} />
          <span className="shrink-0 text-[11px] text-accent-foreground">
            时间锚点: {timelineLabel}
          </span>
        </div>
        <MainTextEditor
          value={body}
          onChange={onBodyChange}
          placeholder="开始写作..."
          variant="content"
        />
      </div>
    );
  }

  if (target === "aux" && auxNode) {
    if (auxNode.isDeleted) {
      const title =
        auxNode.nodeType === "symlink" && auxNode.symlinkTargetPath
          ? `${auxNode.path} → ${auxNode.symlinkTargetPath}`
          : auxNode.path;

      return (
        <div className="flex h-full flex-col">
          <div className={EDITOR_HEADER_CLASS}>
            <AuxNodeIcon nodeType={auxNode.nodeType} />
            <span className="truncate text-[14px] text-red-300">{title}</span>
            <PendingStatus isPending={auxPending} />
            <span className={`${auxPending ? "" : "ml-auto"}${TIMELINE_LABEL_CLASS}`}>
              时间点: {timelineLabel}
            </span>
          </div>
          <div className="flex flex-1 items-center justify-center px-4 text-sm text-foreground-muted">
            该辅助信息已在当前时间点删除，需要恢复后才可以编辑
          </div>
        </div>
      );
    }

    if (auxNode.nodeType === "file") {
      return (
        <div className="flex h-full flex-col">
          <div className={EDITOR_HEADER_CLASS}>
            <AuxNodeIcon nodeType="file" />
            <span className="truncate text-[14px] text-foreground">{auxNode.path}</span>
            <SaveStatus saveState={auxSaveState} isPending={auxPending} />
            <span className="shrink-0 text-[11px] text-accent-foreground">
              时间点: {timelineLabel}
            </span>
          </div>
          <MainTextEditor
            value={auxContent}
            onChange={onAuxContentChange}
            placeholder="编辑辅助信息..."
            variant="aux"
          />
        </div>
      );
    }

    const placeholder =
      auxNode.nodeType === "dir"
        ? "这是一个文件夹，请选择其中的文件进行编辑"
        : `符号链接，请打开目标文件进行编辑${auxNode.symlinkTargetPath ? `（${auxNode.symlinkTargetPath}）` : ""}`;

    return (
      <div className="flex h-full flex-col">
        <div className={EDITOR_HEADER_CLASS}>
          <AuxNodeIcon nodeType={auxNode.nodeType} />
          <span className="truncate text-[14px] text-foreground">
            {auxNode.nodeType === "symlink" && auxNode.symlinkTargetPath
              ? `${auxNode.path} → ${auxNode.symlinkTargetPath}`
              : auxNode.path}
          </span>
          <PendingStatus isPending={auxPending} />
          <span className={`${auxPending ? "" : "ml-auto"}${TIMELINE_LABEL_CLASS}`}>
            时间点: {timelineLabel}
          </span>
        </div>
        <div className="flex flex-1 items-center justify-center px-4 text-sm text-foreground-muted">
          {isAuxSymlinkTargetPickerActive
            ? "正在选择新的符号链接目标，请从左侧辅助信息树中点击有效节点。"
            : placeholder}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center text-sm text-foreground-muted">
      选择一个正文节点或辅助文件开始编辑
    </div>
  );
}

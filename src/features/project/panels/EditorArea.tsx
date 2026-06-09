import { AuxNodeIcon, ContentNodeIcon } from "@/features/project/components/icons";
import type { AuxTreeNodeVM, ContentTreeNodeVM, SaveState } from "@/features/project/model/types";

const EDITOR_HEADER_CLASS =
  "flex h-10 shrink-0 items-center gap-2 border-b border-border bg-title-bar-background px-4";

function SaveStatus({ saveState }: { saveState: SaveState }) {
  if (saveState.error) {
    return <span className="ml-auto text-[11px] text-red-300">{saveState.error}</span>;
  }

  if (saveState.isSaving) {
    return (
      <span className="text-accent-foreground ml-auto inline-flex items-center gap-1 text-[11px]">
        <span className="icon-[material-symbols--sync] animate-spin text-sm" />
        保存中...
      </span>
    );
  }

  if (saveState.isDirty) {
    return <span className="text-foreground-muted ml-auto text-[11px]">待保存</span>;
  }

  return <span className="text-foreground-muted ml-auto text-[11px]">已同步</span>;
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
  auxRefreshing,
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
  auxRefreshing: boolean;
  onBodyChange: (_value: string) => void;
  onAuxContentChange: (_value: string) => void;
}) {
  if (!target) {
    return (
      <div className="text-foreground-muted flex h-full items-center justify-center text-sm">
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
          <span className="text-foreground text-[14px]">{contentNode.title}</span>
          <SaveStatus saveState={contentSaveState} />
          <span className="text-accent-foreground shrink-0 text-[11px]">
            时间锚点: {timelineLabel}
          </span>
        </div>
        <textarea
          className="bg-editor-background text-editor-foreground flex-1 resize-none border-none p-4 font-mono text-[14px] leading-7 outline-none"
          value={body}
          onChange={(event) => onBodyChange(event.target.value)}
          placeholder="开始写作..."
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
            <span className="text-accent-foreground ml-auto shrink-0 text-[11px]">
              时间点: {timelineLabel}
            </span>
            {auxRefreshing ? (
              <span className="text-foreground-muted shrink-0 text-[11px]">刷新中...</span>
            ) : null}
          </div>
          <div className="text-foreground-muted flex flex-1 items-center justify-center px-4 text-sm">
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
            <span className="text-foreground truncate text-[14px]">{auxNode.path}</span>
            <SaveStatus saveState={auxSaveState} />
            <span className="text-accent-foreground shrink-0 text-[11px]">
              时间点: {timelineLabel}
            </span>
            {auxRefreshing ? (
              <span className="text-foreground-muted shrink-0 text-[11px]">刷新中...</span>
            ) : null}
          </div>
          <textarea
            className="bg-editor-background text-editor-foreground flex-1 resize-none border-none p-4 font-mono text-[14px] leading-7 outline-none"
            value={auxContent}
            onChange={(event) => onAuxContentChange(event.target.value)}
            placeholder="编辑辅助信息..."
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
          <span className="text-foreground truncate text-[14px]">
            {auxNode.nodeType === "symlink" && auxNode.symlinkTargetPath
              ? `${auxNode.path} → ${auxNode.symlinkTargetPath}`
              : auxNode.path}
          </span>
          <span className="text-accent-foreground ml-auto shrink-0 text-[11px]">
            时间点: {timelineLabel}
          </span>
          {auxRefreshing ? (
            <span className="text-foreground-muted shrink-0 text-[11px]">刷新中...</span>
          ) : null}
        </div>
        <div className="text-foreground-muted flex flex-1 items-center justify-center px-4 text-sm">
          {placeholder}
        </div>
      </div>
    );
  }

  return (
    <div className="text-foreground-muted flex h-full items-center justify-center text-sm">
      选择一个正文节点或辅助文件开始编辑
    </div>
  );
}

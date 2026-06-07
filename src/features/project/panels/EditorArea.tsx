import { ContentNodeIcon } from "@/features/project/components/icons";
import type { ContentTreeNodeVM, SaveState } from "@/features/project/model/types";

export function EditorArea({
  node,
  body,
  timelineLabel,
  saveState,
  onBodyChange,
}: {
  node: ContentTreeNodeVM | null;
  body: string;
  timelineLabel: string;
  saveState: SaveState;
  onBodyChange: (_value: string) => void;
}) {
  if (!node) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-foreground-muted">
        选择一个正文节点开始编辑
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-title-bar-background px-4 py-2">
        <ContentNodeIcon
          hasBody={node.body.trim().length > 0}
          hasChildren={node.children.length > 0}
        />
        <span className="text-[14px] text-foreground">{node.title}</span>
        {saveState.error ? (
          <span className="ml-auto text-[11px] text-red-300">{saveState.error}</span>
        ) : saveState.isSaving ? (
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-accent-foreground">
            <span className="icon-[material-symbols--sync] animate-spin text-sm" />
            保存中...
          </span>
        ) : saveState.isDirty ? (
          <span className="ml-auto text-[11px] text-foreground-muted">待保存</span>
        ) : (
          <span className="ml-auto text-[11px] text-foreground-muted">已同步</span>
        )}
        <span className="shrink-0 text-[11px] text-accent-foreground">
          时间锚点: {timelineLabel}
        </span>
      </div>
      <textarea
        className="flex-1 resize-none border-none bg-editor-background p-4 font-mono text-[14px] leading-7 text-editor-foreground outline-none"
        value={body}
        onChange={(event) => onBodyChange(event.target.value)}
        placeholder="开始写作..."
      />
    </div>
  );
}

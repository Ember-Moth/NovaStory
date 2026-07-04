import { AutoTransition } from "auto-transition";
import { useState } from "react";
import { AuxNodeIcon, ContentNodeIcon } from "@/modules/workspace/ui/editor/components/icons";
import type {
  AuxTreeNodeVM,
  ContentTreeNodeVM,
  SaveState,
} from "@/modules/workspace/ui/editor/model/types";
import { cn } from "@/shared/lib/cn";
import { MainTextEditor } from "@/shared/ui/editor/MainTextEditor";
import { WorkspaceMarkdownPreview } from "./WorkspaceMarkdownPreview";

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
    return (
      <span key={`error:${saveState.error}`} className="ml-auto shrink-0 text-[11px] text-red-300">
        {saveState.error}
      </span>
    );
  }

  if (saveState.isSaving || isPending) {
    return (
      <span key="saving" className={STATUS_LABEL_CLASS}>
        保存中
      </span>
    );
  }

  if (saveState.isDirty) {
    return (
      <span key="dirty" className={STATUS_LABEL_CLASS}>
        待保存
      </span>
    );
  }

  return (
    <span key="synced" className={STATUS_LABEL_CLASS}>
      已同步
    </span>
  );
}

function PendingStatus({ isPending }: { isPending: boolean }) {
  if (!isPending) {
    return null;
  }

  return <span className={STATUS_LABEL_CLASS}>保存中</span>;
}

function PreviewToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (_checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={checked ? "切回编辑" : "切换预览"}
      onClick={() => onChange(!checked)}
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1.5 rounded border px-2 text-[11px] leading-none transition",
        checked
          ? "border-accent-foreground/45 bg-accent-background/35 text-accent-foreground"
          : "border-border bg-editor-background text-foreground-muted hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "text-sm leading-none",
          checked
            ? "icon-[material-symbols--visibility]"
            : "icon-[material-symbols--visibility-off]",
        )}
      />
      预览
    </button>
  );
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
  const [isPreviewMode, setIsPreviewMode] = useState(false);

  if (!target) {
    return (
      <div className="flex h-full items-center justify-center text-foreground-muted text-sm">
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
          <span className="min-w-0 truncate text-[14px] text-foreground">{contentNode.title}</span>
          <SaveStatus saveState={contentSaveState} />
          <PreviewToggle checked={isPreviewMode} onChange={setIsPreviewMode} />
          <span className="shrink-0 text-[11px] text-accent-foreground">
            时间锚点: {timelineLabel}
          </span>
        </div>
        {isPreviewMode ? (
          <WorkspaceMarkdownPreview content={body} emptyLabel="暂无正文可预览" />
        ) : (
          <MainTextEditor
            value={body}
            onChange={onBodyChange}
            placeholder="开始写作..."
            variant="content"
          />
        )}
      </div>
    );
  }

  if (target === "aux" && auxNode) {
    if (auxNode.nodeType === "file") {
      return (
        <AutoTransition as="div" className="flex h-full flex-col">
          <AutoTransition as="div" className={EDITOR_HEADER_CLASS}>
            <AuxNodeIcon nodeType="file" />
            <span className="min-w-0 truncate text-[14px] text-foreground">{auxNode.path}</span>
            <SaveStatus saveState={auxSaveState} isPending={auxPending} />
            <PreviewToggle checked={isPreviewMode} onChange={setIsPreviewMode} />
            <span className="shrink-0 text-[11px] text-accent-foreground">
              时间点: {timelineLabel}
            </span>
          </AutoTransition>
          {isPreviewMode ? (
            <WorkspaceMarkdownPreview content={auxContent} emptyLabel="暂无辅助信息可预览" />
          ) : (
            <MainTextEditor
              value={auxContent}
              onChange={onAuxContentChange}
              placeholder="编辑辅助信息..."
              variant="aux"
            />
          )}
        </AutoTransition>
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
          <span className="min-w-0 truncate text-[14px] text-foreground">
            {auxNode.nodeType === "symlink" && auxNode.symlinkTargetPath
              ? `${auxNode.path} → ${auxNode.symlinkTargetPath}`
              : auxNode.path}
          </span>
          <PendingStatus isPending={auxPending} />
          <span className={`${auxPending ? "" : "ml-auto"}${TIMELINE_LABEL_CLASS}`}>
            时间点: {timelineLabel}
          </span>
        </div>
        <div className="flex flex-1 items-center justify-center px-4 text-foreground-muted text-sm">
          {isAuxSymlinkTargetPickerActive
            ? "正在选择新的符号链接目标，请从左侧辅助信息树中点击有效节点。"
            : placeholder}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center text-foreground-muted text-sm">
      选择一个正文节点或辅助文件开始编辑
    </div>
  );
}

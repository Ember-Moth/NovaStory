import { LoadingBlock } from "@/shared/ui/Loading";

import type { ChangeAreas, WorkingTreeStatus } from "../../shared/projectTypes";
import { InlineError } from "../../shared/projectUi";
import { ChangeAreasView } from "./ChangeAreasView";

export function WorkingTreeStatusPanel({
  status,
  loading,
  error,
  discardError,
  onRevertContentChange,
  onRevertTimelineChange,
  onRevertAuxChange,
}: {
  status: WorkingTreeStatus | null;
  loading: boolean;
  error: string | null;
  discardError: string | null;
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
    <section className="relative mt-2 bg-editor-background">
      <div className="flex items-center gap-1">
        <span className="icon-[material-symbols--difference] text-base text-accent-foreground" />
        <h4 className="text-xs font-medium text-foreground-muted">未提交变更</h4>
      </div>

      <div className="mt-2 space-y-2">
        {error ? <InlineError message={error} /> : null}
        {discardError ? <InlineError message={discardError} /> : null}
        {loading ? (
          <LoadingBlock label="正在对比工作区与 HEAD..." />
        ) : status == null ? null : !status.hasChanges ? (
          <p className="text-sm text-foreground-muted">
            {status.headCommitId == null
              ? "尚无提交，当前工作区无变更。"
              : "工作区与 HEAD 一致，无未提交变更。"}
          </p>
        ) : (
          <ChangeAreasView
            areas={status.areas}
            onRevertContentChange={onRevertContentChange}
            onRevertTimelineChange={onRevertTimelineChange}
            onRevertAuxChange={onRevertAuxChange}
          />
        )}
      </div>
    </section>
  );
}

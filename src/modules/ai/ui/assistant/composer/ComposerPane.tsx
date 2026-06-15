import type { AiAssistantController } from "../runtime/useAiAssistantController";
import { AllowWritesToggle } from "./AllowWritesToggle";
import { AssistantComposer } from "./AssistantComposer";
import { ModelPicker } from "./ModelPicker";

export function ComposerPane({ controller }: { controller: AiAssistantController }) {
  return (
    <form className="shrink-0" aria-label="AI 对话输入">
      <div className="space-y-2 p-2">
        <div className="overflow-hidden rounded-lg border border-border bg-editor-background focus-within:border-accent-foreground">
          <AssistantComposer
            disabled={
              controller.isLoadingSelection ||
              !controller.selectedModelId ||
              !controller.selectedConnectionId ||
              controller.isThreadBusy
            }
            placeholder={
              controller.isWaitingForInput
                ? "等待回答，可继续编辑草稿..."
                : controller.isLoadingSelection
                  ? "加载模型选择中..."
                  : controller.selectedConnectionId && controller.selectedModelId
                    ? "输入消息..."
                    : "选择可用模型后输入..."
            }
            isBusy={controller.isBusy}
            initialValue={controller.draft}
            onTextChange={controller.setDraft}
            onPayloadChange={(payload) => controller.setDraftMentionCount(payload.mentions.length)}
            onSubmit={controller.handleSubmit}
          />
          <div className="mt-1 flex min-w-0 items-center gap-2 px-1.5 pb-1.5">
            <ModelPicker
              selectedConnectionId={controller.selectedConnectionId}
              selectedModelId={controller.selectedModelId}
              selectionHydrated={controller.selectionHydrated}
              onSelectionChange={controller.handleSelectionChange}
              onSelectionCommit={controller.handleSelectionCommit}
            />
            {controller.isGenerating || controller.isWaitingForInput ? (
              <button
                type="button"
                onClick={controller.handleAbort}
                title={controller.isWaitingForInput ? "停止等待" : "终止生成"}
                aria-label={controller.isWaitingForInput ? "停止等待" : "终止生成"}
                className="bg-destructive flex size-7 shrink-0 items-center justify-center rounded-md text-white transition hover:brightness-110"
              >
                <span className="icon-[material-symbols--stop] text-base" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!controller.canSubmit}
                title={controller.canSubmit ? "发送" : "当前无法发送"}
                aria-label="发送"
                className={`flex size-7 shrink-0 items-center justify-center rounded-md transition disabled:cursor-not-allowed ${
                  controller.canSubmit
                    ? "bg-accent-foreground text-sidebar-background hover:brightness-110"
                    : "text-foreground-muted hover:bg-list-hover-background"
                }`}
              >
                <span
                  className={`text-base ${
                    controller.isBusy
                      ? "icon-[material-symbols--progress-activity] animate-spin"
                      : "icon-[material-symbols--arrow-upward]"
                  }`}
                />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-[11px] text-foreground-muted">
          <AllowWritesToggle
            disabled={controller.isBusy || !controller.selectedModelSupportsToolUse}
            checked={controller.allowWritesForNextSend}
            onToggle={() => controller.setAllowWritesForNextSend((current) => !current)}
          />
        </div>
      </div>
    </form>
  );
}

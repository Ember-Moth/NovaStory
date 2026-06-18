import { useEffect, useMemo, useState } from "react";

import type { ProjectAssistantToolName } from "@/modules/ai/domain/types";
import { rpc } from "@/rpc/client";

import { buildProjectAssistantSendActiveTools } from "../assistant/runtime/activeTools";
import { AllowWritesToggle } from "../assistant/composer/AllowWritesToggle";
import {
  AssistantComposer,
  type AssistantComposerSubmitPayload,
} from "../assistant/composer/AssistantComposer";
import { ModelPicker } from "../assistant/composer/ModelPicker";
import { normalizeConnectionModels } from "../shared/modelSelection/normalizeConnectionModels";

function getSelectedModelCapabilities(
  groups: Array<{
    connection: { id: string };
    models: Array<{ id: string; supportsToolUse: boolean }>;
  }> | null,
  selectedConnectionId: string,
  selectedModelId: string,
) {
  const group = groups?.find((entry) => entry.connection.id === selectedConnectionId);
  const model = group?.models.find((entry) => entry.id === selectedModelId);
  return {
    supportsToolUse: model?.supportsToolUse ?? false,
  };
}

export function ChatComposerPane({
  selectedConnectionId,
  selectedModelId,
  isBusy,
  onSelectionCommit,
  onSubmit,
}: {
  selectedConnectionId: string;
  selectedModelId: string;
  isBusy: boolean;
  onSelectionCommit: (_connectionId: string, _modelId: string) => void;
  onSubmit: (
    _payload: AssistantComposerSubmitPayload,
    _activeTools: ProjectAssistantToolName[],
  ) => void;
}) {
  const [draftConnectionId, setDraftConnectionId] = useState(selectedConnectionId);
  const [draftModelId, setDraftModelId] = useState(selectedModelId);
  const [allowWrites, setAllowWrites] = useState(false);
  const groupsQuery = rpc.useQuery("ai.listEnabledConnectionModels");
  const groups = useMemo(
    () =>
      normalizeConnectionModels(groupsQuery.data) as Array<{
        connection: { id: string };
        models: Array<{ id: string; supportsToolUse: boolean }>;
      }>,
    [groupsQuery.data],
  );
  const selectedModelCapabilities = getSelectedModelCapabilities(
    groups,
    draftConnectionId,
    draftModelId,
  );
  const canSend = !isBusy && !!draftConnectionId && !!draftModelId;

  useEffect(() => {
    setDraftConnectionId(selectedConnectionId);
    setDraftModelId(selectedModelId);
  }, [selectedConnectionId, selectedModelId]);

  return (
    <form className="shrink-0" aria-label="AI 对话输入">
      <div className="space-y-2 p-2">
        <div className="overflow-hidden rounded-lg border border-border bg-editor-background focus-within:border-accent-foreground">
          <AssistantComposer
            disabled={!canSend}
            placeholder={
              groupsQuery.isInitialLoading
                ? "加载模型选择中..."
                : canSend
                  ? "输入消息..."
                  : "选择可用模型后输入..."
            }
            isBusy={isBusy}
            onSubmit={(payload) => {
              const activeTools = selectedModelCapabilities.supportsToolUse
                ? buildProjectAssistantSendActiveTools({ allowWrites })
                : [];
              onSubmit(payload, activeTools);
              return true;
            }}
          />
          <div className="mt-1 flex min-w-0 items-center gap-2 px-1.5 pb-1.5">
            <ModelPicker
              selectedConnectionId={draftConnectionId}
              selectedModelId={draftModelId}
              selectionHydrated={!groupsQuery.isInitialLoading}
              onSelectionChange={(connectionId, modelId) => {
                setDraftConnectionId(connectionId);
                setDraftModelId(modelId);
              }}
              onSelectionCommit={(connectionId, modelId) => {
                setDraftConnectionId(connectionId);
                setDraftModelId(modelId);
                onSelectionCommit(connectionId, modelId);
              }}
            />
            <button
              type="submit"
              disabled={!canSend}
              title={canSend ? "发送" : "当前无法发送"}
              aria-label="发送"
              className={`flex size-7 shrink-0 items-center justify-center rounded-md transition disabled:cursor-not-allowed ${
                canSend
                  ? "bg-accent-foreground text-sidebar-background hover:brightness-110"
                  : "text-foreground-muted hover:bg-list-hover-background"
              }`}
            >
              <span
                className={`text-base ${
                  isBusy
                    ? "icon-[material-symbols--progress-activity] animate-spin"
                    : "icon-[material-symbols--arrow-upward]"
                }`}
              />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-[11px] text-foreground-muted">
          <AllowWritesToggle
            disabled={isBusy || !selectedModelCapabilities.supportsToolUse}
            checked={allowWrites}
            onToggle={() => setAllowWrites((current) => !current)}
          />
        </div>
      </div>
    </form>
  );
}

import { type ReactNode, useEffect, useMemo, useState } from "react";

import {
  AI_ASSISTANT_MAX_STEPS_DEFAULT,
  AI_ASSISTANT_MAX_STEPS_MAX,
  AI_ASSISTANT_MAX_STEPS_MIN,
} from "@/modules/config/domain/ai-assistant-options";
import { rpc } from "@/rpc/client";

import { normalizeConnectionModels } from "../../shared/modelSelection/normalizeConnectionModels";
import { SettingsPageShell } from "../layout/SettingsPageShell";
import { DefaultModelSelect } from "./DefaultModelSelect";
import { MaxStepsField } from "./MaxStepsField";

type ConnectionModelGroup = NonNullable<
  ReturnType<typeof rpc.useQuery<"ai.listEnabledConnectionModels">>["data"]
>[number];
type ResolvedModel = ConnectionModelGroup["models"][number];

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "保存失败。";
}

export function ConfigSettingsPage() {
  const { data: storedSelection, isInitialLoading: selectionLoading } = rpc.useQuery(
    "config.getAiAssistantModelSelection",
  );
  const { data: maxSteps, isInitialLoading: maxStepsLoading } = rpc.useQuery(
    "config.getAiAssistantMaxSteps",
  );
  const { data: connectionModelGroups, isInitialLoading: modelsLoading } = rpc.useQuery(
    "ai.listEnabledConnectionModels",
  );
  const saveSelection = rpc.useMutation("config.setAiAssistantModelSelection", {
    onSuccess: (selection) => {
      rpc.setQueryData("config.getAiAssistantModelSelection", undefined, selection);
    },
  });
  const saveMaxSteps = rpc.useMutation("config.setAiAssistantMaxSteps", {
    onSuccess: (value) => {
      rpc.setQueryData("config.getAiAssistantMaxSteps", undefined, value);
    },
  });

  const [maxStepsInput, setMaxStepsInput] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const groups = useMemo(
    () =>
      normalizeConnectionModels(connectionModelGroups) as Array<{
        connection: ConnectionModelGroup["connection"];
        models: ResolvedModel[];
      }>,
    [connectionModelGroups],
  );
  const selectableModels = groups.flatMap((group) =>
    group.models.map((model) => ({
      connection: group.connection,
      model,
    })),
  );
  const selectedOption =
    selectableModels.find(
      (option) =>
        option.connection.id === storedSelection?.connectionId &&
        option.model.id === storedSelection.modelId,
    ) ?? null;
  const isSaving = saveSelection.isPending || saveMaxSteps.isPending;

  useEffect(() => {
    if (typeof maxSteps === "number") {
      setMaxStepsInput(String(maxSteps));
    }
  }, [maxSteps]);

  const handleSelectModel = async (connectionId: string, modelId: string) => {
    setActionError(null);
    try {
      await saveSelection.mutate({ connectionId, modelId });
    } catch (error) {
      setActionError(getErrorMessage(error));
    }
  };

  const handleClearModel = async () => {
    setActionError(null);
    try {
      await saveSelection.mutate(null);
    } catch (error) {
      setActionError(getErrorMessage(error));
    }
  };

  const handleMaxStepsInputChange = (value: string) => {
    setMaxStepsInput(value);
    setActionError(null);
  };

  const commitMaxStepsInput = async (value = maxStepsInput) => {
    const normalizedValue = value.trim();
    if (!normalizedValue) {
      try {
        await saveMaxSteps.mutate(null);
      } catch (error) {
        setActionError(getErrorMessage(error));
      }
      return;
    }

    const nextValue = Number(normalizedValue);
    if (
      !Number.isFinite(nextValue) ||
      nextValue < AI_ASSISTANT_MAX_STEPS_MIN ||
      nextValue > AI_ASSISTANT_MAX_STEPS_MAX
    ) {
      setActionError(
        `最大步数必须是 ${AI_ASSISTANT_MAX_STEPS_MIN}-${AI_ASSISTANT_MAX_STEPS_MAX} 之间的数字。`,
      );
      return;
    }

    try {
      await saveMaxSteps.mutate(Math.trunc(nextValue));
    } catch (error) {
      setActionError(getErrorMessage(error));
    }
  };

  const handleResetMaxSteps = async () => {
    setActionError(null);
    setMaxStepsInput("");
    try {
      await saveMaxSteps.mutate(null);
    } catch (error) {
      setActionError(getErrorMessage(error));
    }
  };

  return (
    <SettingsPageShell
      title="AI 配置"
      summary={
        <>
          {selectedOption
            ? `默认模型：${selectedOption.connection.name} / ${selectedOption.model.displayName}`
            : "尚未选择默认模型"}{" "}
          · 最大步数：{maxSteps ?? AI_ASSISTANT_MAX_STEPS_DEFAULT}
        </>
      }
      actions={
        isSaving ? (
          <div className="inline-flex items-center gap-1.5 text-foreground-muted text-xs">
            <span className="icon-[material-symbols--sync] animate-spin text-base" />
            保存中
          </div>
        ) : null
      }
    >
      <main className="min-h-0 flex-1 overflow-y-auto bg-editor-background p-4">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
          {actionError ? (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-200 text-sm">
              {actionError}
            </div>
          ) : null}

          <SettingsSection
            title="助手默认值"
            description="这些配置会作为项目 AI 助手启动和续写时的默认行为。"
          >
            <SettingsFieldRow label="默认模型" description="选择项目 AI 助手默认使用的连接和模型。">
              <DefaultModelSelect
                groups={groups}
                selectedConnectionId={storedSelection?.connectionId ?? ""}
                selectedModelId={storedSelection?.modelId ?? ""}
                loading={selectionLoading || modelsLoading}
                disabled={saveSelection.isPending}
                onSelect={handleSelectModel}
                onClear={() => void handleClearModel()}
              />
            </SettingsFieldRow>

            <SettingsFieldRow
              label="最大步数"
              description={`限制单次助手运行可执行的最大步骤数，留空或重置会恢复默认值 ${AI_ASSISTANT_MAX_STEPS_DEFAULT}。`}
            >
              <MaxStepsField
                value={maxStepsInput}
                loading={maxStepsLoading}
                isPending={saveMaxSteps.isPending}
                onChange={handleMaxStepsInputChange}
                onCommit={(value) => void commitMaxStepsInput(value)}
                onReset={() => void handleResetMaxSteps()}
              />
            </SettingsFieldRow>
          </SettingsSection>
        </div>
      </main>
    </SettingsPageShell>
  );
}

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-md border border-border bg-sidebar-background">
      <div className="border-border border-b px-4 py-3">
        <h2 className="font-semibold text-foreground text-sm">{title}</h2>
        <p className="mt-1 text-foreground-muted text-xs">{description}</p>
      </div>
      <div className="divide-y divide-border">{children}</div>
    </section>
  );
}

function SettingsFieldRow({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-3 px-4 py-4 lg:grid-cols-[minmax(12rem,0.34fr)_minmax(0,1fr)]">
      <div>
        <div className="font-medium text-foreground text-sm">{label}</div>
        <div className="mt-1 text-foreground-muted text-xs leading-5">{description}</div>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

import { useMemo, useState } from "react";

import type { AiConnectionRow, AiResolvedModelView } from "@/modules/ai/domain/types";
import { rpc } from "@/rpc/client";
import { LoadingInline } from "@/shared/ui/Loading";
import { RefreshOverlay } from "@/shared/ui/RefreshOverlay";

import { fmtContextWindow, fmtPrice, maskApiKey } from "./format";

function ConnectionModelRow({
  model,
  isBusy,
  onToggleCatalogModel,
  onEditCustomModel,
  onDeleteCustomModel,
}: {
  model: AiResolvedModelView;
  isBusy: boolean;
  onToggleCatalogModel: (_model: AiResolvedModelView, _enabled: boolean) => Promise<void>;
  onEditCustomModel: (_model: AiResolvedModelView) => void;
  onDeleteCustomModel: (_model: AiResolvedModelView) => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-border bg-editor-background px-3 py-2">
      <button
        type="button"
        disabled={isBusy}
        onClick={() => {
          if (model.origin !== "catalog") return;
          void onToggleCatalogModel(model, !model.isEnabled);
        }}
        className={`mt-0.5 rounded-full px-2 py-0.5 text-[10px] font-medium transition ${
          model.origin === "catalog"
            ? model.isEnabled
              ? "bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
              : "bg-white/5 text-foreground-muted hover:bg-white/10"
            : model.isEnabled
              ? "bg-sky-500/10 text-sky-300"
              : "bg-white/5 text-foreground-muted"
        } disabled:cursor-not-allowed disabled:opacity-50`}
      >
        {model.origin === "catalog" ? (model.isEnabled ? "已启用" : "已隐藏") : "自定义"}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{model.displayName}</span>
          <span className="font-mono text-[11px] text-foreground-muted">{model.modelId}</span>
          {model.origin === "catalog" ? (
            <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-foreground-muted">
              Catalog
            </span>
          ) : null}
        </div>
        <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-foreground-muted">
          <span>上下文 {fmtContextWindow(model.contextWindow)}</span>
          <span>输出 {fmtContextWindow(model.maxOutputTokens)}</span>
          <span>
            价格 {fmtPrice(model.inputPricePer1m)}/{fmtPrice(model.outputPricePer1m)}
          </span>
          {model.supportsVision ? <span>视觉</span> : null}
          {model.supportsToolUse ? <span>工具</span> : null}
          {model.supportsReasoning ? <span>推理</span> : null}
        </div>
      </div>
      {model.origin === "custom" ? (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onEditCustomModel(model)}
            className="rounded p-1 text-foreground-muted transition hover:bg-button-hover-background hover:text-foreground"
            title="编辑自定义模型"
          >
            <span className="icon-[material-symbols--edit] text-sm" />
          </button>
          <button
            type="button"
            onClick={() => onDeleteCustomModel(model)}
            className="rounded p-1 text-foreground-muted transition hover:bg-button-hover-background hover:text-foreground"
            title="删除自定义模型"
          >
            <span className="icon-[material-symbols--delete-outline] text-sm" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function ConnectionCard({
  connection,
  providerName,
  onEdit,
  onDelete,
  onOpenAddCustomModel,
  onOpenEditCustomModel,
  onDeleteCustomModel,
}: {
  connection: AiConnectionRow;
  providerName: string | null;
  onEdit: (_connection: AiConnectionRow) => void;
  onDelete: (_connection: AiConnectionRow) => void;
  onOpenAddCustomModel: (_connection: AiConnectionRow) => void;
  onOpenEditCustomModel: (_connection: AiConnectionRow, _model: AiResolvedModelView) => void;
  onDeleteCustomModel: (_connection: AiConnectionRow, _model: AiResolvedModelView) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="overflow-hidden rounded-md border border-border bg-sidebar-background">
      <div className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-list-hover-background">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          aria-expanded={expanded}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-semibold text-foreground">
                {connection.name}
              </span>
              <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-foreground-muted">
                {connection.kind === "registry" ? "Registry" : "Custom"}
              </span>
              {!connection.isEnabled ? (
                <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-foreground-muted">
                  已禁用
                </span>
              ) : null}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-foreground-muted">
              <span className="font-mono">{connection.sdkPackage}</span>
              {providerName ? <span>来源 {providerName}</span> : null}
              <span>{maskApiKey(connection.apiKey)}</span>
            </div>
          </div>
          <span
            className={`text-xl text-foreground-muted ${expanded ? "icon-[material-symbols--keyboard-arrow-up]" : "icon-[material-symbols--keyboard-arrow-down]"}`}
          />
        </button>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onEdit(connection)}
            className="rounded p-1 text-foreground-muted transition hover:bg-button-hover-background hover:text-foreground"
            title="编辑连接"
          >
            <span className="icon-[material-symbols--edit] text-sm" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(connection)}
            className="rounded p-1 text-foreground-muted transition hover:bg-button-hover-background hover:text-foreground"
            title="删除连接"
          >
            <span className="icon-[material-symbols--delete-outline] text-sm" />
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="border-t border-border px-4 py-3">
          {connection.baseUrl ? (
            <div className="mb-2 text-[11px] text-foreground-muted">
              Endpoint {connection.baseUrl}
            </div>
          ) : null}
          <div className="mb-3">
            <button
              type="button"
              onClick={() => onOpenAddCustomModel(connection)}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-foreground transition hover:bg-list-hover-background"
            >
              <span className="icon-[material-symbols--add] text-sm" />
              添加自定义模型
            </button>
          </div>

          <ConnectionModelsList
            connection={connection}
            onOpenEditCustomModel={onOpenEditCustomModel}
            onDeleteCustomModel={onDeleteCustomModel}
          />
        </div>
      ) : null}
    </div>
  );
}

function ConnectionModelsList({
  connection,
  onOpenEditCustomModel,
  onDeleteCustomModel,
}: {
  connection: AiConnectionRow;
  onOpenEditCustomModel: (_connection: AiConnectionRow, _model: AiResolvedModelView) => void;
  onDeleteCustomModel: (_connection: AiConnectionRow, _model: AiResolvedModelView) => void;
}) {
  const resolvedModelsInput = useMemo(
    () => ({
      connectionId: connection.id,
      includeDisabled: true,
    }),
    [connection.id],
  );
  const {
    data: models,
    isInitialLoading,
    isRefetching,
    isStale,
  } = rpc.useQuery("ai.listResolvedModels", resolvedModelsInput);
  const toggleCatalogModel = rpc.useMutation("ai.setCatalogModelEnabled", {
    onSuccess: (data, input) => {
      rpc.setQueryData(
        "ai.listResolvedModels",
        { connectionId: input.connectionId, includeDisabled: true },
        data,
      );
    },
  });
  const hasLoadedModels = models !== undefined;
  const isRefreshing = hasLoadedModels && (isRefetching || isStale);

  if (!hasLoadedModels && isInitialLoading) {
    return <LoadingInline label="加载模型中..." />;
  }

  if ((models ?? []).length === 0) {
    return <div className="py-4 text-sm text-foreground-muted">这个连接当前没有可见模型。</div>;
  }

  return (
    <div className="relative" aria-busy={isRefreshing}>
      <RefreshOverlay active={isRefreshing} className="top-0 right-0" />
      <div
        inert={isRefreshing}
        className={`space-y-2 transition-opacity ${
          isRefreshing ? "pointer-events-none opacity-80 select-none" : ""
        }`}
      >
        {(models ?? []).map((model) => (
          <ConnectionModelRow
            key={model.id}
            model={model}
            isBusy={toggleCatalogModel.isPending}
            onToggleCatalogModel={async (currentModel, enabled) => {
              if (!currentModel.catalogModelId) return;
              await toggleCatalogModel.mutate({
                connectionId: connection.id,
                catalogModelId: currentModel.catalogModelId,
                enabled,
              });
            }}
            onEditCustomModel={(model) => onOpenEditCustomModel(connection, model)}
            onDeleteCustomModel={(model) => onDeleteCustomModel(connection, model)}
          />
        ))}
      </div>
    </div>
  );
}

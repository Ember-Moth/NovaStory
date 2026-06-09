import { type FormEvent, useEffect, useRef, useState } from "react";

import { AppShell, AppSidebar } from "@/client/components/AppShell";
import {
  type AiConnectionConfig,
  normalizeAiConnectionConfig,
  parseAiConnectionConfig,
} from "@/domain/ai-config";
import { type AiSupportedSdkPackage, getAiSdkPackageRecipe } from "@/domain/ai-packages";
import type {
  AiCatalogProviderView,
  AiConnectionCustomModelRow,
  AiConnectionRow,
  AiResolvedModelView,
} from "@/domain/types";
import { OverlayScrollbar } from "@/features/project/components/OverlayScrollbar";
import { RefreshOverlay } from "@/features/project/components/RefreshOverlay";
import { SidebarListRow } from "@/features/project/components/nodes/SidebarListRow";
import { rpc } from "@/server/rpc/client";
import { LoadingBlock, LoadingInline } from "@/shared/components/Loading";

interface ConnectionFormData {
  kind: "registry" | "custom";
  name: string;
  catalogProviderId: string | null;
  sdkPackage: string | null;
  baseUrl: string | null;
  apiKey: string | null;
  apiKeyChanged: boolean;
  config: AiConnectionConfig;
  isEnabled: boolean;
}

interface CustomModelFormData {
  modelId: string;
  displayName: string;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  supportsVision: boolean;
  supportsToolUse: boolean;
  supportsReasoning: boolean;
  supportsTemperature: boolean;
  inputPricePer1m: number | null;
  outputPricePer1m: number | null;
  isEnabled: boolean;
}

function normalizeConnectionKind(kind: string | null | undefined): "registry" | "custom" {
  return kind === "custom" ? "custom" : "registry";
}

function fmtContextWindow(value: number | null): string {
  if (value == null) return "—";
  if (value >= 1_000_000) return `${Math.round(value / 1_000_000)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return `${value}`;
}

function fmtPrice(value: number | null): string {
  if (value == null) return "—";
  if (value >= 1) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(3)}`;
}

function maskApiKey(key: string | null): string {
  if (!key) return "未设置";
  if (key.length <= 8) return "••••••••";
  return `${key.slice(0, 3)}...${key.slice(-4)}`;
}

function normalizeFormConnectionConfig(
  sdkPackage: string | null | undefined,
  config: AiConnectionConfig | null | undefined,
): AiConnectionConfig {
  if (!sdkPackage) return {};
  return normalizeAiConnectionConfig({ sdkPackage, config });
}

function CatalogProviderModels({ catalogProviderId }: { catalogProviderId: string }) {
  const { data: models, isLoading } = rpc.useQuery("ai.listCatalogModels", {
    catalogProviderId,
    activeOnly: false,
  });

  if (isLoading) {
    return <LoadingInline label="加载模型中..." />;
  }

  return (
    <div className="space-y-2">
      {(models ?? []).map((model) => (
        <div
          key={model.id}
          className="border-border bg-editor-background rounded-md border px-3 py-2 text-xs"
        >
          <div className="flex items-center gap-2">
            <span className="text-foreground font-medium">{model.displayName}</span>
            <span className="text-foreground-muted font-mono">{model.modelId}</span>
            {!model.isActive ? (
              <span className="text-foreground-muted rounded-full bg-white/5 px-2 py-0.5 text-[10px]">
                已失活
              </span>
            ) : null}
          </div>
          <div className="text-foreground-muted mt-1 flex flex-wrap gap-3 text-[11px]">
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
      ))}
    </div>
  );
}

function CatalogProviderCard({
  provider,
  onQuickConnect,
}: {
  provider: AiCatalogProviderView;
  onQuickConnect: (_providerId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-border bg-sidebar-background rounded-md border">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="hover:bg-list-hover-background bg-sidebar-background sticky top-0 z-10 flex w-full items-center gap-3 rounded-md px-4 py-3 text-left transition"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-foreground truncate text-sm font-semibold">{provider.name}</span>
            {provider.isSupported ? (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  onQuickConnect(provider.id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation();
                    onQuickConnect(provider.id);
                  }
                }}
                className="cursor-pointer rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300 transition hover:bg-emerald-500/20"
              >
                快速接入
              </span>
            ) : (
              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                暂不支持
              </span>
            )}
            {!provider.isActive ? (
              <span className="text-foreground-muted rounded-full bg-white/5 px-2 py-0.5 text-[10px]">
                已失活
              </span>
            ) : null}
          </div>
          <div className="text-foreground-muted mt-1 flex flex-wrap items-center gap-2 text-[11px]">
            <span className="font-mono">{provider.sdkPackage ?? "无 npm package"}</span>
            <span>{provider.modelCount} 个模型</span>
          </div>
        </div>
        <span
          className={`text-foreground-muted text-xl ${expanded ? "icon-[material-symbols--keyboard-arrow-up]" : "icon-[material-symbols--keyboard-arrow-down]"}`}
        />
      </button>

      {expanded ? (
        <div className="border-border border-t px-4 py-3">
          <div className="text-foreground-muted mb-3 space-y-1 text-[11px]">
            <div>API: {provider.apiUrl ?? "—"}</div>
            <div>ENV: {provider.envKeys.length > 0 ? provider.envKeys.join(", ") : "—"}</div>
            {provider.docsUrl ? (
              <a
                href={provider.docsUrl}
                target="_blank"
                rel="noreferrer"
                className="text-accent-foreground inline-flex items-center gap-1 hover:underline"
              >
                文档
                <span className="icon-[material-symbols--open-in-new] text-xs" />
              </a>
            ) : null}
          </div>

          <CatalogProviderModels catalogProviderId={provider.id} />
        </div>
      ) : null}
    </div>
  );
}

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
    <div className="border-border bg-editor-background flex items-start gap-3 rounded-md border px-3 py-2">
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
              : "text-foreground-muted bg-white/5 hover:bg-white/10"
            : model.isEnabled
              ? "bg-sky-500/10 text-sky-300"
              : "text-foreground-muted bg-white/5"
        } disabled:cursor-not-allowed disabled:opacity-50`}
      >
        {model.origin === "catalog" ? (model.isEnabled ? "已启用" : "已隐藏") : "自定义"}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-foreground truncate text-sm font-medium">{model.displayName}</span>
          <span className="text-foreground-muted font-mono text-[11px]">{model.modelId}</span>
          {model.origin === "catalog" ? (
            <span className="text-foreground-muted rounded-full bg-white/5 px-2 py-0.5 text-[10px]">
              Catalog
            </span>
          ) : null}
        </div>
        <div className="text-foreground-muted mt-1 flex flex-wrap gap-3 text-[11px]">
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
            className="text-foreground-muted hover:bg-button-hover-background hover:text-foreground rounded p-1 transition"
            title="编辑自定义模型"
          >
            <span className="icon-[material-symbols--edit] text-sm" />
          </button>
          <button
            type="button"
            onClick={() => onDeleteCustomModel(model)}
            className="text-foreground-muted hover:bg-button-hover-background hover:text-foreground rounded p-1 transition"
            title="删除自定义模型"
          >
            <span className="icon-[material-symbols--delete-outline] text-sm" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ConnectionCard({
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
    <div className="border-border bg-sidebar-background overflow-hidden rounded-md border">
      <div className="hover:bg-list-hover-background flex w-full items-center gap-3 px-4 py-3 text-left transition">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          aria-expanded={expanded}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-foreground truncate text-sm font-semibold">
                {connection.name}
              </span>
              <span className="text-foreground-muted rounded-full bg-white/5 px-2 py-0.5 text-[10px]">
                {connection.kind === "registry" ? "Registry" : "Custom"}
              </span>
              {!connection.isEnabled ? (
                <span className="text-foreground-muted rounded-full bg-white/5 px-2 py-0.5 text-[10px]">
                  已禁用
                </span>
              ) : null}
            </div>
            <div className="text-foreground-muted mt-1 flex flex-wrap items-center gap-2 text-[11px]">
              <span className="font-mono">{connection.sdkPackage}</span>
              {providerName ? <span>来源 {providerName}</span> : null}
              <span>{maskApiKey(connection.apiKey)}</span>
            </div>
          </div>
          <span
            className={`text-foreground-muted text-xl ${expanded ? "icon-[material-symbols--keyboard-arrow-up]" : "icon-[material-symbols--keyboard-arrow-down]"}`}
          />
        </button>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onEdit(connection)}
            className="text-foreground-muted hover:bg-button-hover-background hover:text-foreground rounded p-1 transition"
            title="编辑连接"
          >
            <span className="icon-[material-symbols--edit] text-sm" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(connection)}
            className="text-foreground-muted hover:bg-button-hover-background hover:text-foreground rounded p-1 transition"
            title="删除连接"
          >
            <span className="icon-[material-symbols--delete-outline] text-sm" />
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="border-border border-t px-4 py-3">
          {connection.baseUrl ? (
            <div className="text-foreground-muted mb-2 text-[11px]">
              Endpoint {connection.baseUrl}
            </div>
          ) : null}
          <div className="mb-3">
            <button
              type="button"
              onClick={() => onOpenAddCustomModel(connection)}
              className="border-border text-foreground hover:bg-list-hover-background inline-flex items-center gap-1 rounded-md border px-2 py-1 transition"
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
  const { data: models, isLoading } = rpc.useQuery("ai.listResolvedModels", {
    connectionId: connection.id,
    includeDisabled: true,
  });
  const toggleCatalogModel = rpc.useMutation("ai.setCatalogModelEnabled");
  const hasLoadedModels = models !== undefined;
  const isRefreshing = hasLoadedModels && isLoading;

  if (!hasLoadedModels && isLoading) {
    return <LoadingInline label="加载模型中..." />;
  }

  if ((models ?? []).length === 0) {
    return <div className="text-foreground-muted py-4 text-sm">这个连接当前没有可见模型。</div>;
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

function ConnectionDialog({
  open,
  connection,
  quickConnectProviderId,
  catalogProviders,
  supportedPackages,
  isPending,
  onCancel,
  onSave,
}: {
  open: boolean;
  connection?: AiConnectionRow;
  quickConnectProviderId?: string | null;
  catalogProviders: AiCatalogProviderView[];
  supportedPackages: AiSupportedSdkPackage[];
  isPending: boolean;
  onCancel: () => void;
  onSave: (_data: ConnectionFormData) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        if (!isPending) onCancel();
      }}
      className="border-border bg-sidebar-background text-foreground w-[min(34rem,calc(100vw-2rem))] rounded-lg border p-0 shadow-lg backdrop:bg-black/50"
    >
      <ConnectionDialogForm
        key={connection?.id ?? (quickConnectProviderId ? `quick-${quickConnectProviderId}` : "new")}
        connection={connection}
        quickConnectProviderId={quickConnectProviderId}
        catalogProviders={catalogProviders}
        supportedPackages={supportedPackages}
        isPending={isPending}
        onCancel={onCancel}
        onSave={onSave}
      />
    </dialog>
  );
}

function ConnectionDialogForm({
  connection,
  quickConnectProviderId,
  catalogProviders,
  supportedPackages,
  isPending,
  onCancel,
  onSave,
}: {
  connection?: AiConnectionRow;
  quickConnectProviderId?: string | null;
  catalogProviders: AiCatalogProviderView[];
  supportedPackages: AiSupportedSdkPackage[];
  isPending: boolean;
  onCancel: () => void;
  onSave: (_data: ConnectionFormData) => void;
}) {
  const editableProviders = catalogProviders.filter((provider) => provider.isSupported);
  const defaultProvider = editableProviders[0] ?? null;
  const quickConnectProvider = quickConnectProviderId
    ? (editableProviders.find((p) => p.id === quickConnectProviderId) ?? null)
    : null;
  const [kind, setKind] = useState<"registry" | "custom">(
    normalizeConnectionKind(connection?.kind),
  );
  const [name, setName] = useState(connection?.name ?? quickConnectProvider?.name ?? "");
  const [catalogProviderId, setCatalogProviderId] = useState<string>(
    connection?.catalogProviderId ?? quickConnectProvider?.id ?? defaultProvider?.id ?? "",
  );
  const [sdkPackage, setSdkPackage] = useState<string>(
    normalizeConnectionKind(connection?.kind) === "custom"
      ? (connection?.sdkPackage ?? supportedPackages[0]?.sdkPackage ?? "@ai-sdk/openai-compatible")
      : (supportedPackages[0]?.sdkPackage ?? "@ai-sdk/openai-compatible"),
  );
  const [baseUrl, setBaseUrl] = useState(connection?.baseUrl ?? quickConnectProvider?.apiUrl ?? "");
  const [apiKey, setApiKey] = useState(connection?.apiKey ? "••••••••" : "");
  const [apiKeyChanged, setApiKeyChanged] = useState(false);
  const [config, setConfig] = useState<AiConnectionConfig>(() =>
    normalizeFormConnectionConfig(
      connection?.sdkPackage ??
        quickConnectProvider?.sdkPackage ??
        supportedPackages[0]?.sdkPackage,
      connection ? parseAiConnectionConfig(connection.configJson) : {},
    ),
  );
  const [isEnabled, setIsEnabled] = useState(connection?.isEnabled ?? true);
  const [formError, setFormError] = useState<string | null>(null);

  const selectedRegistryProvider =
    editableProviders.find((item) => item.id === catalogProviderId) ?? defaultProvider;
  const effectiveSdkPackage =
    kind === "registry" ? (selectedRegistryProvider?.sdkPackage ?? null) : sdkPackage;
  const recipe = getAiSdkPackageRecipe(effectiveSdkPackage);
  const showBaseUrl = Boolean(recipe?.requiresBaseUrl || recipe?.allowsCustomEndpoint);
  const normalizedConfig = normalizeFormConnectionConfig(effectiveSdkPackage, config);
  const requiresApiKey = !connection || apiKeyChanged || !connection.apiKey;
  const isAzureConfig = recipe?.configKind === "azure";

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) {
      setFormError("连接名称不能为空。");
      return;
    }
    if (kind === "registry" && !selectedRegistryProvider) {
      setFormError("请选择一个可接入的 catalog provider。");
      return;
    }
    if (kind === "custom" && !sdkPackage) {
      setFormError("请选择 AI SDK package。");
      return;
    }
    if (requiresApiKey && !apiKey.trim()) {
      setFormError("API Key 不能为空。");
      return;
    }
    if (recipe?.requiresBaseUrl && !baseUrl.trim()) {
      setFormError("这个 AI SDK package 需要填写 Base URL。");
      return;
    }
    if (isAzureConfig && !baseUrl.trim() && !normalizedConfig.azure?.resourceName) {
      setFormError("Azure 连接需要填写 Base URL 或 Resource Name。");
      return;
    }

    onSave({
      kind,
      name: name.trim(),
      catalogProviderId: kind === "registry" ? (selectedRegistryProvider?.id ?? null) : null,
      sdkPackage: kind === "custom" ? sdkPackage : null,
      baseUrl: showBaseUrl ? baseUrl.trim() || null : null,
      apiKey: apiKeyChanged ? apiKey : null,
      apiKeyChanged,
      config: normalizedConfig,
      isEnabled,
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="border-border flex items-center gap-2 border-b px-4 py-3">
        <span className="icon-[material-symbols--cable] text-accent-foreground text-base" />
        <span className="text-sm font-medium">{connection ? "编辑连接" : "新建连接"}</span>
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="text-foreground-muted hover:bg-button-hover-background hover:text-foreground ml-auto rounded p-1 transition disabled:opacity-40"
        >
          <span className="icon-[material-symbols--close] text-base" />
        </button>
      </div>

      <div className="space-y-4 p-4">
        {!connection ? (
          <div className="flex gap-2">
            {(["registry", "custom"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setKind(value);
                  setFormError(null);
                  if (value === "registry" && !catalogProviderId) {
                    setCatalogProviderId(defaultProvider?.id ?? "");
                  }
                  if (value === "custom" && !sdkPackage) {
                    setSdkPackage(supportedPackages[0]?.sdkPackage ?? "@ai-sdk/openai-compatible");
                  }
                }}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  kind === value
                    ? "bg-accent-background text-foreground"
                    : "bg-editor-background text-foreground-muted hover:text-foreground"
                }`}
              >
                {value === "registry" ? "Registry 连接" : "Custom 连接"}
              </button>
            ))}
          </div>
        ) : null}

        <label className="block space-y-1">
          <span className="text-foreground-muted text-[11px] font-medium">名称</span>
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：OpenRouter 主账号"
            className="border-border bg-editor-background focus:border-accent-foreground w-full rounded-md border px-3 py-2 text-sm outline-none"
          />
        </label>

        {kind === "registry" ? (
          <label className="block space-y-1">
            <span className="text-foreground-muted text-[11px] font-medium">Catalog Provider</span>
            <select
              value={catalogProviderId}
              onChange={(event) => setCatalogProviderId(event.target.value)}
              className="border-border bg-editor-background focus:border-accent-foreground w-full rounded-md border px-3 py-2 text-sm outline-none"
            >
              {editableProviders.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name} · {provider.sdkPackage}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="block space-y-1">
            <span className="text-foreground-muted text-[11px] font-medium">AI SDK Package</span>
            <select
              value={sdkPackage}
              onChange={(event) => setSdkPackage(event.target.value)}
              className="border-border bg-editor-background focus:border-accent-foreground w-full rounded-md border px-3 py-2 text-sm outline-none"
            >
              {supportedPackages.map((item) => (
                <option key={item.sdkPackage} value={item.sdkPackage}>
                  {item.label} · {item.sdkPackage}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="border-border bg-editor-background text-foreground-muted rounded-md border px-3 py-2 text-xs">
          <div className="text-foreground font-mono">{effectiveSdkPackage ?? "未选择 package"}</div>
          {recipe ? (
            <div className="mt-1">
              factory: {recipe.providerFactoryId}
              {recipe.requiresBaseUrl ? " · 需要 Base URL" : ""}
              {recipe.allowsCustomEndpoint ? " · 允许自定义 endpoint" : ""}
              {recipe.configKind === "azure" ? " · Azure 专用配置" : ""}
            </div>
          ) : (
            <div className="mt-1">这个 package 暂无受控 recipe。</div>
          )}
        </div>

        {showBaseUrl ? (
          <label className="block space-y-1">
            <span className="text-foreground-muted text-[11px] font-medium">Base URL</span>
            <input
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://api.example.com/v1"
              className="border-border bg-editor-background focus:border-accent-foreground w-full rounded-md border px-3 py-2 font-mono text-xs outline-none"
            />
          </label>
        ) : null}

        {isAzureConfig ? (
          <>
            <label className="block space-y-1">
              <span className="text-foreground-muted text-[11px] font-medium">Resource Name</span>
              <input
                value={config.azure?.resourceName ?? ""}
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    azure: {
                      ...current.azure,
                      resourceName: event.target.value,
                    },
                  }))
                }
                placeholder="your-azure-resource"
                className="border-border bg-editor-background focus:border-accent-foreground w-full rounded-md border px-3 py-2 text-sm outline-none"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-foreground-muted text-[11px] font-medium">API Version</span>
              <input
                value={config.azure?.apiVersion ?? ""}
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    azure: {
                      ...current.azure,
                      apiVersion: event.target.value,
                    },
                  }))
                }
                placeholder="preview"
                className="border-border bg-editor-background focus:border-accent-foreground w-full rounded-md border px-3 py-2 text-sm outline-none"
              />
            </label>

            <label className="text-foreground-muted flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={config.azure?.useDeploymentBasedUrls ?? false}
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    azure: {
                      ...current.azure,
                      useDeploymentBasedUrls: event.target.checked,
                    },
                  }))
                }
                className="border-border bg-editor-background accent-accent-foreground rounded"
              />
              使用 deployment-based URLs
            </label>
          </>
        ) : null}

        <label className="block space-y-1">
          <span className="text-foreground-muted text-[11px] font-medium">API Key</span>
          <input
            type="password"
            value={apiKey}
            onChange={(event) => {
              setApiKey(event.target.value);
              setApiKeyChanged(true);
            }}
            onFocus={() => {
              if (!apiKeyChanged && connection) {
                setApiKey("");
                setApiKeyChanged(true);
              }
            }}
            placeholder={connection?.apiKey ? "留空则不修改" : "sk-..."}
            className="border-border bg-editor-background focus:border-accent-foreground w-full rounded-md border px-3 py-2 text-sm outline-none"
          />
        </label>

        <label className="text-foreground-muted flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isEnabled}
            onChange={(event) => setIsEnabled(event.target.checked)}
            className="border-border bg-editor-background accent-accent-foreground rounded"
          />
          启用这个连接
        </label>

        {formError ? (
          <div className="border-border bg-editor-background text-accent-foreground rounded-md border px-3 py-2 text-sm">
            {formError}
          </div>
        ) : null}
      </div>

      <div className="border-border flex items-center justify-end gap-2 border-t px-4 py-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="border-border text-foreground hover:bg-list-hover-background rounded-md border px-3 py-1.5 text-sm transition disabled:opacity-40"
        >
          取消
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="bg-accent-background text-foreground rounded-md px-3 py-1.5 text-sm font-medium transition hover:brightness-110 disabled:opacity-50"
        >
          {isPending ? "保存中..." : "保存连接"}
        </button>
      </div>
    </form>
  );
}

function CustomModelDialog({
  open,
  model,
  isPending,
  onCancel,
  onSave,
}: {
  open: boolean;
  model?: AiConnectionCustomModelRow;
  isPending: boolean;
  onCancel: () => void;
  onSave: (_data: CustomModelFormData) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        if (!isPending) onCancel();
      }}
      className="border-border bg-sidebar-background text-foreground w-[min(34rem,calc(100vw-2rem))] rounded-lg border p-0 shadow-lg backdrop:bg-black/50"
    >
      <CustomModelDialogForm
        key={model?.id ?? "new"}
        model={model}
        isPending={isPending}
        onCancel={onCancel}
        onSave={onSave}
      />
    </dialog>
  );
}

function CustomModelDialogForm({
  model,
  isPending,
  onCancel,
  onSave,
}: {
  model?: AiConnectionCustomModelRow;
  isPending: boolean;
  onCancel: () => void;
  onSave: (_data: CustomModelFormData) => void;
}) {
  const [modelId, setModelId] = useState(model?.modelId ?? "");
  const [displayName, setDisplayName] = useState(model?.displayName ?? "");
  const [contextWindow, setContextWindow] = useState(model?.contextWindow?.toString() ?? "");
  const [maxOutputTokens, setMaxOutputTokens] = useState(model?.maxOutputTokens?.toString() ?? "");
  const [supportsVision, setSupportsVision] = useState(model?.supportsVision ?? false);
  const [supportsToolUse, setSupportsToolUse] = useState(model?.supportsToolUse ?? false);
  const [supportsReasoning, setSupportsReasoning] = useState(model?.supportsReasoning ?? false);
  const [supportsTemperature, setSupportsTemperature] = useState(
    model?.supportsTemperature ?? false,
  );
  const [inputPrice, setInputPrice] = useState(model?.inputPricePer1m?.toString() ?? "");
  const [outputPrice, setOutputPrice] = useState(model?.outputPricePer1m?.toString() ?? "");
  const [isEnabled, setIsEnabled] = useState(model?.isEnabled ?? true);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!modelId.trim()) {
      setFormError("模型 ID 不能为空。");
      return;
    }
    if (!displayName.trim()) {
      setFormError("显示名称不能为空。");
      return;
    }

    onSave({
      modelId: modelId.trim(),
      displayName: displayName.trim(),
      contextWindow: contextWindow ? Number(contextWindow) : null,
      maxOutputTokens: maxOutputTokens ? Number(maxOutputTokens) : null,
      supportsVision,
      supportsToolUse,
      supportsReasoning,
      supportsTemperature,
      inputPricePer1m: inputPrice ? Number(inputPrice) : null,
      outputPricePer1m: outputPrice ? Number(outputPrice) : null,
      isEnabled,
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="border-border flex items-center gap-2 border-b px-4 py-3">
        <span className="icon-[material-symbols--token] text-accent-foreground text-base" />
        <span className="text-sm font-medium">{model ? "编辑自定义模型" : "添加自定义模型"}</span>
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="text-foreground-muted hover:bg-button-hover-background hover:text-foreground ml-auto rounded p-1 transition disabled:opacity-40"
        >
          <span className="icon-[material-symbols--close] text-base" />
        </button>
      </div>

      <div className="space-y-4 p-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-foreground-muted text-[11px] font-medium">模型 ID</span>
            <input
              autoFocus
              value={modelId}
              onChange={(event) => setModelId(event.target.value)}
              placeholder="gpt-4o-mini"
              className="border-border bg-editor-background focus:border-accent-foreground w-full rounded-md border px-3 py-2 font-mono text-xs outline-none"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-foreground-muted text-[11px] font-medium">显示名称</span>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="My Fine-Tuned Model"
              className="border-border bg-editor-background focus:border-accent-foreground w-full rounded-md border px-3 py-2 text-sm outline-none"
            />
          </label>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-foreground-muted text-[11px] font-medium">上下文窗口</span>
            <input
              type="number"
              value={contextWindow}
              onChange={(event) => setContextWindow(event.target.value)}
              className="border-border bg-editor-background focus:border-accent-foreground w-full rounded-md border px-3 py-2 font-mono text-xs outline-none"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-foreground-muted text-[11px] font-medium">最大输出</span>
            <input
              type="number"
              value={maxOutputTokens}
              onChange={(event) => setMaxOutputTokens(event.target.value)}
              className="border-border bg-editor-background focus:border-accent-foreground w-full rounded-md border px-3 py-2 font-mono text-xs outline-none"
            />
          </label>
        </div>

        <div className="text-foreground-muted grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={supportsVision}
              onChange={(event) => setSupportsVision(event.target.checked)}
              className="border-border bg-editor-background accent-accent-foreground rounded"
            />
            视觉
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={supportsToolUse}
              onChange={(event) => setSupportsToolUse(event.target.checked)}
              className="border-border bg-editor-background accent-accent-foreground rounded"
            />
            工具
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={supportsReasoning}
              onChange={(event) => setSupportsReasoning(event.target.checked)}
              className="border-border bg-editor-background accent-accent-foreground rounded"
            />
            推理
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={supportsTemperature}
              onChange={(event) => setSupportsTemperature(event.target.checked)}
              className="border-border bg-editor-background accent-accent-foreground rounded"
            />
            温度
          </label>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-foreground-muted text-[11px] font-medium">输入价格 / 1M</span>
            <input
              type="number"
              step="0.001"
              min="0"
              value={inputPrice}
              onChange={(event) => setInputPrice(event.target.value)}
              className="border-border bg-editor-background focus:border-accent-foreground w-full rounded-md border px-3 py-2 font-mono text-xs outline-none"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-foreground-muted text-[11px] font-medium">输出价格 / 1M</span>
            <input
              type="number"
              step="0.001"
              min="0"
              value={outputPrice}
              onChange={(event) => setOutputPrice(event.target.value)}
              className="border-border bg-editor-background focus:border-accent-foreground w-full rounded-md border px-3 py-2 font-mono text-xs outline-none"
            />
          </label>
        </div>

        <label className="text-foreground-muted flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isEnabled}
            onChange={(event) => setIsEnabled(event.target.checked)}
            className="border-border bg-editor-background accent-accent-foreground rounded"
          />
          启用这个自定义模型
        </label>

        {formError ? (
          <div className="border-border bg-editor-background text-accent-foreground rounded-md border px-3 py-2 text-sm">
            {formError}
          </div>
        ) : null}
      </div>

      <div className="border-border flex items-center justify-end gap-2 border-t px-4 py-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="border-border text-foreground hover:bg-list-hover-background rounded-md border px-3 py-1.5 text-sm transition disabled:opacity-40"
        >
          取消
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="bg-accent-background text-foreground rounded-md px-3 py-1.5 text-sm font-medium transition hover:brightness-110 disabled:opacity-50"
        >
          {isPending ? "保存中..." : "保存模型"}
        </button>
      </div>
    </form>
  );
}

function SettingsSidebar() {
  return (
    <AppSidebar>
      <div className="text-foreground-muted flex h-7 shrink-0 items-center px-3 text-[11px] font-semibold tracking-wider uppercase">
        设置
      </div>
      <SidebarListRow
        isActive
        icon={
          <span className="icon-[material-symbols--smart-toy] text-foreground-muted text-base" />
        }
        label="AI"
      />
    </AppSidebar>
  );
}

export function AiSettingsPage() {
  const { data: status } = rpc.useQuery("ai.getCatalogStatus");
  const { data: catalogProviders, isLoading: providersLoading } = rpc.useQuery(
    "ai.listCatalogProviders",
    { activeOnly: false, supportedOnly: false },
  );
  const { data: supportedPackages } = rpc.useQuery("ai.listSupportedSdkPackages");
  const { data: connections, isLoading: connectionsLoading } = rpc.useQuery("ai.listConnections");

  const refreshCatalog = rpc.useMutation("ai.refreshCatalog");
  const createConnection = rpc.useMutation("ai.createConnection");
  const updateConnection = rpc.useMutation("ai.updateConnection");
  const deleteConnection = rpc.useMutation("ai.deleteConnection");
  const createCustomModel = rpc.useMutation("ai.createCustomModel");
  const updateCustomModel = rpc.useMutation("ai.updateCustomModel");
  const deleteCustomModel = rpc.useMutation("ai.deleteCustomModel");

  const [connectionDialogOpen, setConnectionDialogOpen] = useState(false);
  const [editingConnection, setEditingConnection] = useState<AiConnectionRow | undefined>();
  const [customModelDialogOpen, setCustomModelDialogOpen] = useState(false);
  const [editingCustomModel, setEditingCustomModel] = useState<
    AiConnectionCustomModelRow | undefined
  >();
  const [customModelConnection, setCustomModelConnection] = useState<AiConnectionRow | undefined>();
  const [quickConnectProviderId, setQuickConnectProviderId] = useState<string | null>(null);
  const [providerFilter, setProviderFilter] = useState("");

  const allProviders = catalogProviders ?? [];
  const allConnections = connections ?? [];
  const packageList = supportedPackages ?? [];
  const providerMap = new Map(allProviders.map((provider) => [provider.id, provider]));

  const handleQuickConnect = (providerId: string) => {
    setQuickConnectProviderId(providerId);
    setEditingConnection(undefined);
    setConnectionDialogOpen(true);
  };

  const handleSaveConnection = async (data: ConnectionFormData) => {
    if (editingConnection) {
      await updateConnection.mutate({
        id: editingConnection.id,
        name: data.name,
        catalogProviderId:
          data.kind === "registry" ? (data.catalogProviderId ?? undefined) : undefined,
        sdkPackage: data.kind === "custom" ? (data.sdkPackage ?? undefined) : undefined,
        baseUrl: data.baseUrl,
        apiKey: data.apiKeyChanged ? data.apiKey : undefined,
        config: data.config,
        isEnabled: data.isEnabled,
      });
    } else if (data.kind === "registry" && data.catalogProviderId) {
      await createConnection.mutate({
        kind: "registry",
        name: data.name,
        catalogProviderId: data.catalogProviderId,
        baseUrl: data.baseUrl,
        apiKey: data.apiKeyChanged ? data.apiKey : null,
        config: data.config,
        isEnabled: data.isEnabled,
      });
    } else if (data.kind === "custom" && data.sdkPackage) {
      await createConnection.mutate({
        kind: "custom",
        name: data.name,
        sdkPackage: data.sdkPackage,
        baseUrl: data.baseUrl,
        apiKey: data.apiKeyChanged ? data.apiKey : null,
        config: data.config,
        isEnabled: data.isEnabled,
      });
    }

    setEditingConnection(undefined);
    setConnectionDialogOpen(false);
  };

  const handleSaveCustomModel = async (data: CustomModelFormData) => {
    if (!customModelConnection) return;
    if (editingCustomModel) {
      await updateCustomModel.mutate({
        id: editingCustomModel.id,
        ...data,
      });
    } else {
      await createCustomModel.mutate({
        connectionId: customModelConnection.id,
        ...data,
      });
    }
    setEditingCustomModel(undefined);
    setCustomModelConnection(undefined);
    setCustomModelDialogOpen(false);
  };

  return (
    <AppShell active="settings" sidebar={<SettingsSidebar />}>
      <div className="flex h-full flex-col overflow-hidden">
        <div className="border-border bg-title-bar-background flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 py-2">
          <div className="min-w-0">
            <h1 className="text-foreground text-[14px] font-semibold">AI 设置</h1>
            <p className="text-foreground-muted text-[11px]">
              {status?.activeProviderCount ?? 0} 个活跃 provider · {status?.activeModelCount ?? 0}{" "}
              个活跃模型 · {allConnections.length} 个连接
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setEditingConnection(undefined);
                setConnectionDialogOpen(true);
              }}
              className="border-border bg-sidebar-background text-foreground hover:bg-list-hover-background inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition"
            >
              <span className="icon-[material-symbols--add] text-base" />
              新建连接
            </button>
            <button
              type="button"
              onClick={() => void refreshCatalog.mutate({ force: true })}
              disabled={refreshCatalog.isPending}
              className="bg-accent-background text-foreground inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition hover:brightness-110 disabled:opacity-50"
            >
              <span
                className={`text-base ${refreshCatalog.isPending ? "icon-[material-symbols--sync] animate-spin" : "icon-[material-symbols--cloud-sync]"}`}
              />
              刷新 Catalog
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
          <section className="border-border bg-sidebar-background text-foreground-muted mb-4 grid shrink-0 gap-3 rounded-md border p-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <div className="text-foreground-muted/70 text-[11px] tracking-wide uppercase">
                Last Success
              </div>
              <div className="text-foreground mt-1">
                {status?.lastSuccessAt
                  ? new Date(status.lastSuccessAt).toLocaleString()
                  : "从未同步"}
              </div>
            </div>
            <div>
              <div className="text-foreground-muted/70 text-[11px] tracking-wide uppercase">
                Last Attempt
              </div>
              <div className="text-foreground mt-1">
                {status?.lastAttemptAt ? new Date(status.lastAttemptAt).toLocaleString() : "—"}
              </div>
            </div>
            <div>
              <div className="text-foreground-muted/70 text-[11px] tracking-wide uppercase">
                State
              </div>
              <div className="text-foreground mt-1">
                {status?.isStale ? "快照已过期" : "快照新鲜"}
              </div>
            </div>
            <div>
              <div className="text-foreground-muted/70 text-[11px] tracking-wide uppercase">
                Last Error
              </div>
              <div className="text-foreground mt-1 wrap-break-word">{status?.lastError ?? "—"}</div>
            </div>
          </section>

          <section className="grid min-h-0 flex-1 gap-4 overflow-y-auto xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] xl:overflow-hidden">
            <div className="flex min-h-0 flex-col gap-3 xl:overflow-hidden">
              <div className="shrink-0">
                <h2 className="text-foreground text-sm font-semibold">Connections</h2>
                <p className="text-foreground-muted text-xs">
                  这里保存真正会被未来 AI SDK 使用的连接实例。
                </p>
              </div>

              <OverlayScrollbar variant="card">
                {connectionsLoading ? (
                  <LoadingBlock label="连接加载中..." />
                ) : allConnections.length === 0 ? (
                  <div className="border-border text-foreground-muted rounded-md border border-dashed px-4 py-10 text-sm">
                    还没有任何连接。先创建一个 registry 或 custom connection。
                  </div>
                ) : (
                  <div className="space-y-2">
                    {allConnections.map((connection) => (
                      <ConnectionCard
                        key={connection.id}
                        connection={connection}
                        providerName={
                          connection.catalogProviderId
                            ? (providerMap.get(connection.catalogProviderId)?.name ?? null)
                            : null
                        }
                        onEdit={(connection) => {
                          setEditingConnection(connection);
                          setConnectionDialogOpen(true);
                        }}
                        onDelete={(connection) =>
                          void deleteConnection.mutate({ id: connection.id })
                        }
                        onOpenAddCustomModel={(connection) => {
                          setCustomModelConnection(connection);
                          setEditingCustomModel(undefined);
                          setCustomModelDialogOpen(true);
                        }}
                        onOpenEditCustomModel={(connection, model) => {
                          if (!model.customModelId) return;
                          setCustomModelConnection(connection);
                          setEditingCustomModel({
                            id: model.customModelId,
                            connectionId: connection.id,
                            modelId: model.modelId,
                            displayName: model.displayName,
                            contextWindow: model.contextWindow,
                            maxOutputTokens: model.maxOutputTokens,
                            supportsVision: model.supportsVision,
                            supportsToolUse: model.supportsToolUse,
                            supportsReasoning: model.supportsReasoning,
                            supportsTemperature: model.supportsTemperature,
                            inputPricePer1m: model.inputPricePer1m,
                            outputPricePer1m: model.outputPricePer1m,
                            isEnabled: model.isEnabled,
                            createdAt: 0,
                            updatedAt: 0,
                          });
                          setCustomModelDialogOpen(true);
                        }}
                        onDeleteCustomModel={(connection, model) => {
                          if (!model.customModelId) return;
                          void deleteCustomModel.mutate({ id: model.customModelId });
                        }}
                      />
                    ))}
                  </div>
                )}
              </OverlayScrollbar>
            </div>

            <div className="flex min-h-0 flex-col gap-3 xl:overflow-hidden">
              <div className="shrink-0">
                <h2 className="text-foreground text-sm font-semibold">Catalog</h2>
                <p className="text-foreground-muted text-xs">
                  来自 models.dev 的目录快照。支持接入的 provider 可以直接创建 registry 连接。
                </p>
                <input
                  type="text"
                  value={providerFilter}
                  onChange={(e) => setProviderFilter(e.target.value)}
                  placeholder="筛选 Provider..."
                  className="border-border bg-editor-background placeholder:text-foreground-muted/50 focus:border-accent-foreground mt-2 w-full rounded-md border px-3 py-1.5 text-sm outline-none"
                />
              </div>

              <OverlayScrollbar variant="card">
                {providersLoading ? (
                  <LoadingBlock label="Catalog 加载中..." />
                ) : (
                  <div className="space-y-2">
                    {allProviders
                      .filter((p) =>
                        providerFilter
                          ? p.name.toLowerCase().includes(providerFilter.toLowerCase())
                          : true,
                      )
                      .map((provider) => (
                        <CatalogProviderCard
                          key={provider.id}
                          provider={provider}
                          onQuickConnect={handleQuickConnect}
                        />
                      ))}
                  </div>
                )}
              </OverlayScrollbar>
            </div>
          </section>
        </div>
      </div>

      <ConnectionDialog
        open={connectionDialogOpen}
        connection={editingConnection}
        quickConnectProviderId={quickConnectProviderId}
        catalogProviders={allProviders}
        supportedPackages={packageList}
        isPending={createConnection.isPending || updateConnection.isPending}
        onCancel={() => {
          setEditingConnection(undefined);
          setQuickConnectProviderId(null);
          setConnectionDialogOpen(false);
        }}
        onSave={handleSaveConnection}
      />

      <CustomModelDialog
        open={customModelDialogOpen}
        model={editingCustomModel}
        isPending={createCustomModel.isPending || updateCustomModel.isPending}
        onCancel={() => {
          setEditingCustomModel(undefined);
          setCustomModelConnection(undefined);
          setCustomModelDialogOpen(false);
        }}
        onSave={handleSaveCustomModel}
      />
    </AppShell>
  );
}

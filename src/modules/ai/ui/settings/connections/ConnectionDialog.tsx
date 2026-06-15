import { type FormEvent, useEffect, useRef, useState } from "react";

import { type AiConnectionConfig, parseAiConnectionConfig } from "@/modules/ai/domain/config";
import { type AiSupportedSdkPackage, getAiSdkPackageRecipe } from "@/modules/ai/domain/packages";
import type { AiCatalogProviderView, AiConnectionRow } from "@/modules/ai/domain/types";

import {
  type ConnectionFormData,
  normalizeConnectionKind,
  normalizeFormConnectionConfig,
} from "./forms";

export function ConnectionDialog({
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
      className="w-[min(34rem,calc(100vw-2rem))] rounded-lg border border-border bg-sidebar-background p-0 text-foreground shadow-lg backdrop:bg-black/50"
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
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="icon-[material-symbols--cable] text-base text-accent-foreground" />
        <span className="text-sm font-medium">{connection ? "编辑连接" : "新建连接"}</span>
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="ml-auto rounded p-1 text-foreground-muted transition hover:bg-button-hover-background hover:text-foreground disabled:opacity-40"
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
          <span className="text-[11px] font-medium text-foreground-muted">名称</span>
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：OpenRouter 主账号"
            className="w-full rounded-md border border-border bg-editor-background px-3 py-2 text-sm outline-none focus:border-accent-foreground"
          />
        </label>

        {kind === "registry" ? (
          <label className="block space-y-1">
            <span className="text-[11px] font-medium text-foreground-muted">Catalog Provider</span>
            <select
              value={catalogProviderId}
              onChange={(event) => setCatalogProviderId(event.target.value)}
              className="w-full rounded-md border border-border bg-editor-background px-3 py-2 text-sm outline-none focus:border-accent-foreground"
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
            <span className="text-[11px] font-medium text-foreground-muted">AI SDK Package</span>
            <select
              value={sdkPackage}
              onChange={(event) => setSdkPackage(event.target.value)}
              className="w-full rounded-md border border-border bg-editor-background px-3 py-2 text-sm outline-none focus:border-accent-foreground"
            >
              {supportedPackages.map((item) => (
                <option key={item.sdkPackage} value={item.sdkPackage}>
                  {item.label} · {item.sdkPackage}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="rounded-md border border-border bg-editor-background px-3 py-2 text-xs text-foreground-muted">
          <div className="font-mono text-foreground">{effectiveSdkPackage ?? "未选择 package"}</div>
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
            <span className="text-[11px] font-medium text-foreground-muted">Base URL</span>
            <input
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://api.example.com/v1"
              className="w-full rounded-md border border-border bg-editor-background px-3 py-2 font-mono text-xs outline-none focus:border-accent-foreground"
            />
          </label>
        ) : null}

        {isAzureConfig ? (
          <>
            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-foreground-muted">Resource Name</span>
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
                className="w-full rounded-md border border-border bg-editor-background px-3 py-2 text-sm outline-none focus:border-accent-foreground"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-foreground-muted">API Version</span>
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
                className="w-full rounded-md border border-border bg-editor-background px-3 py-2 text-sm outline-none focus:border-accent-foreground"
              />
            </label>

            <label className="flex items-center gap-2 text-sm text-foreground-muted">
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
                className="rounded border-border bg-editor-background accent-accent-foreground"
              />
              使用 deployment-based URLs
            </label>
          </>
        ) : null}

        <label className="block space-y-1">
          <span className="text-[11px] font-medium text-foreground-muted">API Key</span>
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
            className="w-full rounded-md border border-border bg-editor-background px-3 py-2 text-sm outline-none focus:border-accent-foreground"
          />
        </label>

        <label className="flex items-center gap-2 text-sm text-foreground-muted">
          <input
            type="checkbox"
            checked={isEnabled}
            onChange={(event) => setIsEnabled(event.target.checked)}
            className="rounded border-border bg-editor-background accent-accent-foreground"
          />
          启用这个连接
        </label>

        {formError ? (
          <div className="rounded-md border border-border bg-editor-background px-3 py-2 text-sm text-accent-foreground">
            {formError}
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground transition hover:bg-list-hover-background disabled:opacity-40"
        >
          取消
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-accent-background px-3 py-1.5 text-sm font-medium text-foreground transition hover:brightness-110 disabled:opacity-50"
        >
          {isPending ? "保存中..." : "保存连接"}
        </button>
      </div>
    </form>
  );
}

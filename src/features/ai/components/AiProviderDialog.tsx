import { type FormEvent, useEffect, useRef, useState } from "react";

import type { AiProviderRow } from "@/domain/types";

const PROVIDER_DEFAULTS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta",
  ollama: "http://localhost:11434/v1",
  custom: "",
};

const PROVIDER_TYPES = ["openai", "anthropic", "google", "ollama", "custom"] as const;

export interface AiProviderFormData {
  name: string;
  providerType: string;
  baseUrl: string | null;
  apiKey: string | null;
  isEnabled: boolean;
}

function AiProviderForm({
  provider,
  onSave,
  onCancel,
  isPending,
}: {
  provider?: AiProviderRow;
  onSave: (_data: AiProviderFormData) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [name, setName] = useState(provider?.name ?? "");
  const [providerType, setProviderType] = useState(provider?.providerType ?? "openai");
  const [baseUrl, setBaseUrl] = useState(
    provider?.baseUrl ?? PROVIDER_DEFAULTS[provider?.providerType ?? "openai"],
  );
  const [apiKey, setApiKey] = useState(provider ? "••••••••" : "");
  const [apiKeyChanged, setApiKeyChanged] = useState(false);
  const [isEnabled, setIsEnabled] = useState(provider?.isEnabled ?? true);
  const [formError, setFormError] = useState<string | null>(null);

  const handleTypeChange = (type: string) => {
    const prevDefaults = PROVIDER_DEFAULTS[providerType];
    setProviderType(type);
    if (
      !provider ||
      (baseUrl === prevDefaults &&
        PROVIDER_DEFAULTS[type] !== "" &&
        PROVIDER_DEFAULTS[type] !== undefined)
    ) {
      setBaseUrl(PROVIDER_DEFAULTS[type]);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setFormError("提供方名称不能为空。");
      return;
    }
    onSave({
      name: trimmedName,
      providerType,
      baseUrl: baseUrl?.trim() || null,
      apiKey: apiKeyChanged ? apiKey : null,
      isEnabled,
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <span className="icon-[material-symbols--dns] text-base text-accent-foreground" />
        <span className="text-sm font-medium">{provider ? "编辑提供方" : "添加提供方"}</span>
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="ml-auto rounded p-0.5 text-foreground-muted transition hover:bg-button-hover-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span className="icon-[material-symbols--close] text-base leading-none" />
        </button>
      </div>

      <div className="space-y-3 p-4">
        <label className="block space-y-1">
          <span className="text-[11px] font-medium text-foreground-muted">名称</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：我的 OpenAI"
            className="w-full rounded-md border border-border bg-editor-background px-3 py-1.5 text-sm text-foreground outline-none placeholder:text-foreground-muted/50 focus:border-accent-foreground"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-[11px] font-medium text-foreground-muted">类型</span>
          <select
            value={providerType}
            onChange={(e) => handleTypeChange(e.target.value)}
            className="w-full rounded-md border border-border bg-editor-background px-3 py-1.5 text-sm text-foreground outline-none focus:border-accent-foreground"
          >
            {PROVIDER_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-1">
          <span className="text-[11px] font-medium text-foreground-muted">API URL</span>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.openai.com/v1"
            className="w-full rounded-md border border-border bg-editor-background px-3 py-1.5 text-xs font-mono text-foreground outline-none placeholder:text-foreground-muted/50 focus:border-accent-foreground"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-[11px] font-medium text-foreground-muted">API Key</span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              setApiKeyChanged(true);
            }}
            onFocus={() => {
              if (!apiKeyChanged && provider) {
                setApiKey("");
                setApiKeyChanged(true);
              }
            }}
            placeholder={provider ? "留空则不修改" : "sk-..."}
            className="w-full rounded-md border border-border bg-editor-background px-3 py-1.5 text-sm text-foreground outline-none placeholder:text-foreground-muted/50 focus:border-accent-foreground"
          />
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={isEnabled}
            onChange={(e) => setIsEnabled(e.target.checked)}
            className="rounded border-border bg-editor-background accent-accent-foreground"
          />
          <span className="text-[11px] font-medium text-foreground-muted">启用</span>
        </label>

        {formError ? (
          <div className="flex items-center gap-2 rounded-md border border-border bg-editor-background px-3 py-2 text-sm text-accent-foreground">
            <span className="icon-[material-symbols--warning] text-base shrink-0" />
            {formError}
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-list-hover-background disabled:cursor-not-allowed disabled:opacity-40"
        >
          取消
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-accent-foreground px-3 py-1.5 text-sm font-medium text-foreground transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="icon-[material-symbols--sync] text-base animate-spin" />
              保存中
            </span>
          ) : (
            "保存"
          )}
        </button>
      </div>
    </form>
  );
}

export function AiProviderDialog({
  open,
  provider,
  isPending,
  onSave,
  onCancel,
}: {
  open: boolean;
  provider?: AiProviderRow;
  isPending: boolean;
  onSave: (_data: AiProviderFormData) => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        if (!isPending) onCancel();
      }}
      className="w-[min(26rem,calc(100vw-2rem))] rounded-lg border border-border bg-sidebar-background p-0 text-foreground shadow-lg backdrop:bg-black/50"
    >
      <AiProviderForm
        key={provider?.id ?? "new"}
        provider={provider}
        onSave={onSave}
        onCancel={onCancel}
        isPending={isPending}
      />
    </dialog>
  );
}

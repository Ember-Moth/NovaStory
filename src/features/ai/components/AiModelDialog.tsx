import { type FormEvent, useEffect, useRef, useState } from "react";

import type { AiModelRow } from "@/domain/types";

export interface AiModelFormData {
  modelId: string;
  displayName: string;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  supportsVision: boolean;
  supportsToolUse: boolean;
  inputPricePer1m: number | null;
  outputPricePer1m: number | null;
}

function AiModelForm({
  model,
  onSave,
  onCancel,
  isPending,
}: {
  model?: AiModelRow;
  onSave: (_data: AiModelFormData) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [modelId, setModelId] = useState(model?.modelId ?? "");
  const [displayName, setDisplayName] = useState(model?.displayName ?? "");
  const [contextWindow, setContextWindow] = useState(model?.contextWindow?.toString() ?? "");
  const [maxOutputTokens, setMaxOutputTokens] = useState(model?.maxOutputTokens?.toString() ?? "");
  const [supportsVision, setSupportsVision] = useState(model?.supportsVision ?? false);
  const [supportsToolUse, setSupportsToolUse] = useState(model?.supportsToolUse ?? false);
  const [inputPrice, setInputPrice] = useState(model?.inputPricePer1m?.toString() ?? "");
  const [outputPrice, setOutputPrice] = useState(model?.outputPricePer1m?.toString() ?? "");
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedModelId = modelId.trim();
    const trimmedDisplayName = displayName.trim();
    if (!trimmedModelId) {
      setFormError("模型 ID 不能为空。");
      return;
    }
    if (!trimmedDisplayName) {
      setFormError("显示名称不能为空。");
      return;
    }
    onSave({
      modelId: trimmedModelId,
      displayName: trimmedDisplayName,
      contextWindow: contextWindow ? Number(contextWindow) : null,
      maxOutputTokens: maxOutputTokens ? Number(maxOutputTokens) : null,
      supportsVision,
      supportsToolUse,
      inputPricePer1m: inputPrice ? Number(inputPrice) : null,
      outputPricePer1m: outputPrice ? Number(outputPrice) : null,
    });
  };

  return (
    <form onSubmit={handleSubmit}>
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <span className="icon-[material-symbols--smart-toy] text-base text-accent-foreground" />
        <span className="text-sm font-medium">{model ? "编辑模型" : "添加模型"}</span>
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
          <span className="text-[11px] font-medium text-foreground-muted">模型 ID</span>
          <input
            autoFocus
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            placeholder="gpt-4o"
            className="w-full rounded-md border border-border bg-editor-background px-3 py-1.5 text-xs font-mono text-foreground outline-none placeholder:text-foreground-muted/50 focus:border-accent-foreground"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-[11px] font-medium text-foreground-muted">显示名称</span>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="GPT-4o"
            className="w-full rounded-md border border-border bg-editor-background px-3 py-1.5 text-sm text-foreground outline-none placeholder:text-foreground-muted/50 focus:border-accent-foreground"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-[11px] font-medium text-foreground-muted">上下文窗口</span>
            <input
              type="number"
              value={contextWindow}
              onChange={(e) => setContextWindow(e.target.value)}
              placeholder="128000"
              className="w-full rounded-md border border-border bg-editor-background px-3 py-1.5 text-xs font-mono text-foreground outline-none placeholder:text-foreground-muted/50 focus:border-accent-foreground"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-[11px] font-medium text-foreground-muted">最大输出 tokens</span>
            <input
              type="number"
              value={maxOutputTokens}
              onChange={(e) => setMaxOutputTokens(e.target.value)}
              placeholder="16384"
              className="w-full rounded-md border border-border bg-editor-background px-3 py-1.5 text-xs font-mono text-foreground outline-none placeholder:text-foreground-muted/50 focus:border-accent-foreground"
            />
          </label>
        </div>

        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={supportsVision}
              onChange={(e) => setSupportsVision(e.target.checked)}
              className="rounded border-border bg-editor-background accent-accent-foreground"
            />
            <span className="text-[11px] font-medium text-foreground-muted">支持视觉</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={supportsToolUse}
              onChange={(e) => setSupportsToolUse(e.target.checked)}
              className="rounded border-border bg-editor-background accent-accent-foreground"
            />
            <span className="text-[11px] font-medium text-foreground-muted">支持工具调用</span>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-[11px] font-medium text-foreground-muted">
              输入价格
              <span className="text-foreground-muted/60"> /1M tokens</span>
            </span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={inputPrice}
              onChange={(e) => setInputPrice(e.target.value)}
              placeholder="5.00"
              className="w-full rounded-md border border-border bg-editor-background px-3 py-1.5 text-xs font-mono text-foreground outline-none placeholder:text-foreground-muted/50 focus:border-accent-foreground"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-[11px] font-medium text-foreground-muted">
              输出价格
              <span className="text-foreground-muted/60"> /1M tokens</span>
            </span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={outputPrice}
              onChange={(e) => setOutputPrice(e.target.value)}
              placeholder="15.00"
              className="w-full rounded-md border border-border bg-editor-background px-3 py-1.5 text-xs font-mono text-foreground outline-none placeholder:text-foreground-muted/50 focus:border-accent-foreground"
            />
          </label>
        </div>

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

export function AiModelDialog({
  open,
  model,
  isPending,
  onSave,
  onCancel,
}: {
  open: boolean;
  model?: AiModelRow;
  isPending: boolean;
  onSave: (_data: AiModelFormData) => void;
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
      <AiModelForm
        key={model?.id ?? "new"}
        model={model}
        onSave={onSave}
        onCancel={onCancel}
        isPending={isPending}
      />
    </dialog>
  );
}

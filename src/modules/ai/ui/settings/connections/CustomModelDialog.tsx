import { type FormEvent, useEffect, useRef, useState } from "react";

import type { AiConnectionCustomModelRow } from "@/modules/ai/domain/types";

import type { CustomModelFormData } from "./forms";

export function CustomModelDialog({
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
      className="w-[min(34rem,calc(100vw-2rem))] rounded-lg border border-border bg-sidebar-background p-0 text-foreground shadow-lg backdrop:bg-black/50"
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
      <div className="flex items-center gap-2 border-border border-b px-4 py-3">
        <span className="icon-[material-symbols--token] text-accent-foreground text-base" />
        <span className="font-medium text-sm">{model ? "编辑自定义模型" : "添加自定义模型"}</span>
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="font-medium text-[11px] text-foreground-muted">模型 ID</span>
            <input
              value={modelId}
              onChange={(event) => setModelId(event.target.value)}
              placeholder="gpt-4o-mini"
              className="w-full rounded-md border border-border bg-editor-background px-3 py-2 font-mono text-xs outline-none focus:border-accent-foreground"
            />
          </label>
          <label className="block space-y-1">
            <span className="font-medium text-[11px] text-foreground-muted">显示名称</span>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="My Fine-Tuned Model"
              className="w-full rounded-md border border-border bg-editor-background px-3 py-2 text-sm outline-none focus:border-accent-foreground"
            />
          </label>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="font-medium text-[11px] text-foreground-muted">上下文窗口</span>
            <input
              type="number"
              value={contextWindow}
              onChange={(event) => setContextWindow(event.target.value)}
              className="w-full rounded-md border border-border bg-editor-background px-3 py-2 font-mono text-xs outline-none focus:border-accent-foreground"
            />
          </label>
          <label className="block space-y-1">
            <span className="font-medium text-[11px] text-foreground-muted">最大输出</span>
            <input
              type="number"
              value={maxOutputTokens}
              onChange={(event) => setMaxOutputTokens(event.target.value)}
              className="w-full rounded-md border border-border bg-editor-background px-3 py-2 font-mono text-xs outline-none focus:border-accent-foreground"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3 text-foreground-muted text-sm sm:grid-cols-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={supportsVision}
              onChange={(event) => setSupportsVision(event.target.checked)}
              className="rounded border-border bg-editor-background accent-accent-foreground"
            />
            视觉
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={supportsToolUse}
              onChange={(event) => setSupportsToolUse(event.target.checked)}
              className="rounded border-border bg-editor-background accent-accent-foreground"
            />
            工具
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={supportsReasoning}
              onChange={(event) => setSupportsReasoning(event.target.checked)}
              className="rounded border-border bg-editor-background accent-accent-foreground"
            />
            推理
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={supportsTemperature}
              onChange={(event) => setSupportsTemperature(event.target.checked)}
              className="rounded border-border bg-editor-background accent-accent-foreground"
            />
            温度
          </label>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="font-medium text-[11px] text-foreground-muted">输入价格 / 1M</span>
            <input
              type="number"
              step="0.001"
              min="0"
              value={inputPrice}
              onChange={(event) => setInputPrice(event.target.value)}
              className="w-full rounded-md border border-border bg-editor-background px-3 py-2 font-mono text-xs outline-none focus:border-accent-foreground"
            />
          </label>
          <label className="block space-y-1">
            <span className="font-medium text-[11px] text-foreground-muted">输出价格 / 1M</span>
            <input
              type="number"
              step="0.001"
              min="0"
              value={outputPrice}
              onChange={(event) => setOutputPrice(event.target.value)}
              className="w-full rounded-md border border-border bg-editor-background px-3 py-2 font-mono text-xs outline-none focus:border-accent-foreground"
            />
          </label>
        </div>

        <label className="flex items-center gap-2 text-foreground-muted text-sm">
          <input
            type="checkbox"
            checked={isEnabled}
            onChange={(event) => setIsEnabled(event.target.checked)}
            className="rounded border-border bg-editor-background accent-accent-foreground"
          />
          启用这个自定义模型
        </label>

        {formError ? (
          <div className="rounded-md border border-border bg-editor-background px-3 py-2 text-accent-foreground text-sm">
            {formError}
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-end gap-2 border-border border-t px-4 py-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="rounded-md border border-border px-3 py-1.5 text-foreground text-sm transition hover:bg-list-hover-background disabled:opacity-40"
        >
          取消
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-accent-background px-3 py-1.5 font-medium text-foreground text-sm transition hover:brightness-110 disabled:opacity-50"
        >
          {isPending ? "保存中..." : "保存模型"}
        </button>
      </div>
    </form>
  );
}

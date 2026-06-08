import type { AiModelRow as AiModelRowType } from "@/domain/types";

function fmtContextWindow(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return `${n}`;
}

function fmtPrice(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1) return `$${n.toFixed(0)}`;
  return `$${n.toFixed(2)}`;
}

export function AiModelRow({
  model,
  onEdit,
  onDelete,
  onSetDefault,
  _onToggleEnabled,
}: {
  model: AiModelRowType;
  onEdit: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
  _onToggleEnabled: (_enabled: boolean) => void;
}) {
  const priceDisplay =
    model.inputPricePer1m != null || model.outputPricePer1m != null
      ? `${fmtPrice(model.inputPricePer1m)}/${fmtPrice(model.outputPricePer1m)}`
      : "—";

  return (
    <tr className="group h-7 border-b border-border/50 hover:bg-list-hover-background">
      <td className="px-3">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-mono text-foreground">{model.modelId}</span>
          {model.isDefault ? (
            <span className="icon-[material-symbols--star] text-xs text-accent-foreground shrink-0" />
          ) : null}
        </div>
      </td>
      <td className="w-16 px-2 text-right text-[11px] tabular-nums text-foreground-muted">
        {fmtContextWindow(model.contextWindow)}
      </td>
      <td className="w-8 px-2 text-center text-xs">
        {model.supportsVision ? (
          <span className="icon-[material-symbols--check] text-xs text-foreground-muted" />
        ) : (
          <span className="text-foreground-muted/30">—</span>
        )}
      </td>
      <td className="w-8 px-2 text-center text-xs">
        {model.supportsToolUse ? (
          <span className="icon-[material-symbols--check] text-xs text-foreground-muted" />
        ) : (
          <span className="text-foreground-muted/30">—</span>
        )}
      </td>
      <td className="w-18 px-2 text-right text-[11px] tabular-nums text-foreground-muted">
        {priceDisplay}
      </td>
      <td className="w-15 px-2">
        <div className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSetDefault();
            }}
            className="rounded p-0.5 text-foreground-muted hover:text-accent-foreground hover:bg-button-hover-background"
            title={model.isDefault ? "当前默认" : "设为默认"}
          >
            <span
              className={`text-sm leading-none ${model.isDefault ? "icon-[material-symbols--star]" : "icon-[material-symbols--star-outline]"}`}
            />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className="rounded p-0.5 text-foreground-muted hover:text-foreground hover:bg-button-hover-background"
            title="编辑"
          >
            <span className="icon-[material-symbols--edit] text-sm leading-none" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="rounded p-0.5 text-foreground-muted hover:text-foreground hover:bg-button-hover-background"
            title="删除"
          >
            <span className="icon-[material-symbols--delete-outline] text-sm leading-none" />
          </button>
        </div>
      </td>
    </tr>
  );
}

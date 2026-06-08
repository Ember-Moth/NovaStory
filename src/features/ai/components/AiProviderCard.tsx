import { type AiModelRow, type AiProviderRow } from "@/domain/types";

import { AiModelRow as AiModelRowComponent } from "./AiModelRow";

const PROVIDER_ICONS: Record<string, string> = {
  openai: "icon-[material-symbols--psychology]",
  anthropic: "icon-[material-symbols--smart-toy]",
  google: "icon-[material-symbols--auto-awesome]",
  deepseek: "icon-[material-symbols--network-node]",
  xai: "icon-[material-symbols--rocket-launch]",
  ollama: "icon-[material-symbols--dns]",
  custom: "icon-[material-symbols--api]",
};

function maskApiKey(key: string | null): string {
  if (!key) return "未设置";
  if (key.length <= 8) return "••••••••";
  return `${key.slice(0, 3)}...${key.slice(-4)}`;
}

export function AiProviderCard({
  provider,
  models,
  expanded,
  onToggle,
  onEditProvider,
  onDeleteProvider,
  onAddModel,
  onEditModel,
  onDeleteModel,
  onSetDefaultModel,
}: {
  provider: AiProviderRow;
  models: AiModelRow[];
  expanded: boolean;
  onToggle: () => void;
  onEditProvider: () => void;
  onDeleteProvider: () => void;
  onAddModel: () => void;
  onEditModel: (_model: AiModelRow) => void;
  onDeleteModel: (_model: AiModelRow) => void;
  onSetDefaultModel: (_modelId: string) => void;
}) {
  const iconClass = PROVIDER_ICONS[provider.providerType] ?? PROVIDER_ICONS.custom;

  return (
    <div className="overflow-hidden rounded-md border border-border bg-sidebar-background">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 h-8 px-3 text-xs cursor-pointer hover:bg-list-hover-background transition-colors"
      >
        <span
          className={`${iconClass} text-base shrink-0 ${provider.isEnabled ? "text-foreground-muted" : "text-foreground-muted/30"}`}
        />
        <span
          className={`text-sm font-medium truncate ${provider.isEnabled ? "text-foreground" : "text-foreground/30"}`}
        >
          {provider.name}
        </span>
        <span className="text-[11px] font-mono text-foreground-muted/60 shrink-0">
          {provider.providerType}
        </span>
        {!provider.isEnabled ? (
          <span className="text-[10px] text-foreground-muted/40 shrink-0">已禁用</span>
        ) : null}
        <span
          className={`ml-auto text-sm shrink-0 ${expanded ? "icon-[material-symbols--keyboard-arrow-up]" : "icon-[material-symbols--keyboard-arrow-down]"}`}
        />
      </button>

      <div className="flex items-center gap-2 h-7 px-3 text-[11px] text-foreground-muted border-b border-border/50">
        <span className="font-mono text-foreground-muted/60">{maskApiKey(provider.apiKey)}</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEditProvider();
          }}
          className="rounded p-0.5 hover:bg-button-hover-background hover:text-foreground transition-colors"
          title="编辑"
        >
          <span className="icon-[material-symbols--edit] text-sm leading-none" />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDeleteProvider();
          }}
          className="rounded p-0.5 hover:bg-button-hover-background hover:text-foreground transition-colors"
          title="删除"
        >
          <span className="icon-[material-symbols--delete-outline] text-sm leading-none" />
        </button>
      </div>

      {expanded ? (
        <div>
          {models.length > 0 ? (
            <table className="w-full">
              <thead>
                <tr className="h-6 border-b border-border/50 text-[10px] font-semibold uppercase text-foreground-muted/60">
                  <th className="px-3 text-left font-medium">模型</th>
                  <th className="w-16 px-2 text-right font-medium">上下文</th>
                  <th className="w-8 px-2 text-center font-medium">视觉</th>
                  <th className="w-8 px-2 text-center font-medium">工具</th>
                  <th className="w-18 px-2 text-right font-medium">价格</th>
                  <th className="w-15 px-2" />
                </tr>
              </thead>
              <tbody>
                {models.map((model) => (
                  <AiModelRowComponent
                    key={model.id}
                    model={model}
                    onEdit={() => onEditModel(model)}
                    onDelete={() => onDeleteModel(model)}
                    onSetDefault={() => onSetDefaultModel(model.id)}
                    _onToggleEnabled={() => {}}
                  />
                ))}
              </tbody>
            </table>
          ) : (
            <div className="px-3 py-3 text-[11px] text-foreground-muted/50">暂无模型</div>
          )}
          <div className="border-t border-border/50 px-3 py-1.5">
            <button
              type="button"
              onClick={onAddModel}
              className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-foreground-muted hover:text-foreground hover:bg-list-hover-background transition-colors"
            >
              <span className="icon-[material-symbols--add] text-sm leading-none" />
              添加模型
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

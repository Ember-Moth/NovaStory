import { useLocation } from "wouter";

import { cn } from "@/shared/lib/cn";
import { LoadingBlock } from "@/shared/ui/Loading";
import { OverlayScrollbar } from "@/shared/ui/OverlayScrollbar";

import { formatModelCapabilities } from "../../shared/modelSelection/formatModelCapabilities";

type ConnectionModelGroup = {
  connection: {
    id: string;
    name: string;
  };
  models: Array<{
    id: string;
    displayName: string;
    modelId: string;
    family?: string | null;
    contextWindow?: number | null;
    supportsToolUse?: boolean | null;
    supportsReasoning?: boolean | null;
    supportsVision?: boolean | null;
  }>;
};

export function DefaultModelSelect({
  groups,
  selectedConnectionId,
  selectedModelId,
  loading,
  disabled,
  onSelect,
  onClear,
}: {
  groups: ConnectionModelGroup[];
  selectedConnectionId: string;
  selectedModelId: string;
  loading: boolean;
  disabled: boolean;
  onSelect: (_connectionId: string, _modelId: string) => void;
  onClear: () => void;
}) {
  const [, navigate] = useLocation();
  const hasModels = groups.some((group) => group.models.length > 0);

  if (loading) {
    return <LoadingBlock label="模型加载中..." />;
  }

  if (!hasModels) {
    return (
      <div className="rounded-md border border-border border-dashed px-4 py-6 text-foreground-muted text-sm">
        <div className="font-medium text-foreground">没有可用连接模型</div>
        <p className="mt-1 text-xs">先创建并启用一个 AI 连接，再回到这里选择默认模型。</p>
        <button
          type="button"
          onClick={() => navigate("/settings/ai-connections")}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-accent-background px-3 py-1.5 font-medium text-foreground text-sm transition hover:brightness-110"
        >
          <span className="icon-[material-symbols--smart-toy] text-base" />
          打开 AI 连接
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="h-[min(22rem,55vh)] overflow-hidden rounded-md border border-border bg-editor-background">
        <OverlayScrollbar variant="card">
          {groups.map((group) =>
            group.models.length > 0 ? (
              <div key={group.connection.id}>
                <div className="sticky top-0 z-10 border-border border-b bg-sidebar-background px-3 py-1.5 font-medium text-foreground-muted text-xs">
                  {group.connection.name}
                </div>
                <div className="divide-y divide-border">
                  {group.models.map((model) => {
                    const selected =
                      group.connection.id === selectedConnectionId && model.id === selectedModelId;
                    const capabilities = formatModelCapabilities(model);

                    return (
                      <button
                        key={`${group.connection.id}:${model.id}`}
                        type="button"
                        disabled={disabled}
                        onClick={() => onSelect(group.connection.id, model.id)}
                        className={cn(
                          "flex w-full items-start gap-3 px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-50",
                          selected
                            ? "bg-list-active-background text-foreground"
                            : "text-foreground-muted hover:bg-list-hover-background hover:text-foreground",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-0.5 shrink-0 text-[18px]",
                            selected
                              ? "icon-[material-symbols--radio-button-checked] text-accent-foreground"
                              : "icon-[material-symbols--radio-button-unchecked] text-foreground-muted",
                          )}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-foreground text-sm">
                            {model.displayName}
                          </span>
                          <span className="mt-0.5 block truncate text-xs">{model.modelId}</span>
                          {capabilities ? (
                            <span className="mt-1 block text-[11px] leading-4">{capabilities}</span>
                          ) : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null,
          )}
        </OverlayScrollbar>
      </div>

      <button
        type="button"
        disabled={disabled || (!selectedConnectionId && !selectedModelId)}
        onClick={onClear}
        className="inline-flex h-8 w-fit items-center gap-1.5 rounded-md border border-border bg-sidebar-background px-2.5 text-foreground text-sm transition hover:bg-list-hover-background disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="icon-[material-symbols--close] text-base" />
        清除默认模型
      </button>
    </div>
  );
}

import { useState } from "react";

import type { AiCatalogProviderView } from "@/modules/ai/domain/types";
import { rpc } from "@/rpc/client";
import { LoadingInline } from "@/shared/ui/Loading";

import { fmtContextWindow, fmtPrice } from "./format";

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
          className="rounded-md border border-border bg-editor-background px-3 py-2 text-xs"
        >
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground">{model.displayName}</span>
            <span className="font-mono text-foreground-muted">{model.modelId}</span>
            {!model.isActive ? (
              <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-foreground-muted">
                已失活
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
      ))}
    </div>
  );
}

export function CatalogProviderCard({
  provider,
  onQuickConnect,
}: {
  provider: AiCatalogProviderView;
  onQuickConnect: (_providerId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-md border border-border bg-sidebar-background">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className="sticky top-0 z-10 flex w-full items-center gap-3 rounded-md bg-sidebar-background px-4 py-3 text-left transition hover:bg-list-hover-background"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold text-foreground text-sm">{provider.name}</span>
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
                className="cursor-pointer rounded-full bg-emerald-500/10 px-2 py-0.5 font-medium text-[10px] text-emerald-300 transition hover:bg-emerald-500/20"
              >
                快速接入
              </span>
            ) : (
              <span className="rounded-full bg-amber-500/10 px-2 py-0.5 font-medium text-[10px] text-amber-300">
                暂不支持
              </span>
            )}
            {!provider.isActive ? (
              <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-foreground-muted">
                已失活
              </span>
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-foreground-muted">
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
          <div className="mb-3 space-y-1 text-[11px] text-foreground-muted">
            <div>API: {provider.apiUrl ?? "—"}</div>
            <div>ENV: {provider.envKeys.length > 0 ? provider.envKeys.join(", ") : "—"}</div>
            {provider.docsUrl ? (
              <a
                href={provider.docsUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-accent-foreground hover:underline"
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

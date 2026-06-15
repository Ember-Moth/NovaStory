import { useState } from "react";

import type { AiConnectionCustomModelRow, AiConnectionRow } from "@/modules/ai/domain/types";
import { rpc } from "@/rpc/client";
import { LoadingBlock } from "@/shared/ui/Loading";
import { OverlayScrollbar } from "@/shared/ui/OverlayScrollbar";

import { SettingsPageShell } from "../layout/SettingsPageShell";
import { CatalogProviderCard } from "./CatalogProviderCard";
import { ConnectionDialog } from "./ConnectionDialog";
import { ConnectionCard } from "./ConnectionList";
import { CustomModelDialog } from "./CustomModelDialog";
import type { ConnectionFormData, CustomModelFormData } from "./forms";

export function ConnectionsSettingsPage() {
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
    if (!customModelConnection) {
      return;
    }

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
    <SettingsPageShell
      title="AI 连接"
      summary={
        <>
          {status?.activeProviderCount ?? 0} 个活跃 provider · {status?.activeModelCount ?? 0} 个
          活跃模型 · {allConnections.length} 个连接
        </>
      }
      actions={
        <>
          <button
            type="button"
            onClick={() => {
              setEditingConnection(undefined);
              setConnectionDialogOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-sidebar-background px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-list-hover-background"
          >
            <span className="icon-[material-symbols--add] text-base" />
            新建连接
          </button>
          <button
            type="button"
            onClick={() => void refreshCatalog.mutate({ force: true })}
            disabled={refreshCatalog.isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent-background px-3 py-1.5 text-sm font-medium text-foreground transition hover:brightness-110 disabled:opacity-50"
          >
            <span
              className={`text-base ${refreshCatalog.isPending ? "icon-[material-symbols--sync] animate-spin" : "icon-[material-symbols--cloud-sync]"}`}
            />
            刷新 Catalog
          </button>
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
        <section className="mb-4 grid shrink-0 gap-3 rounded-md border border-border bg-sidebar-background p-3 text-sm text-foreground-muted sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <div className="text-[11px] tracking-wide text-foreground-muted/70 uppercase">
              Last Success
            </div>
            <div className="mt-1 text-foreground">
              {status?.lastSuccessAt ? new Date(status.lastSuccessAt).toLocaleString() : "从未同步"}
            </div>
          </div>
          <div>
            <div className="text-[11px] tracking-wide text-foreground-muted/70 uppercase">
              Last Attempt
            </div>
            <div className="mt-1 text-foreground">
              {status?.lastAttemptAt ? new Date(status.lastAttemptAt).toLocaleString() : "—"}
            </div>
          </div>
          <div>
            <div className="text-[11px] tracking-wide text-foreground-muted/70 uppercase">
              State
            </div>
            <div className="mt-1 text-foreground">
              {status?.isStale ? "快照已过期" : "快照新鲜"}
            </div>
          </div>
          <div>
            <div className="text-[11px] tracking-wide text-foreground-muted/70 uppercase">
              Last Error
            </div>
            <div className="mt-1 wrap-break-word text-foreground">{status?.lastError ?? "—"}</div>
          </div>
        </section>

        <section className="grid min-h-0 flex-1 gap-4 overflow-y-auto xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] xl:overflow-hidden">
          <div className="flex min-h-0 flex-col gap-3 xl:overflow-hidden">
            <div className="shrink-0">
              <h2 className="text-sm font-semibold text-foreground">Connections</h2>
              <p className="text-xs text-foreground-muted">
                这里保存真正会被未来 AI SDK 使用的连接实例。
              </p>
            </div>

            <OverlayScrollbar variant="card">
              {connectionsLoading ? (
                <LoadingBlock label="连接加载中..." />
              ) : allConnections.length === 0 ? (
                <div className="rounded-md border border-dashed border-border px-4 py-10 text-sm text-foreground-muted">
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
                      onEdit={(current) => {
                        setEditingConnection(current);
                        setConnectionDialogOpen(true);
                      }}
                      onDelete={(current) => void deleteConnection.mutate({ id: current.id })}
                      onOpenAddCustomModel={(current) => {
                        setCustomModelConnection(current);
                        setEditingCustomModel(undefined);
                        setCustomModelDialogOpen(true);
                      }}
                      onOpenEditCustomModel={(connectionRow, model) => {
                        if (!model.customModelId) {
                          return;
                        }

                        setCustomModelConnection(connectionRow);
                        setEditingCustomModel({
                          id: model.customModelId,
                          connectionId: connectionRow.id,
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
                      onDeleteCustomModel={(_connectionRow, model) => {
                        if (!model.customModelId) {
                          return;
                        }
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
              <h2 className="text-sm font-semibold text-foreground">Catalog</h2>
              <p className="text-xs text-foreground-muted">
                从支持的 provider Catalog 中快速接入连接，或检查模型快照。
              </p>
            </div>

            <div className="shrink-0">
              <label className="block">
                <span className="sr-only">过滤 provider</span>
                <div className="flex items-center gap-2 rounded-md border border-border bg-sidebar-background px-2 py-1.5">
                  <span className="icon-[material-symbols--search] text-base text-foreground-muted" />
                  <input
                    type="text"
                    value={providerFilter}
                    onChange={(event) => setProviderFilter(event.target.value)}
                    placeholder="筛选 provider..."
                    className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-foreground-muted/50"
                  />
                </div>
              </label>
            </div>

            <OverlayScrollbar variant="card">
              {providersLoading ? (
                <LoadingBlock label="Catalog 加载中..." />
              ) : (
                <div className="space-y-2">
                  {allProviders
                    .filter((provider) => {
                      const normalizedQuery = providerFilter.trim().toLowerCase();
                      if (!normalizedQuery) {
                        return true;
                      }

                      return [provider.name, provider.sdkPackage ?? "", provider.apiUrl ?? ""]
                        .join("\n")
                        .toLowerCase()
                        .includes(normalizedQuery);
                    })
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
        onSave={(data) => void handleSaveConnection(data)}
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
        onSave={(data) => void handleSaveCustomModel(data)}
      />
    </SettingsPageShell>
  );
}

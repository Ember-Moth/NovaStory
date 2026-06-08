import { useState } from "react";
import { useLocation } from "wouter";

import type { AiModelRow, AiProviderRow } from "@/domain/types";
import { rpc } from "@/server/rpc/client";

import { AiModelDialog, type AiModelFormData } from "./components/AiModelDialog";
import { AiProviderCard } from "./components/AiProviderCard";
import { AiProviderDialog, type AiProviderFormData } from "./components/AiProviderDialog";

export function AiSettingsPage() {
  const [, navigate] = useLocation();

  const { data: allProviders, isLoading: providersLoading } = rpc.useQuery("ai.listProviders");
  const { data: allModels, isLoading: modelsLoading } = rpc.useQuery("ai.listModels");

  const createProvider = rpc.useMutation("ai.createProvider");
  const updateProvider = rpc.useMutation("ai.updateProvider");
  const deleteProvider = rpc.useMutation("ai.deleteProvider");
  const createModel = rpc.useMutation("ai.createModel");
  const updateModel = rpc.useMutation("ai.updateModel");
  const deleteModel = rpc.useMutation("ai.deleteModel");
  const setDefaultModel = rpc.useMutation("ai.setDefaultModel");
  const syncModels = rpc.useMutation("ai.syncModels");

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const [provDialogOpen, setProvDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<AiProviderRow | undefined>();

  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<AiModelRow | undefined>();
  const [modelProviderId, setModelProviderId] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<
    { type: "provider"; provider: AiProviderRow } | { type: "model"; model: AiModelRow } | null
  >(null);

  const providers = allProviders ?? [];
  const models = allModels ?? [];
  const isLoading = providersLoading || modelsLoading;

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleOpenAddProvider = () => {
    setEditingProvider(undefined);
    setProvDialogOpen(true);
  };

  const handleOpenEditProvider = (provider: AiProviderRow) => {
    setEditingProvider(provider);
    setProvDialogOpen(true);
  };

  const handleSaveProvider = async (data: AiProviderFormData) => {
    if (editingProvider) {
      await updateProvider.mutate({
        id: editingProvider.id,
        ...data,
      });
    } else {
      const result = await createProvider.mutate(data);
      setExpandedIds((prev) => new Set(prev).add(result.id));
    }
    setProvDialogOpen(false);
  };

  const handleDeleteProvider = (provider: AiProviderRow) => {
    setDeleteTarget({ type: "provider", provider });
  };

  const confirmDeleteProvider = async () => {
    if (deleteTarget?.type !== "provider") return;
    await deleteProvider.mutate({ id: deleteTarget.provider.id });
    setDeleteTarget(null);
  };

  const handleOpenAddModel = (providerId: string) => {
    setEditingModel(undefined);
    setModelProviderId(providerId);
    setModelDialogOpen(true);
  };

  const handleOpenEditModel = (model: AiModelRow) => {
    setEditingModel(model);
    setModelProviderId(model.providerId);
    setModelDialogOpen(true);
  };

  const handleSaveModel = async (data: AiModelFormData) => {
    if (editingModel) {
      await updateModel.mutate({
        id: editingModel.id,
        ...data,
      });
    } else if (modelProviderId) {
      await createModel.mutate({
        providerId: modelProviderId,
        ...data,
      });
    }
    setModelDialogOpen(false);
  };

  const handleDeleteModel = (model: AiModelRow) => {
    setDeleteTarget({ type: "model", model });
  };

  const confirmDeleteModel = async () => {
    if (deleteTarget?.type !== "model") return;
    await deleteModel.mutate({ id: deleteTarget.model.id });
    setDeleteTarget(null);
  };

  const handleSetDefault = async (modelId: string) => {
    await setDefaultModel.mutate({ id: modelId });
  };

  const handleSyncModels = async (providerId: string) => {
    await syncModels.mutate({ providerId });
  };

  const allBusy =
    createProvider.isPending ||
    updateProvider.isPending ||
    deleteProvider.isPending ||
    createModel.isPending ||
    updateModel.isPending ||
    deleteModel.isPending ||
    setDefaultModel.isPending ||
    syncModels.isPending;

  return (
    <main className="min-h-dvh select-none bg-editor-background text-foreground">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-8">
        {/* Header */}
        <section className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate("/")}
              className="rounded p-1 text-foreground-muted hover:text-foreground hover:bg-button-hover-background transition-colors"
              title="返回"
            >
              <span className="icon-[material-symbols--arrow-back] text-xl" />
            </button>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">AI 设置</h1>
              <p className="mt-0.5 text-xs text-foreground-muted">
                {providers.length} 个提供方 · {models.length} 个模型
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleOpenAddProvider}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-sidebar-background px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-list-hover-background"
          >
            <span className="icon-[material-symbols--add] text-base" />
            新提供方
          </button>
        </section>

        {/* Loading state */}
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 rounded-md border border-dashed border-border px-4 py-10 text-sm text-foreground-muted">
            <span className="icon-[material-symbols--sync] text-base animate-spin" />
            加载中...
          </div>
        ) : null}

        {/* Empty state */}
        {!isLoading && providers.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border px-4 py-12 text-sm text-foreground-muted">
            <span className="icon-[material-symbols--api] text-3xl" />
            <span>还没有 AI 提供方，点击「新提供方」添加。</span>
          </div>
        ) : null}

        {/* Provider cards */}
        {!isLoading
          ? providers.map((provider) => {
              const providerModels = models.filter((m) => m.providerId === provider.id);
              return (
                <AiProviderCard
                  key={provider.id}
                  provider={provider}
                  models={providerModels}
                  expanded={expandedIds.has(provider.id)}
                  onToggle={() => toggleExpanded(provider.id)}
                  onEditProvider={() => handleOpenEditProvider(provider)}
                  onDeleteProvider={() => handleDeleteProvider(provider)}
                  onSyncModels={() => handleSyncModels(provider.id)}
                  isSyncing={syncModels.isPending}
                  onAddModel={() => handleOpenAddModel(provider.id)}
                  onEditModel={handleOpenEditModel}
                  onDeleteModel={handleDeleteModel}
                  onSetDefaultModel={handleSetDefault}
                />
              );
            })
          : null}

        {/* Bottom add button */}
        {!isLoading && providers.length > 0 ? (
          <button
            type="button"
            onClick={handleOpenAddProvider}
            className="inline-flex items-center gap-1.5 self-start rounded-md px-3 py-1.5 text-sm text-foreground-muted transition hover:text-foreground hover:bg-list-hover-background"
          >
            <span className="icon-[material-symbols--add] text-base" />
            添加提供方
          </button>
        ) : null}
      </div>

      {/* Provider dialog */}
      <AiProviderDialog
        open={provDialogOpen}
        provider={editingProvider}
        isPending={createProvider.isPending || updateProvider.isPending}
        onSave={handleSaveProvider}
        onCancel={() => setProvDialogOpen(false)}
      />

      {/* Model dialog */}
      <AiModelDialog
        open={modelDialogOpen}
        model={editingModel}
        isPending={createModel.isPending || updateModel.isPending}
        onSave={handleSaveModel}
        onCancel={() => setModelDialogOpen(false)}
      />

      {/* Delete confirmation dialog */}
      {deleteTarget ? (
        <dialog
          open
          onCancel={(event) => {
            event.preventDefault();
            if (!allBusy) setDeleteTarget(null);
          }}
          className="w-[min(24rem,calc(100vw-2rem))] rounded-lg border border-border bg-sidebar-background p-0 text-foreground shadow-lg backdrop:bg-black/50"
        >
          <div className="flex items-center gap-2 border-b border-border px-4 py-2">
            <span className="icon-[material-symbols--warning] text-base text-accent-foreground" />
            <span className="text-sm font-medium">确认删除</span>
            <button
              type="button"
              onClick={() => setDeleteTarget(null)}
              disabled={allBusy}
              className="ml-auto rounded p-0.5 text-foreground-muted transition hover:bg-button-hover-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span className="icon-[material-symbols--close] text-base leading-none" />
            </button>
          </div>
          <div className="p-4 text-sm leading-relaxed text-foreground-muted">
            {deleteTarget.type === "provider"
              ? `确认删除提供方「${deleteTarget.provider.name}」吗？该提供方下的所有模型也将被删除。`
              : `确认删除模型「${deleteTarget.model.displayName}」吗？`}
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
            <button
              type="button"
              onClick={() => setDeleteTarget(null)}
              disabled={allBusy}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-list-hover-background disabled:cursor-not-allowed disabled:opacity-40"
            >
              取消
            </button>
            <button
              type="button"
              onClick={
                deleteTarget.type === "provider" ? confirmDeleteProvider : confirmDeleteModel
              }
              disabled={allBusy}
              className="rounded-md bg-accent-foreground px-3 py-1.5 text-sm font-medium text-foreground transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {allBusy ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="icon-[material-symbols--sync] text-base animate-spin" />
                  删除中
                </span>
              ) : (
                `删除${deleteTarget.type === "provider" ? "提供方" : "模型"}`
              )}
            </button>
          </div>
        </dialog>
      ) : null}
    </main>
  );
}

import { type FormEvent, useEffect, useMemo, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";

import { AppShell } from "@/app/shell/AppShell";
import type { GlobalPromptRow } from "@/modules/ai/domain/types";
import { rpc } from "@/rpc/client";
import { cn } from "@/shared/lib/cn";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { MAIN_TEXT_EDITOR_MARKDOWN_EXTENSIONS } from "@/shared/ui/editor/MainTextEditor";
import { LoadingBlock } from "@/shared/ui/Loading";
import { OverlayScrollbar } from "@/shared/ui/OverlayScrollbar";

import { SettingsSidebar } from "./layout/SettingsSidebar";

interface PromptFormData {
  name: string;
  description: string | null;
  content: string;
}

const EMPTY_PROMPTS: GlobalPromptRow[] = [];

function formatUpdatedAt(value: number) {
  return new Date(value).toLocaleString();
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败。";
}

export function filterGlobalPrompts(prompts: GlobalPromptRow[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return prompts;
  }

  return prompts.filter((prompt) => {
    const haystack = [prompt.name, prompt.description ?? "", prompt.content]
      .join("\n")
      .toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}

export function PromptLibraryEmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-foreground-muted">
      <span className="icon-[material-symbols--article] text-3xl text-accent-foreground" />
      <div>
        <div className="font-medium text-foreground">还没有 Prompt</div>
        <div className="mt-1 text-xs">创建第一条可复用 Prompt。</div>
      </div>
      <button
        type="button"
        onClick={onCreate}
        className="inline-flex items-center gap-1.5 rounded-md bg-accent-background px-3 py-1.5 text-sm font-medium text-foreground transition hover:brightness-110"
      >
        <span className="icon-[material-symbols--add] text-base" />
        新建 Prompt
      </button>
    </div>
  );
}

export function PromptLibrarySettingsPage() {
  const { data: prompts, isLoading } = rpc.useQuery("ai.listGlobalPrompts");
  const createPrompt = rpc.useMutation("ai.createGlobalPrompt");
  const updatePrompt = rpc.useMutation("ai.updateGlobalPrompt");
  const deletePrompt = rpc.useMutation("ai.deleteGlobalPrompt");

  const allPrompts = prompts ?? EMPTY_PROMPTS;
  const [query, setQuery] = useState("");
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [pendingDeletePrompt, setPendingDeletePrompt] = useState<GlobalPromptRow | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const visiblePrompts = useMemo(() => filterGlobalPrompts(allPrompts, query), [allPrompts, query]);
  const selectedPrompt =
    selectedPromptId != null
      ? (allPrompts.find((prompt) => prompt.id === selectedPromptId) ?? null)
      : null;
  const isMutating = createPrompt.isPending || updatePrompt.isPending || deletePrompt.isPending;

  useEffect(() => {
    if (isCreating) {
      return;
    }

    if (selectedPromptId && allPrompts.some((prompt) => prompt.id === selectedPromptId)) {
      return;
    }

    setSelectedPromptId(allPrompts[0]?.id ?? null);
  }, [allPrompts, isCreating, selectedPromptId]);

  const startCreate = () => {
    setActionError(null);
    setSelectedPromptId(null);
    setIsCreating(true);
  };

  const handleSave = async (data: PromptFormData) => {
    setActionError(null);
    try {
      if (isCreating) {
        const created = await createPrompt.mutate(data);
        setSelectedPromptId(created.id);
        setIsCreating(false);
        return;
      }

      if (!selectedPrompt) {
        return;
      }

      const updated = await updatePrompt.mutate({
        id: selectedPrompt.id,
        ...data,
      });
      setSelectedPromptId(updated.id);
    } catch (error) {
      setActionError(getErrorMessage(error));
    }
  };

  const handleToggleEnabled = async (prompt: GlobalPromptRow, isEnabled: boolean) => {
    setActionError(null);
    try {
      await updatePrompt.mutate({
        id: prompt.id,
        isEnabled,
      });
    } catch (error) {
      setActionError(getErrorMessage(error));
    }
  };

  const handleDelete = async () => {
    if (!pendingDeletePrompt) {
      return;
    }

    setActionError(null);
    try {
      const deleted = await deletePrompt.mutate({ id: pendingDeletePrompt.id });
      if (selectedPromptId === deleted.id) {
        setSelectedPromptId(null);
      }
      setPendingDeletePrompt(null);
      setIsCreating(false);
    } catch (error) {
      setActionError(getErrorMessage(error));
    }
  };

  return (
    <AppShell active="settings" sidebar={<SettingsSidebar />}>
      <div className="flex h-full flex-col overflow-hidden">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-title-bar-background px-4 py-2">
          <div className="min-w-0">
            <h1 className="text-[14px] font-semibold text-foreground">Prompt 库</h1>
            <p className="text-[11px] text-foreground-muted">
              {allPrompts.length} 条 Prompt ·{" "}
              {allPrompts.filter((prompt) => prompt.isEnabled).length} 条已启用
            </p>
          </div>

          <button
            type="button"
            onClick={startCreate}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent-background px-3 py-1.5 text-sm font-medium text-foreground transition hover:brightness-110"
          >
            <span className="icon-[material-symbols--add] text-base" />
            新建 Prompt
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(18rem,0.36fr)_minmax(0,1fr)] overflow-hidden">
          <aside className="flex min-h-0 flex-col border-r border-border bg-sidebar-background">
            <div className="shrink-0 border-b border-border p-3">
              <label className="block">
                <span className="sr-only">搜索 Prompt</span>
                <div className="flex items-center gap-2 rounded-md border border-border bg-editor-background px-2 py-1.5">
                  <span className="icon-[material-symbols--search] text-base text-foreground-muted" />
                  <input
                    type="text"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索 Prompt..."
                    className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-foreground-muted/50"
                  />
                </div>
              </label>
            </div>

            <OverlayScrollbar variant="panel">
              {isLoading ? (
                <div className="p-3">
                  <LoadingBlock label="Prompt 加载中..." />
                </div>
              ) : allPrompts.length === 0 ? (
                <div className="p-3">
                  <PromptLibraryEmptyState onCreate={startCreate} />
                </div>
              ) : visiblePrompts.length === 0 ? (
                <div className="p-4 text-sm text-foreground-muted">没有匹配的 Prompt。</div>
              ) : (
                <div className="space-y-1 p-2">
                  {visiblePrompts.map((prompt) => (
                    <PromptListItem
                      key={prompt.id}
                      prompt={prompt}
                      isActive={!isCreating && selectedPromptId === prompt.id}
                      isBusy={isMutating}
                      onSelect={() => {
                        setActionError(null);
                        setIsCreating(false);
                        setSelectedPromptId(prompt.id);
                      }}
                      onToggleEnabled={(isEnabled) => void handleToggleEnabled(prompt, isEnabled)}
                    />
                  ))}
                </div>
              )}
            </OverlayScrollbar>
          </aside>

          <main className="flex min-h-0 flex-col overflow-hidden bg-editor-background">
            {actionError ? (
              <div className="shrink-0 border-b border-border bg-red-500/10 px-4 py-2 text-sm text-red-200">
                {actionError}
              </div>
            ) : null}

            {isCreating || selectedPrompt ? (
              <PromptEditor
                key={isCreating ? "new" : selectedPrompt?.id}
                prompt={isCreating ? null : selectedPrompt}
                isPending={createPrompt.isPending || updatePrompt.isPending}
                onCancel={() => {
                  setActionError(null);
                  setIsCreating(false);
                  setSelectedPromptId(allPrompts[0]?.id ?? null);
                }}
                onDelete={
                  selectedPrompt && !isCreating
                    ? () => setPendingDeletePrompt(selectedPrompt)
                    : undefined
                }
                onSave={handleSave}
              />
            ) : (
              <div className="flex h-full items-center justify-center p-6">
                <PromptLibraryEmptyState onCreate={startCreate} />
              </div>
            )}
          </main>
        </div>
      </div>

      <ConfirmDialog
        open={pendingDeletePrompt != null}
        title="删除 Prompt"
        description="删除后无法在当前库中继续编辑这条 Prompt。"
        items={pendingDeletePrompt ? [pendingDeletePrompt.name] : []}
        confirmLabel="删除"
        isPending={deletePrompt.isPending}
        onCancel={() => setPendingDeletePrompt(null)}
        onConfirm={() => void handleDelete()}
      />
    </AppShell>
  );
}

function PromptListItem({
  prompt,
  isActive,
  isBusy,
  onSelect,
  onToggleEnabled,
}: {
  prompt: GlobalPromptRow;
  isActive: boolean;
  isBusy: boolean;
  onSelect: () => void;
  onToggleEnabled: (_isEnabled: boolean) => void;
}) {
  return (
    <div
      className={cn(
        "group rounded-md border px-3 py-2 transition",
        isActive
          ? "border-accent-foreground bg-list-active-background"
          : "border-transparent hover:border-border hover:bg-list-hover-background",
      )}
    >
      <button type="button" onClick={onSelect} className="block w-full min-w-0 text-left">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{prompt.name}</span>
          {!prompt.isEnabled ? (
            <span className="shrink-0 rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-foreground-muted">
              已禁用
            </span>
          ) : null}
        </div>
        {prompt.description ? (
          <div className="mt-1 max-h-8 overflow-hidden text-xs leading-4 text-foreground-muted">
            {prompt.description}
          </div>
        ) : null}
        <div className="mt-1 truncate text-[11px] text-foreground-muted/70">
          更新于 {formatUpdatedAt(prompt.updatedAt)}
        </div>
      </button>

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[11px] text-foreground-muted">
          {prompt.content.length.toLocaleString()} 字符
        </span>
        <button
          type="button"
          disabled={isBusy}
          onClick={() => onToggleEnabled(!prompt.isEnabled)}
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
            prompt.isEnabled
              ? "bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
              : "bg-white/5 text-foreground-muted hover:bg-white/10",
          )}
        >
          <span
            className={cn(
              "text-xs",
              prompt.isEnabled
                ? "icon-[material-symbols--toggle-on]"
                : "icon-[material-symbols--toggle-off]",
            )}
          />
          {prompt.isEnabled ? "启用" : "禁用"}
        </button>
      </div>
    </div>
  );
}

function PromptEditor({
  prompt,
  isPending,
  onCancel,
  onDelete,
  onSave,
}: {
  prompt: GlobalPromptRow | null;
  isPending: boolean;
  onCancel: () => void;
  onDelete?: () => void;
  onSave: (_data: PromptFormData) => Promise<void>;
}) {
  const [name, setName] = useState(prompt?.name ?? "");
  const [description, setDescription] = useState(prompt?.description ?? "");
  const [content, setContent] = useState(prompt?.content ?? "");
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedContent = content.trim();

    if (!trimmedName) {
      setFormError("名称不能为空。");
      return;
    }

    if (!trimmedContent) {
      setFormError("Prompt 正文不能为空。");
      return;
    }

    setFormError(null);
    void onSave({
      name: trimmedName,
      description: description.trim() || null,
      content: trimmedContent,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-title-bar-background px-4 py-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">
            {prompt ? "编辑 Prompt" : "新建 Prompt"}
          </h2>
          <p className="text-[11px] text-foreground-muted">
            {prompt ? `更新于 ${formatUpdatedAt(prompt.updatedAt)}` : "填写名称和正文后保存"}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {onDelete ? (
            <button
              type="button"
              onClick={onDelete}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-list-hover-background disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span className="icon-[material-symbols--delete-outline] text-base" />
              删除
            </button>
          ) : null}
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
            className="inline-flex items-center gap-1.5 rounded-md bg-accent-background px-3 py-1.5 text-sm font-medium text-foreground transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? (
              <>
                <span className="icon-[material-symbols--sync] animate-spin text-base" />
                保存中
              </>
            ) : (
              <>
                <span className="icon-[material-symbols--save] text-base" />
                保存
              </>
            )}
          </button>
        </div>
      </div>

      <div className="shrink-0 space-y-3 border-b border-border bg-sidebar-background px-4 py-3">
        {formError ? (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {formError}
          </div>
        ) : null}

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)]">
          <label className="block space-y-1">
            <span className="text-[11px] font-medium text-foreground-muted">名称</span>
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：章节扩写"
              className="w-full rounded-md border border-border bg-editor-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-foreground-muted/50 focus:border-accent-foreground"
            />
          </label>
        </div>

        <label className="block space-y-1">
          <span className="text-[11px] font-medium text-foreground-muted">说明</span>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="可选，用于区分用途"
            className="w-full rounded-md border border-border bg-editor-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-foreground-muted/50 focus:border-accent-foreground"
          />
        </label>
      </div>

      <CodeMirror
        value={content}
        onChange={setContent}
        placeholder="输入 Prompt 正文..."
        indentWithTab={false}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLineGutter: true,
          highlightSpecialChars: false,
          history: true,
          foldGutter: false,
          drawSelection: true,
          dropCursor: true,
          allowMultipleSelections: true,
          indentOnInput: false,
          syntaxHighlighting: true,
          bracketMatching: false,
          closeBrackets: false,
          autocompletion: false,
          rectangularSelection: false,
          crosshairCursor: false,
          highlightActiveLine: true,
          highlightSelectionMatches: true,
          closeBracketsKeymap: false,
          searchKeymap: true,
          foldKeymap: false,
          completionKeymap: false,
          lintKeymap: false,
          tabSize: 2,
        }}
        extensions={[
          ...MAIN_TEXT_EDITOR_MARKDOWN_EXTENSIONS,
          EditorView.lineWrapping,
          EditorView.theme(
            {
              "&": {
                height: "100%",
              },
              ".cm-scroller": {
                overflow: "auto",
                fontFamily: "inherit",
              },
              ".cm-content": {
                minHeight: "100%",
                paddingBottom: "45vh",
              },
            },
            { dark: true },
          ),
        ]}
        theme="none"
        height="100%"
        className="main-text-editor min-h-0 flex-1"
      />
    </form>
  );
}

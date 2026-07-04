import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  type MenuRenderFn,
  useBasicTypeaheadTriggerMatch,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import { $createParagraphNode, $createTextNode, $getRoot, type LexicalEditor } from "lexical";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { GlobalPromptRow } from "@/modules/ai/domain/types";
import { rpc } from "@/rpc/client";
import { cn } from "@/shared/lib/cn";
import {
  $createAssistantMentionNode,
  type AssistantComposerSubmitPayload,
  AssistantMentionNode,
  compileAssistantComposerState,
} from "./assistantComposerModel";

export type {
  AssistantComposerSubmitPayload,
  AssistantMentionInput,
  AssistantMentionKind,
  AssistantMentionMode,
} from "./assistantComposerModel";
export { compileAssistantComposerState } from "./assistantComposerModel";

export function AssistantComposer({
  disabled,
  placeholder,
  onSubmit,
  onTextChange,
  onPayloadChange,
  isBusy,
  value,
}: {
  disabled: boolean;
  placeholder: string;
  onSubmit: (_payload: AssistantComposerSubmitPayload) => boolean;
  onTextChange?: (_text: string) => void;
  onPayloadChange?: (_payload: AssistantComposerSubmitPayload) => void;
  isBusy: boolean;
  value?: string;
}) {
  const initialValueRef = useRef(value ?? "");
  const initialConfig = useMemo(
    () => ({
      namespace: "AssistantComposer",
      editable: false,
      editorState: () => {
        seedEditorText(initialValueRef.current);
      },
      onError(error: Error) {
        throw error;
      },
      theme: {
        paragraph: "mb-0",
      },
      nodes: [AssistantMentionNode],
    }),
    [],
  );

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <AssistantComposerInner
        disabled={disabled}
        isBusy={isBusy}
        placeholder={placeholder}
        onSubmit={onSubmit}
        onTextChange={onTextChange}
        onPayloadChange={onPayloadChange}
        value={value ?? ""}
      />
    </LexicalComposer>
  );
}

function AssistantComposerInner({
  disabled,
  isBusy,
  placeholder,
  onSubmit,
  onTextChange,
  onPayloadChange,
  value,
}: {
  disabled: boolean;
  isBusy: boolean;
  placeholder: string;
  onSubmit: (_payload: AssistantComposerSubmitPayload) => boolean;
  onTextChange?: (_text: string) => void;
  onPayloadChange?: (_payload: AssistantComposerSubmitPayload) => void;
  value: string;
}) {
  const [editor] = useLexicalComposerContext();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const composingRef = useRef(false);
  const [typeaheadOpen, setTypeaheadOpen] = useState(false);

  useEffect(() => {
    editor.setEditable(!disabled);
  }, [disabled, editor]);

  const submitCurrentState = useCallback(() => {
    if (disabled || isBusy) {
      return;
    }

    const payload = compileAssistantComposerState(editor.getEditorState());
    if (payload.text.trim().length === 0 && payload.mentions.length === 0) {
      return;
    }

    const accepted = onSubmit({
      ...payload,
      text: payload.text.trim(),
    });
    if (accepted) {
      clearEditor(editor);
    }
  }, [disabled, editor, isBusy, onSubmit]);

  useEffect(() => {
    const root = rootRef.current;
    const form = root?.closest("form");
    if (form == null) {
      return;
    }

    const handleFormSubmit = (event: SubmitEvent) => {
      event.preventDefault();
      submitCurrentState();
    };

    form.addEventListener("submit", handleFormSubmit);
    return () => {
      form.removeEventListener("submit", handleFormSubmit);
    };
  }, [submitCurrentState]);

  return (
    <div
      ref={rootRef}
      className={cn("relative", disabled ? "cursor-not-allowed opacity-70" : "cursor-text")}
    >
      <RichTextPlugin
        contentEditable={
          <ContentEditable
            aria-label="AI 对话输入"
            aria-placeholder={placeholder}
            placeholder={
              <div className="pointer-events-none absolute top-2 left-2.5 text-[13px] text-foreground-muted/70 leading-5">
                {placeholder}
              </div>
            }
            spellCheck={false}
            className="field-sizing-content wrap-break-word max-h-48 min-h-5 w-full overflow-y-auto whitespace-pre-wrap border-none bg-transparent px-2.5 pt-2 text-[13px] text-editor-foreground leading-5 outline-none"
            onCompositionStart={() => {
              composingRef.current = true;
            }}
            onCompositionEnd={() => {
              composingRef.current = false;
            }}
            onKeyDown={(event) => {
              if (
                event.key !== "Enter" ||
                event.shiftKey ||
                composingRef.current ||
                typeaheadOpen
              ) {
                return;
              }
              event.preventDefault();
              submitCurrentState();
            }}
          />
        }
        placeholder={null}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <OnChangePlugin
        ignoreSelectionChange
        onChange={(editorState) => {
          const payload = compileAssistantComposerState(editorState);
          onTextChange?.(payload.text);
          onPayloadChange?.(payload);
        }}
      />
      <AssistantComposerValueSyncPlugin value={value} />
      <AssistantPromptTypeaheadPlugin onOpenChange={setTypeaheadOpen} disabled={disabled} />
    </div>
  );
}

function AssistantComposerValueSyncPlugin({ value }: { value: string }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const currentValue = compileAssistantComposerState(editor.getEditorState()).text;
    if (currentValue === value) {
      return;
    }

    editor.update(() => {
      seedEditorText(value);
    });
  }, [editor, value]);

  return null;
}

class AssistantPromptOption extends MenuOption {
  prompt: GlobalPromptRow;

  constructor(prompt: GlobalPromptRow) {
    super(prompt.id);
    this.prompt = prompt;
  }
}

function AssistantPromptTypeaheadPlugin({
  disabled,
  onOpenChange,
}: {
  disabled: boolean;
  onOpenChange: (_isOpen: boolean) => void;
}) {
  const promptsQuery = rpc.useQuery("ai.listGlobalPrompts");
  const [query, setQuery] = useState("");
  const checkForTriggerMatch = useBasicTypeaheadTriggerMatch("@", {
    minLength: 0,
    maxLength: 40,
  });
  const enabledPrompts = useMemo(
    () => (promptsQuery.data ?? []).filter((prompt) => prompt.isEnabled),
    [promptsQuery.data],
  );
  const options = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return enabledPrompts
      .filter((prompt) => {
        if (normalizedQuery.length === 0) {
          return true;
        }
        return [prompt.name, prompt.description ?? ""].some((value) =>
          value.toLocaleLowerCase().includes(normalizedQuery),
        );
      })
      .slice(0, 8)
      .map((prompt) => new AssistantPromptOption(prompt));
  }, [enabledPrompts, query]);

  const menuRenderFn = useCallback<MenuRenderFn<AssistantPromptOption>>(
    (
      anchorElementRef,
      { options: menuOptions, selectedIndex, selectOptionAndCleanUp, setHighlightedIndex },
    ) => {
      if (anchorElementRef.current == null) {
        return null;
      }

      return createPortal(
        <div className="w-72 max-w-[calc(100vw-1rem)] overflow-hidden rounded-md border border-border bg-sidebar-background py-1 text-[12px] text-foreground shadow-lg">
          {promptsQuery.isLoading ? (
            <div className="px-3 py-2 text-foreground-muted">加载 Prompt...</div>
          ) : menuOptions.length === 0 ? (
            <div className="px-3 py-2 text-foreground-muted">没有匹配的 Prompt</div>
          ) : (
            <ul className="max-h-72 overflow-y-auto py-0.5">
              {menuOptions.map((option, index) => (
                <li
                  key={option.key}
                  ref={option.setRefElement}
                  id={`typeahead-item-${index}`}
                  aria-selected={selectedIndex === index}
                  className={cn(
                    "flex cursor-pointer items-start gap-2 px-2.5 py-2 outline-none",
                    selectedIndex === index
                      ? "bg-list-active-background text-foreground"
                      : "text-foreground hover:bg-list-hover-background",
                  )}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    selectOptionAndCleanUp(option);
                  }}
                >
                  <span className="icon-[material-symbols--prompt-suggestion] mt-0.5 shrink-0 text-accent-foreground text-base" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{option.prompt.name}</span>
                    {option.prompt.description ? (
                      <span className="mt-0.5 line-clamp-2 block text-[11px] text-foreground-muted leading-4">
                        {option.prompt.description}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>,
        anchorElementRef.current,
      );
    },
    [promptsQuery.isLoading],
  );

  if (disabled) {
    return null;
  }

  return (
    <LexicalTypeaheadMenuPlugin<AssistantPromptOption>
      triggerFn={checkForTriggerMatch}
      options={options}
      menuRenderFn={menuRenderFn}
      onQueryChange={(matchingString) => setQuery(matchingString ?? "")}
      onOpen={() => onOpenChange(true)}
      onClose={() => onOpenChange(false)}
      onSelectOption={(option, textNodeContainingQuery, closeMenu) => {
        const mentionNode = $createAssistantMentionNode({
          kind: "global-prompt",
          mode: "snapshot-ref",
          targetId: option.prompt.id,
          label: option.prompt.name,
        });

        if (textNodeContainingQuery != null) {
          textNodeContainingQuery.replace(mentionNode);
        }
        mentionNode.insertAfter($createTextNode(" "));
        mentionNode.selectNext();
        closeMenu();
      }}
      anchorClassName="z-50"
      preselectFirstItem
    />
  );
}

function seedEditorText(text: string) {
  const root = $getRoot();
  root.clear();

  const paragraph = $createParagraphNode();
  if (text.length > 0) {
    paragraph.append($createTextNode(text));
  }
  root.append(paragraph);
}

function clearEditor(editor: LexicalEditor) {
  editor.update(() => {
    const root = $getRoot();
    root.clear();
    root.append($createParagraphNode());
  });
}

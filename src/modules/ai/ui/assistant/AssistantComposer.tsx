import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  useBasicTypeaheadTriggerMatch,
  type MenuRenderFn,
} from "@lexical/react/LexicalTypeaheadMenuPlugin";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  DecoratorNode,
  type EditorState,
  type LexicalEditor,
  type LexicalNode,
  type LexicalUpdateJSON,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";
import { createPortal } from "react-dom";

import type { GlobalPromptRow } from "@/modules/ai/domain/types";
import { rpc } from "@/rpc/client";
import { cn } from "@/shared/lib/cn";

export type AssistantMentionKind = "global-prompt" | "content-node" | "aux-path" | "timeline-point";

export type AssistantMentionMode = "snapshot-ref" | "inline-link";

export type AssistantMentionInput = {
  kind: AssistantMentionKind;
  mode: AssistantMentionMode;
  targetId: string;
  label: string;
};

export type AssistantComposerSubmitPayload = {
  text: string;
  mentions: AssistantMentionInput[];
};

export type SerializedAssistantMentionNode = Spread<AssistantMentionInput, SerializedLexicalNode>;

export class AssistantMentionNode extends DecoratorNode<ReactNode> {
  __kind: AssistantMentionKind;
  __mode: AssistantMentionMode;
  __targetId: string;
  __label: string;

  static override getType(): string {
    return "assistant-mention";
  }

  static override clone(node: AssistantMentionNode): AssistantMentionNode {
    return new AssistantMentionNode(
      node.__kind,
      node.__mode,
      node.__targetId,
      node.__label,
      node.__key,
    );
  }

  static override importJSON(serializedNode: SerializedAssistantMentionNode): AssistantMentionNode {
    return $createAssistantMentionNode({
      kind: serializedNode.kind,
      mode: serializedNode.mode,
      targetId: serializedNode.targetId,
      label: serializedNode.label,
    }).updateFromJSON(serializedNode);
  }

  constructor(
    kind: AssistantMentionKind,
    mode: AssistantMentionMode,
    targetId: string,
    label: string,
    key?: NodeKey,
  ) {
    super(key);
    this.__kind = kind;
    this.__mode = mode;
    this.__targetId = targetId;
    this.__label = label;
  }

  override afterCloneFrom(prevNode: this): void {
    super.afterCloneFrom(prevNode);
    this.__kind = prevNode.__kind;
    this.__mode = prevNode.__mode;
    this.__targetId = prevNode.__targetId;
    this.__label = prevNode.__label;
  }

  override exportJSON(): SerializedAssistantMentionNode {
    return {
      ...super.exportJSON(),
      kind: this.__kind,
      mode: this.__mode,
      targetId: this.__targetId,
      label: this.__label,
    };
  }

  override updateFromJSON(serializedNode: LexicalUpdateJSON<SerializedAssistantMentionNode>): this {
    return super.updateFromJSON(serializedNode).setMention({
      kind: serializedNode.kind,
      mode: serializedNode.mode,
      targetId: serializedNode.targetId,
      label: serializedNode.label,
    });
  }

  override createDOM(): HTMLElement {
    const element = document.createElement("span");
    element.className = "inline-block align-baseline";
    return element;
  }

  override updateDOM(): false {
    return false;
  }

  override decorate(): ReactNode {
    return (
      <span
        className="inline-flex max-w-44 items-center gap-1 rounded-sm border border-accent-foreground/45 bg-accent-background/35 px-1.5 py-0.5 text-[12px] leading-4 text-accent-foreground"
        data-assistant-mention-kind={this.__kind}
        data-assistant-mention-target-id={this.__targetId}
      >
        <span className="icon-[material-symbols--prompt-suggestion] shrink-0 text-sm" />
        <span className="truncate">@{this.__label}</span>
      </span>
    );
  }

  override getTextContent(): string {
    return "";
  }

  override isInline(): true {
    return true;
  }

  override isKeyboardSelectable(): true {
    return true;
  }

  setMention(mention: AssistantMentionInput): this {
    const self = this.getWritable();
    self.__kind = mention.kind;
    self.__mode = mention.mode;
    self.__targetId = mention.targetId;
    self.__label = mention.label;
    return self;
  }

  getMention(): AssistantMentionInput {
    const latest = this.getLatest();
    return {
      kind: latest.__kind,
      mode: latest.__mode,
      targetId: latest.__targetId,
      label: latest.__label,
    };
  }
}

export function $createAssistantMentionNode(mention: AssistantMentionInput): AssistantMentionNode {
  return new AssistantMentionNode(mention.kind, mention.mode, mention.targetId, mention.label);
}

export function $isAssistantMentionNode(
  node: LexicalNode | null | undefined,
): node is AssistantMentionNode {
  return node instanceof AssistantMentionNode;
}

export function AssistantComposer({
  disabled,
  placeholder,
  onSubmit,
  onTextChange,
  isBusy,
  initialValue,
}: {
  disabled: boolean;
  placeholder: string;
  onSubmit: (_payload: AssistantComposerSubmitPayload) => boolean;
  onTextChange?: (_text: string) => void;
  isBusy: boolean;
  initialValue?: string;
}) {
  const initialValueRef = useRef(initialValue ?? "");
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
}: {
  disabled: boolean;
  isBusy: boolean;
  placeholder: string;
  onSubmit: (_payload: AssistantComposerSubmitPayload) => boolean;
  onTextChange?: (_text: string) => void;
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
              <div className="pointer-events-none absolute top-2 left-2.5 text-[13px] leading-5 text-foreground-muted/70">
                {placeholder}
              </div>
            }
            spellCheck={false}
            className="field-sizing-content max-h-48 min-h-5 w-full overflow-y-auto border-none bg-transparent px-2.5 pt-2 text-[13px] leading-5 break-words whitespace-pre-wrap text-editor-foreground outline-none"
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
          onTextChange?.(compileAssistantComposerState(editorState).text);
        }}
      />
      <AssistantPromptTypeaheadPlugin onOpenChange={setTypeaheadOpen} disabled={disabled} />
    </div>
  );
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
            <ul className="max-h-72 overflow-y-auto py-0.5" role="listbox">
              {menuOptions.map((option, index) => (
                <li
                  key={option.key}
                  ref={option.setRefElement}
                  id={`typeahead-item-${index}`}
                  role="option"
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
                  <span className="mt-0.5 icon-[material-symbols--prompt-suggestion] shrink-0 text-base text-accent-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{option.prompt.name}</span>
                    {option.prompt.description ? (
                      <span className="mt-0.5 line-clamp-2 block text-[11px] leading-4 text-foreground-muted">
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

export function compileAssistantComposerState(
  editorState: EditorState,
): AssistantComposerSubmitPayload {
  let text = "";
  editorState.read(() => {
    text = $getRoot().getTextContent();
  });

  return {
    text,
    mentions: [],
  };
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

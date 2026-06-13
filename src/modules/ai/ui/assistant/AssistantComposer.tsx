import { useCallback, useEffect, useMemo, useRef } from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  type EditorState,
  type LexicalEditor,
} from "lexical";

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
              if (event.key !== "Enter" || event.shiftKey || composingRef.current) {
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
    </div>
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

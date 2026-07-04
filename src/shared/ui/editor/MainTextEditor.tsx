import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import CodeMirror, { type ReactCodeMirrorProps } from "@uiw/react-codemirror";

import { cn } from "@/shared/lib/cn";

export type MainTextEditorVariant = "content" | "aux";

export const MAIN_TEXT_EDITOR_BASIC_SETUP: NonNullable<ReactCodeMirrorProps["basicSetup"]> = {
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
  rectangularSelection: true,
  crosshairCursor: false,
  highlightActiveLine: true,
  highlightSelectionMatches: true,
  closeBracketsKeymap: false,
  searchKeymap: true,
  foldKeymap: false,
  completionKeymap: false,
  lintKeymap: false,
  tabSize: 2,
};

export const MAIN_TEXT_EDITOR_MARKDOWN_HIGHLIGHT_STYLE = HighlightStyle.define([
  {
    tag: [tags.heading, tags.heading1, tags.heading2, tags.heading3, tags.heading4],
    color: "#f0d7a1",
    fontWeight: "700",
  },
  {
    tag: [tags.heading5, tags.heading6],
    color: "#e6c989",
    fontWeight: "650",
  },
  {
    tag: tags.contentSeparator,
    color: "#7a8b99",
  },
  {
    tag: [tags.strong, tags.emphasis],
    color: "#f3c0d6",
    fontWeight: "700",
  },
  {
    tag: [tags.link, tags.url],
    color: "#8fc7ff",
    textDecoration: "underline",
    textUnderlineOffset: "2px",
  },
  {
    tag: [tags.monospace, tags.strikethrough],
    color: "#9cdcfe",
  },
  {
    tag: [tags.list, tags.quote],
    color: "#b9d88a",
    fontWeight: "600",
  },
  {
    tag: tags.punctuation,
    color: "#8d9aa3",
  },
]);

export const MAIN_TEXT_EDITOR_MARKDOWN_EXTENSIONS = [
  markdown(),
  syntaxHighlighting(MAIN_TEXT_EDITOR_MARKDOWN_HIGHLIGHT_STYLE),
];

export const MAIN_TEXT_EDITOR_EXTENSIONS = [
  ...MAIN_TEXT_EDITOR_MARKDOWN_EXTENSIONS,
  EditorView.lineWrapping,
  EditorView.theme(
    {
      "&": {
        height: "100%",
      },
      ".cm-scroller": {
        overflow: "auto",
      },
      ".cm-content": {
        minHeight: "100%",
        paddingBottom: "45vh",
      },
    },
    { dark: true },
  ),
];

export function getMainTextEditorAriaLabel(variant: MainTextEditorVariant): string {
  return variant === "content" ? "正文编辑器" : "辅助文件编辑器";
}

export function MainTextEditor({
  value,
  onChange,
  placeholder,
  readOnly = false,
  variant,
  className,
}: {
  value: string;
  onChange: (_value: string) => void;
  placeholder: string;
  readOnly?: boolean;
  variant: MainTextEditorVariant;
  className?: string;
}) {
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      readOnly={readOnly}
      editable={!readOnly}
      indentWithTab={false}
      basicSetup={MAIN_TEXT_EDITOR_BASIC_SETUP}
      extensions={MAIN_TEXT_EDITOR_EXTENSIONS}
      theme="none"
      height="100%"
      aria-label={getMainTextEditorAriaLabel(variant)}
      className={cn("main-text-editor min-h-0 flex-1", `main-text-editor--${variant}`, className)}
    />
  );
}

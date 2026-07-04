import { expect, test } from "bun:test";
import { LanguageSupport } from "@codemirror/language";
import { renderToStaticMarkup } from "react-dom/server";

import {
  getMainTextEditorAriaLabel,
  MAIN_TEXT_EDITOR_BASIC_SETUP,
  MAIN_TEXT_EDITOR_EXTENSIONS,
  MAIN_TEXT_EDITOR_MARKDOWN_EXTENSIONS,
  MainTextEditor,
} from "./MainTextEditor";

test("MainTextEditor renders a stable wrapper for the content variant", () => {
  const html = renderToStaticMarkup(
    <MainTextEditor
      value="第一行"
      onChange={() => {}}
      placeholder="开始写作..."
      variant="content"
    />,
  );

  expect(html).toContain("main-text-editor");
  expect(html).toContain("main-text-editor--content");
  expect(html).toContain('aria-label="正文编辑器"');
});

test("MainTextEditor basic setup enables line numbers and search without code-centric extras", () => {
  expect(MAIN_TEXT_EDITOR_BASIC_SETUP).toMatchObject({
    lineNumbers: true,
    highlightActiveLineGutter: true,
    history: true,
    searchKeymap: true,
    allowMultipleSelections: true,
    rectangularSelection: true,
    highlightActiveLine: true,
    foldGutter: false,
    autocompletion: false,
    syntaxHighlighting: true,
  });
});

test("MainTextEditor includes markdown highlighting", () => {
  expect(MAIN_TEXT_EDITOR_MARKDOWN_EXTENSIONS[0]).toBeInstanceOf(LanguageSupport);
  expect(MAIN_TEXT_EDITOR_MARKDOWN_EXTENSIONS).toHaveLength(2);
  expect(MAIN_TEXT_EDITOR_EXTENSIONS.slice(0, 2)).toEqual(MAIN_TEXT_EDITOR_MARKDOWN_EXTENSIONS);
});

test("getMainTextEditorAriaLabel maps variants to localized labels", () => {
  expect(getMainTextEditorAriaLabel("content")).toBe("正文编辑器");
  expect(getMainTextEditorAriaLabel("aux")).toBe("辅助文件编辑器");
});

import { $createParagraphNode, $createTextNode, $getRoot, createEditor } from "lexical";
import { expect, test } from "vitest";

import {
  $createAssistantMentionNode,
  AssistantMentionNode,
  compileAssistantComposerState,
} from "./assistantComposerModel";

test("compileAssistantComposerState collects mentions without adding labels to text", () => {
  const editor = createEditor({
    namespace: "AssistantComposerTest",
    nodes: [AssistantMentionNode],
    onError(error) {
      throw error;
    },
  });

  editor.update(
    () => {
      const root = $getRoot();
      root.clear();

      const first = $createParagraphNode();
      first.append(
        $createAssistantMentionNode({
          kind: "global-prompt",
          mode: "snapshot-ref",
          targetId: "prompt_expand",
          label: "章节扩写",
        }),
        $createTextNode(" 请扩写这一段"),
      );

      const second = $createParagraphNode();
      second.append($createTextNode("保持视角一致"));

      root.append(first, second);
    },
    { discrete: true },
  );

  expect(compileAssistantComposerState(editor.getEditorState())).toEqual({
    text: " 请扩写这一段\n保持视角一致",
    mentions: [
      {
        kind: "global-prompt",
        mode: "snapshot-ref",
        targetId: "prompt_expand",
        label: "章节扩写",
      },
    ],
  });
});

test("compileAssistantComposerState preserves paragraph spacing and mention order", () => {
  const editor = createEditor({
    namespace: "AssistantComposerSpacingTest",
    nodes: [AssistantMentionNode],
    onError(error) {
      throw error;
    },
  });

  editor.update(
    () => {
      const root = $getRoot();
      root.clear();

      const first = $createParagraphNode();
      first.append(
        $createTextNode("前缀 "),
        $createAssistantMentionNode({
          kind: "global-prompt",
          mode: "snapshot-ref",
          targetId: "prompt_a",
          label: "Prompt A",
        }),
        $createTextNode(" 中间 "),
        $createAssistantMentionNode({
          kind: "global-prompt",
          mode: "snapshot-ref",
          targetId: "prompt_b",
          label: "Prompt B",
        }),
        $createTextNode(" 后缀"),
      );

      const empty = $createParagraphNode();
      const third = $createParagraphNode();
      third.append($createTextNode("下一段"));

      root.append(first, empty, third);
    },
    { discrete: true },
  );

  expect(compileAssistantComposerState(editor.getEditorState())).toEqual({
    text: "前缀  中间  后缀\n\n下一段",
    mentions: [
      {
        kind: "global-prompt",
        mode: "snapshot-ref",
        targetId: "prompt_a",
        label: "Prompt A",
      },
      {
        kind: "global-prompt",
        mode: "snapshot-ref",
        targetId: "prompt_b",
        label: "Prompt B",
      },
    ],
  });
});

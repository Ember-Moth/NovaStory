import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import type { AuxTreeNodeVM, ContentTreeNodeVM } from "@/modules/workspace/ui/editor/model/types";

import { EditorArea } from "./EditorArea";

function createAuxNode(overrides: Partial<AuxTreeNodeVM> = {}): AuxTreeNodeVM {
  return {
    id: "/索引/角色入口",
    nodeType: "symlink",
    name: "角色入口",
    content: "",
    path: "/索引/角色入口",
    symlinkTargetPath: "/设定/角色.md",
    hasTimelineChange: false,
    children: [],
    ...overrides,
  };
}

function createContentNode(overrides: Partial<ContentTreeNodeVM> = {}): ContentTreeNodeVM {
  return {
    id: "chapter_1",
    title: "第一章",
    body: "# 开场",
    anchorTimelinePointId: "origin",
    children: [],
    ...overrides,
  };
}

test("EditorArea shows preview toggle for content editing", () => {
  const html = renderToStaticMarkup(
    <EditorArea
      target="content"
      contentNode={createContentNode()}
      auxNode={null}
      body="# 开场"
      auxContent=""
      timelineLabel="原点"
      contentSaveState={{ isSaving: false, isDirty: false, error: null }}
      auxSaveState={{ isSaving: false, isDirty: false, error: null }}
      auxPending={false}
      isAuxSymlinkTargetPickerActive={false}
      onBodyChange={() => {}}
      onAuxContentChange={() => {}}
    />,
  );

  expect(html).toContain('role="switch"');
  expect(html).toContain("预览");
});

test("EditorArea keeps symlink placeholder text in normal mode", () => {
  const html = renderToStaticMarkup(
    <EditorArea
      target="aux"
      contentNode={null}
      auxNode={createAuxNode()}
      body=""
      auxContent=""
      timelineLabel="原点"
      contentSaveState={{ isSaving: false, isDirty: false, error: null }}
      auxSaveState={{ isSaving: false, isDirty: false, error: null }}
      auxPending={false}
      isAuxSymlinkTargetPickerActive={false}
      onBodyChange={() => {}}
      onAuxContentChange={() => {}}
    />,
  );

  expect(html).toContain("符号链接，请打开目标文件进行编辑");
});

test("EditorArea switches symlink placeholder while target picker is active", () => {
  const html = renderToStaticMarkup(
    <EditorArea
      target="aux"
      contentNode={null}
      auxNode={createAuxNode()}
      body=""
      auxContent=""
      timelineLabel="原点"
      contentSaveState={{ isSaving: false, isDirty: false, error: null }}
      auxSaveState={{ isSaving: false, isDirty: false, error: null }}
      auxPending={false}
      isAuxSymlinkTargetPickerActive
      onBodyChange={() => {}}
      onAuxContentChange={() => {}}
    />,
  );

  expect(html).toContain("正在选择新的符号链接目标");
});

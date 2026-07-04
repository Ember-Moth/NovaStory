import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { WorkspaceMarkdownPreview } from "./WorkspaceMarkdownPreview";

test("WorkspaceMarkdownPreview renders markdown content", () => {
  const html = renderToStaticMarkup(
    <WorkspaceMarkdownPreview
      content={"# 标题\n\n- 条目\n\n| A | B |\n| - | - |\n| 1 | 2 |"}
      emptyLabel="暂无内容"
    />,
  );

  expect(html).toContain('data-streamdown="heading-1"');
  expect(html).toContain('data-streamdown="unordered-list"');
  expect(html).toContain('data-streamdown="table-wrapper"');
  expect(html).toContain('data-simplebar="init"');
  expect(html).toContain("ai-table-scrollbar");
});

test("WorkspaceMarkdownPreview renders empty state", () => {
  const html = renderToStaticMarkup(
    <WorkspaceMarkdownPreview content="   " emptyLabel="暂无内容" />,
  );

  expect(html).toContain("暂无内容");
});

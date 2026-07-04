import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { AiMarkdown } from "./AiMarkdown";

test("AiMarkdown renders markdown structures for assistant content", () => {
  const html = renderToStaticMarkup(
    <AiMarkdown
      content={"# 标题\n\n- 列表项\n\n| A | B |\n| - | - |\n| 1 | 2 |"}
      isStreaming={false}
      variant="assistant"
    />,
  );

  expect(html).toContain('data-streamdown="heading-1"');
  expect(html).toContain('data-streamdown="unordered-list"');
  expect(html).toContain('data-streamdown="table-wrapper"');
  expect(html).toContain('data-simplebar="init"');
  expect(html).toContain("ai-table-scrollbar");
});

test("AiMarkdown renders sidebar tables as stacked cards when requested", () => {
  const html = renderToStaticMarkup(
    <AiMarkdown
      content={
        "| 工具 | 功能 | 结果 |\n| - | - | - |\n| `create_manuscript_node` | 创建顶层章节 | 已创建，保留 **正文** |"
      }
      isStreaming={false}
      tableLayout="sidebar-cards"
      variant="assistant"
    />,
  );

  expect(html).toContain('data-ai-sidebar-table="root"');
  expect(html).toContain('data-ai-sidebar-table="row"');
  expect(html).toContain(">工具<");
  expect(html).toContain(">功能<");
  expect(html).toContain(">结果<");
  expect(html).toContain("create_manuscript_node");
  expect(html).toContain("创建顶层章节");
  expect(html).toContain("已创建，保留");
});

test("AiMarkdown tolerates incomplete fenced code blocks while streaming", () => {
  const render = () =>
    renderToStaticMarkup(
      <AiMarkdown content={"```ts\nconst x = 1"} isStreaming variant="assistant" />,
    );

  expect(render).not.toThrow();
  expect(render()).toContain('data-streamdown="code-block"');
});

test("AiMarkdown enables streamdown text animation while streaming", () => {
  const html = renderToStaticMarkup(
    <AiMarkdown content="alpha beta gamma" isStreaming variant="assistant" />,
  );

  expect(html).toContain("data-sd-animate");
});

test("AiMarkdown escapes raw html and blocks unsafe links and images", () => {
  const html = renderToStaticMarkup(
    <AiMarkdown
      content={
        "before <script>alert(1)</script> after [ok](https://a.com) [bad](javascript:alert(1)) ![img](https://a.com/x.png)"
      }
      isStreaming={false}
      variant="assistant"
    />,
  );

  expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  expect(html).toContain('data-streamdown="link"');
  expect(html).toContain(">bad</span>");
  expect(html).not.toContain("<img");
});

import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

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

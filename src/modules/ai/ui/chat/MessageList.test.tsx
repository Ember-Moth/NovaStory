import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import { MessageList } from "./MessageList";

test("MessageList uses sidebar card tables for assistant markdown in chat", () => {
  const html = renderToStaticMarkup(
    <MessageList
      messages={[
        {
          id: "assistant_1",
          role: "assistant",
          parts: [
            {
              type: "text",
              text: "| 工具 | 结果 |\n| - | - |\n| `create_manuscript_node` | 已创建节点 |",
              state: "done",
            },
          ],
        } as any,
      ]}
      allMessages={[]}
      candidateGroups={[]}
      isStreaming={false}
      onSelectBranch={() => {}}
      onSubmitAskUser={() => {}}
    />,
  );

  expect(html).toContain('data-ai-sidebar-table="root"');
  expect(html).toContain("create_manuscript_node");
  expect(html).toContain("已创建节点");
});

test("MessageList renders structured tool cards in chat", () => {
  const html = renderToStaticMarkup(
    <MessageList
      messages={[
        {
          id: "assistant_1",
          role: "assistant",
          parts: [
            {
              type: "tool-list_story_timeline_points",
              state: "output-available",
              input: {},
              output: {
                ok: true,
                truncated: false,
                data: {
                  points: [
                    {
                      id: "origin",
                      label: "原点",
                      description: null,
                      prevPointId: null,
                      isImplicitOrigin: true,
                      auxChangeSummary: {
                        hasChanges: false,
                        added: 0,
                        modified: 0,
                        deleted: 0,
                        total: 0,
                      },
                    },
                  ],
                },
              },
            },
          ],
        } as any,
      ]}
      allMessages={[]}
      candidateGroups={[]}
      isStreaming={false}
      onSelectBranch={() => {}}
      onSubmitAskUser={() => {}}
    />,
  );

  expect(html).toContain('data-ai-tool-trace="section"');
  expect(html).toContain("时间点");
  expect(html).toContain("原点");
  expect(html).toContain("原始数据");
});

test("MessageList keeps ask_user card mounted while tool input is streaming", () => {
  const html = renderToStaticMarkup(
    <MessageList
      messages={[
        {
          id: "assistant_streaming_ask",
          role: "assistant",
          parts: [
            {
              type: "dynamic-tool",
              toolName: "ask_user",
              toolCallId: "tool_ask_stream",
              state: "input-streaming",
              input: {
                title: "补充设定",
                questions: [
                  {
                    id: "genre",
                    prompt: "故事更接近哪种风格？",
                    kind: "single_choice",
                    options: [{ id: "xuanhuan" }],
                  },
                ],
              },
            },
          ],
        } as any,
      ]}
      allMessages={[]}
      candidateGroups={[]}
      isStreaming
      onSelectBranch={() => {}}
      onSubmitAskUser={() => {}}
    />,
  );

  expect(html).toContain("补充设定");
  expect(html).toContain("故事更接近哪种风格？");
  expect(html).toContain("生成中");
});

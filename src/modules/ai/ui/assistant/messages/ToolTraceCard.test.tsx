import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ToolTraceCard } from "./ToolTraceCard";

test("ToolTraceCard renders structured manuscript read details", () => {
  const html = renderToStaticMarkup(
    <ToolTraceCard
      expanded
      onToggle={() => {}}
      entry={{
        toolCallId: "tool_1",
        toolName: "read_manuscript_node",
        status: "success",
        summary: "读取正文 第一章",
        nodeId: "assistant_1",
        runId: "run_1",
        requestPayload: { nodeId: "node_1" },
        responsePayload: {
          ok: true,
          truncated: false,
          data: {
            node: {
              id: "node_1",
              title: "第一章",
              anchorTimelinePointId: "origin",
              body: "这里是正文内容。",
              children: [
                {
                  id: "node_2",
                  title: "第一节",
                  anchorTimelinePointId: "origin",
                  children: [],
                },
              ],
            },
          },
        },
        streamingInputTextRaw: null,
        streamingRequestPayload: null,
      }}
    />,
  );

  expect(html).toContain('data-ai-tool-trace="section"');
  expect(html).toContain("第一章");
  expect(html).toContain("正文预览");
  expect(html).toContain("直接子章节");
  expect(html).toContain("原始数据");
});

test("ToolTraceCard renders timeline list as structured rows", () => {
  const html = renderToStaticMarkup(
    <ToolTraceCard
      expanded
      onToggle={() => {}}
      entry={{
        toolCallId: "tool_2",
        toolName: "list_story_timeline_points",
        status: "success",
        summary: "查看故事时间线",
        nodeId: "assistant_1",
        runId: "run_1",
        requestPayload: {},
        responsePayload: {
          ok: true,
          truncated: false,
          data: {
            points: [
              {
                id: "origin",
                label: "原点",
                description: "初始设定",
                auxChangeSummary: {
                  added: 0,
                  modified: 0,
                  deleted: 0,
                  total: 0,
                },
              },
              {
                id: "point_1",
                label: "大战前",
                description: "局势紧张",
                auxChangeSummary: {
                  added: 2,
                  modified: 1,
                  deleted: 0,
                  total: 3,
                },
              },
            ],
          },
        },
        streamingInputTextRaw: null,
        streamingRequestPayload: null,
      }}
    />,
  );

  expect(html).toContain("时间点");
  expect(html).toContain("大战前");
  expect(html).toContain("point_1");
  expect(html).toContain("新增 2 / 修改 1 / 删除 0 / 共 3");
  expect(html).not.toContain("截断");
});

test("ToolTraceCard only renders truncated row when response is truncated", () => {
  const truncatedHtml = renderToStaticMarkup(
    <ToolTraceCard
      expanded
      onToggle={() => {}}
      entry={{
        toolCallId: "tool_2_truncated",
        toolName: "list_story_timeline_points",
        status: "success",
        summary: "查看故事时间线",
        nodeId: "assistant_1",
        runId: "run_1",
        requestPayload: {},
        responsePayload: {
          ok: true,
          truncated: true,
          data: {
            points: [],
          },
        },
        streamingInputTextRaw: null,
        streamingRequestPayload: null,
      }}
    />,
  );

  expect(truncatedHtml).toContain("截断");
  expect(truncatedHtml).toContain("是");
});

test("ToolTraceCard truncates write_file request content by default", () => {
  const longContent = Array.from({ length: 12 }, (_, index) => `第 ${index + 1} 行`).join("\n");
  const html = renderToStaticMarkup(
    <ToolTraceCard
      expanded
      onToggle={() => {}}
      entry={{
        toolCallId: "tool_3",
        toolName: "write_file",
        status: "pending",
        summary: "写入辅助信息 /角色/主角.md",
        nodeId: "assistant_1",
        runId: "run_1",
        requestPayload: {
          path: "/角色/主角.md",
          content: longContent,
        },
        responsePayload: null,
        streamingInputTextRaw: null,
        streamingRequestPayload: null,
      }}
    />,
  );

  expect(html).toContain("/角色/主角.md");
  expect(html).toContain("内容预览");
  expect(html).toContain("12 行");
  expect(html).toContain("展开完整内容");
  expect(html).toContain("原始数据");
});

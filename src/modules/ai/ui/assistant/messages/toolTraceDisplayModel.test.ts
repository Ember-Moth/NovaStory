import { expect, test } from "vitest";

import {
  buildAssistantToolTraceDisplayModel,
  hasAssistantToolTraceSectionContent,
} from "./toolTraceDisplayModel";
import { parseAssistantToolStreamingInput } from "./toolTraceModel";

test("parseAssistantToolStreamingInput extracts partial write_file payload", () => {
  const parsed = parseAssistantToolStreamingInput(
    '{"path":"/角色/主角.md","content":"第一行\\n第二行',
  );

  expect(parsed).toEqual({
    path: "/角色/主角.md",
    content: "第一行\n第二行",
  });

  const display = buildAssistantToolTraceDisplayModel({
    toolName: "write_file",
    requestPayload: null,
    responsePayload: null,
    streamingRequestPayload: parsed,
  });

  expect(display.request?.summaryRows).toContainEqual({
    label: "路径",
    value: "/角色/主角.md",
  });
  expect(display.request?.contentPreviews[0]?.preview).toContain("第一行");
});

test("tool trace display prefers final request payload over partial streaming payload", () => {
  const display = buildAssistantToolTraceDisplayModel({
    toolName: "write_file",
    requestPayload: {
      path: "/角色/主角.md",
      content: "完整正文",
    },
    responsePayload: null,
    streamingRequestPayload: {
      path: "/旧路径.md",
      content: "旧内容",
    },
  });

  expect(display.request?.summaryRows).toContainEqual({
    label: "路径",
    value: "/角色/主角.md",
  });
  expect(display.request?.contentPreviews[0]?.fullContent).toBe("完整正文");
});

test("tool trace display promotes envelope errors into structured response", () => {
  const display = buildAssistantToolTraceDisplayModel({
    toolName: "delete_story_timeline_point",
    requestPayload: {
      pointId: "point_1",
    },
    responsePayload: {
      ok: false,
      error: "无法删除时间点。",
      context: {
        pointId: "point_1",
        purgeAuxLayers: false,
      },
    },
  });

  expect(display.response?.errorMessage).toBe("无法删除时间点。");
  expect(display.response?.errorContextRows).toContainEqual({
    label: "pointId",
    value: "point_1",
  });
});

test("unknown tools fall back to a generic structure tree", () => {
  const display = buildAssistantToolTraceDisplayModel({
    toolName: "custom_tool",
    requestPayload: {
      alpha: "beta",
      nested: {
        count: 2,
      },
    },
    responsePayload: null,
  });

  expect(hasAssistantToolTraceSectionContent(display.request)).toBe(true);
  expect(display.request?.treeGroups[0]?.label).toBe("参数结构");
  expect(display.request?.treeGroups[0]?.nodes[0]?.label).toBe("alpha");
});

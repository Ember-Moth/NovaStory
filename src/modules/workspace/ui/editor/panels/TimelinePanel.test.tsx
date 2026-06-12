import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { TimelinePointVM } from "@/modules/workspace/ui/editor/model/types";

import { TimelinePanel } from "./TimelinePanel";

function createTimelinePoint(
  overrides: Partial<TimelinePointVM> & Pick<TimelinePointVM, "id" | "label">,
) {
  const { id, label, ...rest } = overrides;
  return {
    id,
    label,
    description: "",
    isImplicitOrigin: false,
    ...rest,
  } satisfies TimelinePointVM;
}

test("TimelinePanel keeps native inline editing without custom row gesture hit areas", () => {
  const html = renderToStaticMarkup(
    <TimelinePanel
      points={[createTimelinePoint({ id: "timeline_1", label: "冲突爆发" })]}
      activeId={null}
      isBusy={false}
      onSelect={() => {}}
      onMove={() => {}}
      onDelete={() => {}}
      onRename={async () => true}
    />,
  );

  expect(html).not.toContain('data-inline-edit-hit-area="label"');
  expect(html).not.toContain('aria-label="拖动排序"');
  expect(html).not.toContain("drag-indicator");
});

test("TimelinePanel renders point descriptions as a second line instead of trailing badge", () => {
  const html = renderToStaticMarkup(
    <TimelinePanel
      points={[
        createTimelinePoint({
          id: "timeline_1",
          label: "冲突爆发",
          description: "主角第一次公开违抗命令",
        }),
      ]}
      activeId={null}
      isBusy={false}
      onSelect={() => {}}
      onMove={() => {}}
      onDelete={() => {}}
      onRename={async () => true}
    />,
  );

  expect(html).toContain("主角第一次公开违抗命令");
  expect(html).toContain("grid-rows-[auto_auto]");
  expect(html).toContain("row-start-2");
  expect(html).not.toContain("max-w-20");
});

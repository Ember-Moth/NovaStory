import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { ContentTreeNodeVM } from "@/modules/workspace/ui/editor/model/types";

import { ContentTreePanel } from "./ContentTreePanel";

function createContentNode(
  overrides: Partial<ContentTreeNodeVM> & Pick<ContentTreeNodeVM, "id" | "title">,
) {
  const { id, title, ...rest } = overrides;
  return {
    id,
    title,
    body: "",
    anchorTimelinePointId: "origin",
    children: [],
    ...rest,
  } satisfies ContentTreeNodeVM;
}

test("ContentTreePanel marks the label hit area and keeps drag handles", () => {
  const html = renderToStaticMarkup(
    <ContentTreePanel
      tree={[createContentNode({ id: "content_1", title: "第一章" })]}
      expandedIds={new Set()}
      onToggle={() => {}}
      onSelect={() => {}}
      onRename={async () => true}
      onCreateChild={() => {}}
      onDelete={() => {}}
      onMove={() => {}}
      activeId={null}
      timelineLabelMap={new Map([["origin", "原点"]])}
      isBusy={false}
      isPending={false}
      canCreate
    />,
  );

  expect(html).toContain('data-inline-edit-hit-area="label"');
  expect(html).toContain('data-drag-handle="content_1"');
});

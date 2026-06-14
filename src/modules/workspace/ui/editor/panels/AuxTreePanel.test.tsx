import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import type { AuxTreeNodeVM } from "@/modules/workspace/ui/editor/model/types";

import { AuxTreePanel } from "./AuxTreePanel";

function createAuxNode(overrides: Partial<AuxTreeNodeVM> & Pick<AuxTreeNodeVM, "id" | "name">) {
  const { id, name, ...rest } = overrides;
  return {
    id,
    nodeType: "file",
    name,
    content: "",
    path: id,
    symlinkTargetPath: null,
    hasTimelineChange: false,
    children: [],
    ...rest,
  } satisfies AuxTreeNodeVM;
}

const inactiveSymlinkTargetPicker = {
  active: false,
  sourceNodeId: null,
  selectedTargetNodeId: null,
  invalidTargetNodeIds: new Set<string>(),
  onPickTarget: () => {},
};

test("AuxTreePanel renders create-symlink actions for visible entries", () => {
  const html = renderToStaticMarkup(
    <AuxTreePanel
      tree={[
        createAuxNode({ id: "/设定", name: "设定", nodeType: "dir" }),
        createAuxNode({ id: "/notes.md", name: "notes.md" }),
        createAuxNode({
          id: "/索引/角色入口",
          name: "角色入口",
          nodeType: "symlink",
          symlinkTargetPath: "/设定/角色.md",
        }),
      ]}
      rootId="/"
      expandedIds={new Set()}
      onToggle={() => {}}
      activeId={null}
      onSelect={() => {}}
      onRename={async () => true}
      onCreateChildDir={() => {}}
      onCreateChildFile={() => {}}
      onCreateSymlink={() => {}}
      onStartRetargetSymlink={() => {}}
      onMove={() => {}}
      onDelete={() => {}}
      onRestoreDeleted={() => {}}
      symlinkTargetPicker={inactiveSymlinkTargetPicker}
      isBusy={false}
      isPending={false}
      showTimelineChanges={false}
    />,
  );

  expect(html).toContain('data-action-anchor="aux:create-symlink:/设定"');
  expect(html).toContain('data-action-anchor="aux:create-symlink:/notes.md"');
  expect(html).toContain('data-action-anchor="aux:create-symlink:/索引/角色入口"');
  expect(html).toContain('data-action-anchor="aux:retarget-symlink:/索引/角色入口"');
  expect(html).not.toContain('data-action-anchor="aux:retarget-symlink:/notes.md"');
});

test("AuxTreePanel exposes drag handles for visible entries", () => {
  const html = renderToStaticMarkup(
    <AuxTreePanel
      tree={[
        createAuxNode({ id: "/设定", name: "设定", nodeType: "dir" }),
        createAuxNode({ id: "/notes.md", name: "notes.md" }),
      ]}
      rootId="/"
      expandedIds={new Set()}
      onToggle={() => {}}
      activeId={null}
      onSelect={() => {}}
      onRename={async () => true}
      onCreateChildDir={() => {}}
      onCreateChildFile={() => {}}
      onCreateSymlink={() => {}}
      onStartRetargetSymlink={() => {}}
      onMove={() => {}}
      onDelete={() => {}}
      onRestoreDeleted={() => {}}
      symlinkTargetPicker={inactiveSymlinkTargetPicker}
      isBusy={false}
      isPending={false}
      showTimelineChanges={false}
    />,
  );

  expect(html).toContain('data-drag-handle="/设定"');
  expect(html).toContain('data-drag-handle="/notes.md"');
  expect(html).toContain('data-inline-edit-hit-area="label"');
});

test("AuxTreePanel hides row actions and marks target picker states while retargeting", () => {
  const html = renderToStaticMarkup(
    <AuxTreePanel
      tree={[
        createAuxNode({
          id: "/索引/角色入口",
          name: "角色入口",
          nodeType: "symlink",
          symlinkTargetPath: "/设定/角色.md",
        }),
        createAuxNode({ id: "/设定/角色.md", name: "角色.md" }),
        createAuxNode({
          id: "/索引/循环入口",
          name: "循环入口",
          nodeType: "symlink",
          symlinkTargetPath: "/角色入口",
        }),
      ]}
      rootId="/"
      expandedIds={new Set()}
      onToggle={() => {}}
      activeId="/索引/角色入口"
      onSelect={() => {}}
      onRename={async () => true}
      onCreateChildDir={() => {}}
      onCreateChildFile={() => {}}
      onCreateSymlink={() => {}}
      onStartRetargetSymlink={() => {}}
      onMove={() => {}}
      onDelete={() => {}}
      onRestoreDeleted={() => {}}
      symlinkTargetPicker={{
        active: true,
        sourceNodeId: "/索引/角色入口",
        selectedTargetNodeId: "/设定/角色.md",
        invalidTargetNodeIds: new Set(["/索引/角色入口", "/索引/循环入口"]),
        onPickTarget: () => {},
      }}
      isBusy={false}
      isPending={false}
      showTimelineChanges={false}
    />,
  );

  expect(html).not.toContain('data-action-anchor="aux:create-symlink:/索引/角色入口"');
  expect(html).not.toContain('data-action-anchor="aux:retarget-symlink:/索引/角色入口"');
  expect(html).toContain('data-symlink-target-picker-state="source"');
  expect(html).toContain('data-symlink-target-picker-state="selected-target"');
  expect(html).toContain('data-symlink-target-picker-state="disabled-target"');
  expect(html).not.toContain('data-drag-handle="/索引/角色入口"');
});

test("AuxTreePanel renders deleted rows as restore-only tombstones", () => {
  const html = renderToStaticMarkup(
    <AuxTreePanel
      tree={[
        createAuxNode({
          id: "/旧设定",
          name: "旧设定",
          nodeType: "dir",
          overlayStatus: "deleted",
        }),
      ]}
      rootId="/"
      expandedIds={new Set()}
      onToggle={() => {}}
      activeId={null}
      onSelect={() => {}}
      onRename={async () => true}
      onCreateChildDir={() => {}}
      onCreateChildFile={() => {}}
      onCreateSymlink={() => {}}
      onStartRetargetSymlink={() => {}}
      onMove={() => {}}
      onDelete={() => {}}
      onRestoreDeleted={() => {}}
      symlinkTargetPicker={inactiveSymlinkTargetPicker}
      isBusy={false}
      isPending={false}
      showTimelineChanges={false}
    />,
  );

  expect(html).toContain("text-deleted-foreground/65");
  expect(html).toContain("line-through");
  expect(html).toContain("decoration-deleted-foreground/65");
  expect(html).not.toContain("text-icon-folder");
  expect(html).toContain('data-action-anchor="aux:restore-deleted:/旧设定"');
  expect(html).not.toContain('data-action-anchor="aux:create-symlink:/旧设定"');
  expect(html).not.toContain('data-action-anchor="aux:delete:/旧设定"');
  expect(html).not.toContain('data-drag-handle="/旧设定"');
});

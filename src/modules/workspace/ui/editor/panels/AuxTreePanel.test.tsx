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
    path: `/${name}`,
    symlinkTargetAuxNodeId: null,
    symlinkTargetPath: null,
    hasTimelineChange: false,
    isDeleted: false,
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

test("AuxTreePanel renders create-symlink actions for non-deleted entries only", () => {
  const html = renderToStaticMarkup(
    <AuxTreePanel
      tree={[
        createAuxNode({ id: "dir_1", name: "设定", nodeType: "dir" }),
        createAuxNode({ id: "file_1", name: "notes.md" }),
        createAuxNode({
          id: "symlink_1",
          name: "角色入口",
          nodeType: "symlink",
          symlinkTargetPath: "/设定/角色.md",
        }),
        createAuxNode({ id: "deleted_1", name: "旧资料", isDeleted: true }),
      ]}
      rootId="aux_root"
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
      onRestore={() => {}}
      symlinkTargetPicker={inactiveSymlinkTargetPicker}
      isBusy={false}
      isPending={false}
      showTimelineChanges={false}
    />,
  );

  expect(html).toContain('data-action-anchor="aux:create-symlink:dir_1"');
  expect(html).toContain('data-action-anchor="aux:create-symlink:file_1"');
  expect(html).toContain('data-action-anchor="aux:create-symlink:symlink_1"');
  expect(html).toContain('data-action-anchor="aux:retarget-symlink:symlink_1"');
  expect(html).not.toContain('data-action-anchor="aux:retarget-symlink:file_1"');
  expect(html).not.toContain('data-action-anchor="aux:create-symlink:deleted_1"');
});

test("AuxTreePanel exposes drag handles for non-deleted entries only", () => {
  const html = renderToStaticMarkup(
    <AuxTreePanel
      tree={[
        createAuxNode({ id: "dir_1", name: "设定", nodeType: "dir" }),
        createAuxNode({ id: "file_1", name: "notes.md" }),
        createAuxNode({ id: "deleted_1", name: "旧资料", isDeleted: true }),
      ]}
      rootId="aux_root"
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
      onRestore={() => {}}
      symlinkTargetPicker={inactiveSymlinkTargetPicker}
      isBusy={false}
      isPending={false}
      showTimelineChanges={false}
    />,
  );

  expect(html).toContain('data-drag-handle="dir_1"');
  expect(html).toContain('data-drag-handle="file_1"');
  expect(html).toContain('data-inline-edit-hit-area="label"');
  expect(html).not.toContain('data-drag-handle="deleted_1"');
});

test("AuxTreePanel hides row actions and marks target picker states while retargeting", () => {
  const html = renderToStaticMarkup(
    <AuxTreePanel
      tree={[
        createAuxNode({
          id: "source_link",
          name: "角色入口",
          nodeType: "symlink",
          symlinkTargetAuxNodeId: "current_target",
          symlinkTargetPath: "/设定/角色.md",
        }),
        createAuxNode({ id: "current_target", name: "角色.md" }),
        createAuxNode({
          id: "invalid_link",
          name: "循环入口",
          nodeType: "symlink",
          symlinkTargetAuxNodeId: "source_link",
          symlinkTargetPath: "/角色入口",
        }),
      ]}
      rootId="aux_root"
      expandedIds={new Set()}
      onToggle={() => {}}
      activeId="source_link"
      onSelect={() => {}}
      onRename={async () => true}
      onCreateChildDir={() => {}}
      onCreateChildFile={() => {}}
      onCreateSymlink={() => {}}
      onStartRetargetSymlink={() => {}}
      onMove={() => {}}
      onDelete={() => {}}
      onRestore={() => {}}
      symlinkTargetPicker={{
        active: true,
        sourceNodeId: "source_link",
        selectedTargetNodeId: "current_target",
        invalidTargetNodeIds: new Set(["source_link", "invalid_link"]),
        onPickTarget: () => {},
      }}
      isBusy={false}
      isPending={false}
      showTimelineChanges={false}
    />,
  );

  expect(html).not.toContain('data-action-anchor="aux:create-symlink:source_link"');
  expect(html).not.toContain('data-action-anchor="aux:retarget-symlink:source_link"');
  expect(html).toContain('data-symlink-target-picker-state="source"');
  expect(html).toContain('data-symlink-target-picker-state="selected-target"');
  expect(html).toContain('data-symlink-target-picker-state="disabled-target"');
  expect(html).not.toContain('data-drag-handle="source_link"');
});

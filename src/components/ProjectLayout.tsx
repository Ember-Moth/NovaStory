import React, { useCallback, useState } from "react";

// ============================================================
// Mock data types
// ============================================================

interface MockTimelinePoint {
  id: string;
  key: string;
  label: string;
  description: string;
}

interface MockContentNode {
  id: string;
  title: string;
  body: string;
  anchorTimelinePointId: string;
  children: MockContentNode[];
}

interface MockAuxNode {
  id: string;
  nodeType: "dir" | "file" | "symlink";
  name: string;
  content?: string;
  symlinkTargetPath?: string;
  children?: MockAuxNode[];
}

// ============================================================
// Mock data
// ============================================================

const mockTimelinePoints: MockTimelinePoint[] = [
  { id: "origin", key: "origin", label: "原点", description: "故事初始状态" },
  { id: "beginning", key: "beginning", label: "开端", description: "故事开始" },
  { id: "development", key: "development", label: "发展", description: "情节展开" },
  { id: "climax", key: "climax", label: "高潮", description: "冲突爆发" },
  { id: "ending", key: "ending", label: "结局", description: "故事收束" },
];

const mockContentTree: MockContentNode[] = [
  {
    id: "vol1",
    title: "第一卷：觉醒",
    body: "这是故事的开端。\n\n在平凡与非凡之间，只隔着一道门。\n\n林明即将发现这扇门的存在。",
    anchorTimelinePointId: "beginning",
    children: [
      {
        id: "ch1",
        title: "第一章：平凡的日常",
        body: "林明走在熟悉的校园走廊上，阳光透过窗户洒在地面。\n\n今天是开学的第一天，周围充满了喧闹声。\n\n他习惯性地走向三年二班的教室。",
        anchorTimelinePointId: "origin",
        children: [
          {
            id: "s1",
            title: "教室",
            body: "教室里已经有不少同学到了。\n\n「早上好，林明！」\n\n小美朝他挥了挥手，脸上带着灿烂的笑容。\n\n「早啊。」林明点点头，走向自己的座位。",
            anchorTimelinePointId: "origin",
            children: [],
          },
          {
            id: "s2",
            title: "走廊偶遇",
            body: "课间，林明在走廊上遇到了小美。\n\n「听说了吗？今天会有转学生来。」\n\n小美神秘兮兮地说道。\n\n「转学生？」林明不以为意地应了一声。",
            anchorTimelinePointId: "origin",
            children: [],
          },
        ],
      },
      {
        id: "ch2",
        title: "第二章：异常降临",
        body: "一切都从那个下午开始改变。\n\n图书馆深处传来的异光，打破了校园的平静。\n\n林明意识到，有什么超出常识的事情正在发生。",
        anchorTimelinePointId: "beginning",
        children: [
          {
            id: "s3",
            title: "图书馆的异光",
            body: "图书馆深处，一本古老的书籍正在发出微弱的蓝光。\n\n林明伸手触碰了书页。\n\n瞬间，周围的空气开始扭曲。\n\n他看到了另一个世界。",
            anchorTimelinePointId: "beginning",
            children: [],
          },
        ],
      },
    ],
  },
  {
    id: "vol2",
    title: "第二卷：冲突",
    body: "随着真相逐渐浮现，更大的危机正在逼近。\n\n林明必须做出选择。",
    anchorTimelinePointId: "development",
    children: [
      {
        id: "ch3",
        title: "第三章：对峙",
        body: "林明站在了黑影的面前。\n\n四周是扭曲的空间，仿佛连时间和光线都被吞噬了。\n\n「你终于来了。」黑影发出低沉的声音。",
        anchorTimelinePointId: "development",
        children: [
          {
            id: "s4",
            title: "异空间决战",
            body: "战斗在扭曲的空间中展开。\n\n林明运用新获得的力量，与黑影周旋。\n\n每一击都撕裂着周围的 reality。",
            anchorTimelinePointId: "development",
            children: [],
          },
        ],
      },
    ],
  },
];

// —— Aux Tree state per timeline point ——

const mockAuxTreeOrigin: MockAuxNode[] = [
  {
    id: "root-char",
    nodeType: "dir",
    name: "角色",
    children: [
      {
        id: "char-ming",
        nodeType: "file",
        name: "林明",
        content: "17岁，高中三年级。性格内向但观察力敏锐。",
      },
      { id: "char-mei", nodeType: "file", name: "小美", content: "林明的青梅竹马，开朗活泼。" },
    ],
  },
  {
    id: "root-area",
    nodeType: "dir",
    name: "区域",
    children: [
      {
        id: "area-campus",
        nodeType: "dir",
        name: "校园",
        children: [
          {
            id: "area-classroom",
            nodeType: "file",
            name: "教室",
            content: "三年二班教室，位于教学楼三层。",
          },
          {
            id: "area-library",
            nodeType: "file",
            name: "图书馆",
            content: "学校图书馆，藏书丰富。",
          },
        ],
      },
      {
        id: "area-home",
        nodeType: "file",
        name: "林明的家",
        content: "普通的公寓，位于学校附近。",
      },
    ],
  },
  {
    id: "root-lore",
    nodeType: "dir",
    name: "世界设定",
    children: [
      {
        id: "lore-magic",
        nodeType: "file",
        name: "魔法体系",
        content: "这个世界存在着古老的魔法体系，通过触碰特定古籍可以获得力量。",
      },
    ],
  },
  {
    id: "root-current",
    nodeType: "symlink",
    name: "当前场景位置",
    symlinkTargetPath: "/区域/校园/教室",
  },
];

const mockAuxTreeBeginning: MockAuxNode[] = [
  {
    id: "root-char",
    nodeType: "dir",
    name: "角色",
    children: [
      {
        id: "char-ming",
        nodeType: "file",
        name: "林明",
        content: "17岁，高中三年级。性格内向但观察力敏锐。",
      },
      { id: "char-mei", nodeType: "file", name: "小美", content: "林明的青梅竹马，开朗活泼。" },
    ],
  },
  {
    id: "root-area",
    nodeType: "dir",
    name: "区域",
    children: [
      {
        id: "area-campus",
        nodeType: "dir",
        name: "校园",
        children: [
          {
            id: "area-classroom",
            nodeType: "file",
            name: "教室",
            content: "三年二班教室，位于教学楼三层。",
          },
          {
            id: "area-library",
            nodeType: "file",
            name: "图书馆",
            content: "学校图书馆。一本古书正散发着微弱的蓝光。",
          },
        ],
      },
      {
        id: "area-home",
        nodeType: "file",
        name: "林明的家",
        content: "普通的公寓，位于学校附近。",
      },
    ],
  },
  {
    id: "root-lore",
    nodeType: "dir",
    name: "世界设定",
    children: [
      {
        id: "lore-magic",
        nodeType: "file",
        name: "魔法体系",
        content: "这个世界存在着古老的魔法体系，通过触碰特定古籍可以获得力量。",
      },
    ],
  },
  {
    id: "root-current",
    nodeType: "symlink",
    name: "当前场景位置",
    symlinkTargetPath: "/区域/校园/图书馆",
  },
];

const mockAuxTreeDevelopment: MockAuxNode[] = [
  {
    id: "root-char",
    nodeType: "dir",
    name: "角色",
    children: [
      {
        id: "char-ming",
        nodeType: "file",
        name: "林明",
        content: "已觉醒力量，正在学习控制新获得的能力。",
      },
      {
        id: "char-mei",
        nodeType: "file",
        name: "小美",
        content: "林明的青梅竹马，隐约察觉到了异变。",
      },
      {
        id: "char-shadow",
        nodeType: "file",
        name: "黑影",
        content: "神秘的黑影，似乎与远古的封印有关。",
      },
    ],
  },
  {
    id: "root-area",
    nodeType: "dir",
    name: "区域",
    children: [
      {
        id: "area-home",
        nodeType: "file",
        name: "林明的家",
        content: "普通的公寓，现在成了临时避难所。",
      },
      {
        id: "area-void",
        nodeType: "dir",
        name: "异空间",
        children: [
          {
            id: "area-void-1",
            nodeType: "file",
            name: "扭曲回廊",
            content: "连接现实与异界的扭曲空间。",
          },
        ],
      },
    ],
  },
  {
    id: "root-lore",
    nodeType: "dir",
    name: "世界设定",
    children: [
      {
        id: "lore-magic",
        nodeType: "file",
        name: "魔法体系",
        content: "这个世界存在着古老的魔法体系。黑影似乎是某种古老封印的产物。",
      },
      {
        id: "lore-seal",
        nodeType: "file",
        name: "远古封印",
        content: "远古时期留下的封印，似乎封印着某种强大的存在。",
      },
    ],
  },
  {
    id: "root-current",
    nodeType: "symlink",
    name: "当前场景位置",
    symlinkTargetPath: "/区域/异空间/扭曲回廊",
  },
];

const mockAuxTreeClimax: MockAuxNode[] = [
  {
    id: "root-char",
    nodeType: "dir",
    name: "角色",
    children: [
      {
        id: "char-ming",
        nodeType: "file",
        name: "林明",
        content: "已经完全掌握了力量，正在与黑影进行最终决战。",
      },
      {
        id: "char-shadow",
        nodeType: "file",
        name: "黑影",
        content: "远古封印的解封者，拥有强大的力量。",
      },
    ],
  },
  {
    id: "root-area",
    nodeType: "dir",
    name: "区域",
    children: [
      {
        id: "area-void",
        nodeType: "dir",
        name: "异空间",
        children: [
          {
            id: "area-void-core",
            nodeType: "file",
            name: "核心领域",
            content: "异空间的最深处，也是封印的核心所在。",
          },
        ],
      },
    ],
  },
  {
    id: "root-lore",
    nodeType: "dir",
    name: "世界设定",
    children: [
      {
        id: "lore-seal",
        nodeType: "file",
        name: "远古封印",
        content: "封印正在被彻底打破，世界的命运悬于一线。",
      },
    ],
  },
  {
    id: "root-current",
    nodeType: "symlink",
    name: "当前场景位置",
    symlinkTargetPath: "/区域/异空间/核心领域",
  },
];

const mockAuxTreeEnding: MockAuxNode[] = [
  {
    id: "root-char",
    nodeType: "dir",
    name: "角色",
    children: [
      {
        id: "char-ming",
        nodeType: "file",
        name: "林明",
        content: "经历了这一切后，他变得更加成熟。",
      },
      { id: "char-mei", nodeType: "file", name: "小美", content: "依然陪在林明身边。" },
    ],
  },
  {
    id: "root-area",
    nodeType: "dir",
    name: "区域",
    children: [
      {
        id: "area-campus",
        nodeType: "dir",
        name: "校园",
        children: [
          { id: "area-classroom", nodeType: "file", name: "教室", content: "恢复了往日的平静。" },
        ],
      },
      { id: "area-home", nodeType: "file", name: "林明的家", content: "回到了平凡的日常。" },
    ],
  },
  {
    id: "root-current",
    nodeType: "symlink",
    name: "当前场景位置",
    symlinkTargetPath: "/区域/校园/教室",
  },
];

const auxTreeMap: Record<string, MockAuxNode[] | undefined> = {
  origin: mockAuxTreeOrigin,
  beginning: mockAuxTreeBeginning,
  development: mockAuxTreeDevelopment,
  climax: mockAuxTreeClimax,
  ending: mockAuxTreeEnding,
};

// ============================================================
// Helper: flatten content tree for full-text search / lookup
// ============================================================

function flattenContentNodes(nodes: MockContentNode[]): MockContentNode[] {
  const result: MockContentNode[] = [];
  for (const n of nodes) {
    result.push(n);
    result.push(...flattenContentNodes(n.children));
  }
  return result;
}

// ============================================================
// Icon helpers
// ============================================================

function ContentNodeIcon({ hasBody, hasChildren }: { hasBody: boolean; hasChildren: boolean }) {
  // 仅有内容的叶子节点 / 仅有子树的结构节点 / 混合节点 / 空节点
  const icon =
    !hasBody && !hasChildren
      ? "icon-[material-symbols--circle] text-icon-empty"
      : hasBody && !hasChildren
        ? "icon-[material-symbols--description] text-icon-leaf"
        : !hasBody && hasChildren
          ? "icon-[material-symbols--account-tree] text-icon-folder"
          : "icon-[material-symbols--overview] text-icon-mixed";
  return <span className={`${icon} text-base shrink-0`} />;
}

function AuxNodeIcon({ nodeType }: { nodeType: string }) {
  const iconMap: Record<string, string> = {
    dir: "icon-[material-symbols--folder] text-icon-folder",
    "dir-open": "icon-[material-symbols--folder-open] text-icon-folder",
    file: "icon-[material-symbols--description] text-foreground-muted",
    symlink: "icon-[material-symbols--link] text-accent-foreground",
  };
  return (
    <span
      className={`${iconMap[nodeType] ?? "icon-[material-symbols--description] text-foreground-muted"} text-base shrink-0`}
    />
  );
}

// ============================================================
// SidebarSection – collapsible stacked panel
// ============================================================

function SidebarSection({
  title,
  actions,
  defaultExpanded = true,
  children,
}: {
  title: string;
  actions?: React.ReactNode;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <div className="flex flex-col shrink-0">
      <div
        className="flex items-center gap-1 pl-2 pr-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground-muted hover:text-foreground shrink-0 cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
        role="button"
        tabIndex={0}
      >
        <span
          className={`w-4 shrink-0 text-base ${expanded ? "icon-[material-symbols--keyboard-arrow-down]" : "icon-[material-symbols--keyboard-arrow-right]"}`}
        />

        <span className="truncate">{title}</span>
        {actions && (
          <span className="ml-auto flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            {actions}
          </span>
        )}
      </div>
      {expanded && <div className="overflow-auto">{children}</div>}
    </div>
  );
}

// ============================================================
// ContentTreePanel
// ============================================================

const timelineLabelMap: Record<string, string> = Object.fromEntries(
  mockTimelinePoints.map((p) => [p.id, p.label]),
);

function ContentTreeNodeRow({
  node,
  depth,
  expandedIds,
  onToggle,
  onSelect,
  activeId,
  timelinePointLabel,
}: {
  node: MockContentNode;
  depth: number;
  expandedIds: Set<string>;
  onToggle: (_id: string) => void;
  onSelect: (_node: MockContentNode) => void;
  activeId: string | null;
  timelinePointLabel: string;
}) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedIds.has(node.id);
  const isActive = activeId === node.id;

  return (
    <div>
      <button
        className={`flex w-full items-center gap-1 pr-2 py-0.75 text-[13px] ${
          isActive
            ? "bg-list-active-background text-foreground"
            : "text-foreground hover:bg-list-hover-background"
        }`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => {
          onSelect(node);
          if (hasChildren && !isExpanded) onToggle(node.id);
        }}
      >
        {hasChildren ? (
          <span
            className={`w-4 shrink-0 cursor-pointer text-base ${
              isExpanded
                ? "icon-[material-symbols--keyboard-arrow-down]"
                : "icon-[material-symbols--keyboard-arrow-right]"
            }`}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.id);
            }}
          />
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <ContentNodeIcon hasBody={node.body.length > 0} hasChildren={node.children.length > 0} />
        <span className="truncate">{node.title}</span>
        <span className="ml-auto text-[10px] text-accent-foreground opacity-70 shrink-0">
          {timelinePointLabel}
        </span>
      </button>
      {hasChildren && isExpanded && (
        <div>
          {node.children.map((child) => (
            <ContentTreeNodeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              expandedIds={expandedIds}
              onToggle={onToggle}
              onSelect={onSelect}
              activeId={activeId}
              timelinePointLabel={timelineLabelMap[child.anchorTimelinePointId] ?? ""}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ContentTreePanel({
  tree,
  expandedIds,
  onToggle,
  onSelect,
  activeId,
}: {
  tree: MockContentNode[];
  expandedIds: Set<string>;
  onToggle: (_id: string) => void;
  onSelect: (_node: MockContentNode) => void;
  activeId: string | null;
}) {
  return (
    <div className="pb-2">
      {tree.map((node) => (
        <ContentTreeNodeRow
          key={node.id}
          node={node}
          depth={0}
          expandedIds={expandedIds}
          onToggle={onToggle}
          onSelect={onSelect}
          activeId={activeId}
          timelinePointLabel={timelineLabelMap[node.anchorTimelinePointId] ?? ""}
        />
      ))}
    </div>
  );
}

// ============================================================
// AuxTreePanel
// ============================================================

function AuxTreeNodeRow({
  node,
  depth,
  expandedIds,
  onToggle,
  activeId,
  onSelect,
}: {
  node: MockAuxNode;
  depth: number;
  expandedIds: Set<string>;
  onToggle: (_id: string) => void;
  onSelect: (_node: MockAuxNode) => void;
  activeId: string | null;
}) {
  const isDir = node.nodeType === "dir";
  const isExpanded = expandedIds.has(node.id);
  const isActive = activeId === node.id;

  if (isDir) {
    return (
      <div>
        <button
          className="flex w-full items-center gap-1 pr-2 py-0.75 text-[13px] text-foreground hover:bg-list-hover-background"
          style={{ paddingLeft: `${8 + depth * 16}px` }}
          onClick={() => {
            onSelect(node);
            onToggle(node.id);
          }}
        >
          <span
            className={`w-4 shrink-0 text-base ${
              isExpanded
                ? "icon-[material-symbols--keyboard-arrow-down]"
                : "icon-[material-symbols--keyboard-arrow-right]"
            }`}
          />
          <AuxNodeIcon nodeType={isExpanded ? "dir-open" : "dir"} />
          <span className="truncate">{node.name}</span>
        </button>
        {isExpanded && node.children && (
          <div>
            {node.children.map((child) => (
              <AuxTreeNodeRow
                key={child.id}
                node={child}
                depth={depth + 1}
                expandedIds={expandedIds}
                onToggle={onToggle}
                activeId={activeId}
                onSelect={onSelect}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      className={`flex w-full items-center gap-1 pr-2 py-0.75 text-[13px] ${
        isActive
          ? "bg-list-active-background text-foreground"
          : "text-foreground hover:bg-list-hover-background"
      }`}
      style={{ paddingLeft: `${8 + depth * 16 + 16}px` }}
      onClick={() => onSelect(node)}
    >
      <span className="w-4 shrink-0" />
      <AuxNodeIcon nodeType={node.nodeType} />
      <span className="truncate">{node.name}</span>
      {node.nodeType === "symlink" && node.symlinkTargetPath && (
        <span className="truncate text-[11px] text-accent-foreground ml-1">
          → {node.symlinkTargetPath}
        </span>
      )}
    </button>
  );
}

function AuxTreePanel({
  tree,
  expandedIds,
  onToggle,
  activeId,
  onSelect,
}: {
  tree: MockAuxNode[];
  expandedIds: Set<string>;
  onToggle: (_id: string) => void;
  activeId: string | null;
  onSelect: (_node: MockAuxNode) => void;
}) {
  return (
    <div className="pb-2">
      {tree.map((node) => (
        <AuxTreeNodeRow
          key={node.id}
          node={node}
          depth={0}
          expandedIds={expandedIds}
          onToggle={onToggle}
          activeId={activeId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

// ============================================================
// TimelinePanel – drag & drop, add, delete
// ============================================================

function TimelinePanel({
  points,
  activeId,
  onSelect,
  onReorder,
  onDelete,
}: {
  points: MockTimelinePoint[];
  activeId: string;
  onSelect: (_id: string) => void;
  onReorder: (_fromIndex: number, _toIndex: number) => void;
  onDelete: (_id: string) => void;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent, index: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (index !== dragIndex) {
        setDragOverIndex(index);
      }
    },
    [dragIndex],
  );

  const handleDragLeave = useCallback(() => {
    setDragOverIndex(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, toIndex: number) => {
      e.preventDefault();
      if (dragIndex !== null && dragIndex !== toIndex) {
        onReorder(dragIndex, toIndex);
      }
      setDragIndex(null);
      setDragOverIndex(null);
    },
    [dragIndex, onReorder],
  );

  const handleDragEnd = useCallback(() => {
    setDragIndex(null);
    setDragOverIndex(null);
  }, []);

  return (
    <div className="pb-2">
      {points.map((pt, index) => {
        const isActive = pt.id === activeId;
        const isDragging = dragIndex === index;
        const isDragOver = dragOverIndex === index;
        return (
          <div
            key={pt.id}
            className={`flex items-center gap-1 pr-1 py-0.75 text-[13px] cursor-pointer ${
              isDragging ? "opacity-40" : ""
            } ${isDragOver ? "border-t border-t-drag-border" : ""} ${
              isActive
                ? "bg-list-active-background text-foreground"
                : "text-foreground hover:bg-list-hover-background"
            }`}
            style={{ paddingLeft: "8px" }}
            draggable
            onDragStart={(e) => handleDragStart(e, index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, index)}
            onDragEnd={handleDragEnd}
            onClick={() => onSelect(pt.id)}
          >
            <span className="icon-[material-symbols--radio-button-checked] text-sm text-foreground-muted shrink-0" />
            <span className="truncate">{pt.label}</span>
            <button
              className="ml-auto rounded p-px text-foreground-muted opacity-0 hover:opacity-100 hover:bg-button-hover-background"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(pt.id);
              }}
              title="删除时间点"
            >
              <span className="icon-[material-symbols--close] text-sm leading-none" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// EditorArea
// ============================================================

function EditorArea({
  node,
  body,
  onBodyChange,
}: {
  node: MockContentNode | null;
  body: string;
  onBodyChange: (_v: string) => void;
}) {
  if (!node) {
    return (
      <div className="flex h-full items-center justify-center text-foreground-muted text-sm">
        选择一个正文节点开始编辑
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Title bar */}
      <div className="flex items-center gap-2 px-4 py-2 shrink-0 bg-title-bar-background border-b border-border">
        <ContentNodeIcon hasBody={node.body.length > 0} hasChildren={node.children.length > 0} />
        <span className="text-[14px] text-foreground">{node.title}</span>
        <span className="ml-auto text-[11px] text-accent-foreground">
          时间锚点:{" "}
          {mockTimelinePoints.find((p) => p.id === node.anchorTimelinePointId)?.label ??
            node.anchorTimelinePointId}
        </span>
      </div>
      {/* Body */}
      <textarea
        className="flex-1 bg-editor-background text-[14px] text-editor-foreground font-mono leading-7 p-4 resize-none outline-none border-none"
        value={body}
        onChange={(e) => onBodyChange(e.target.value)}
        placeholder="开始写作..."
      />
    </div>
  );
}

// ============================================================
// Main Layout
// ============================================================

export function ProjectLayout(_: { id: string }) {
  // --- Content tree state ---
  const [expandedContentIds, setExpandedContentIds] = useState<Set<string>>(
    () => new Set(["vol1", "ch1", "ch2"]),
  );
  const [activeContentNodeId, setActiveContentNodeId] = useState<string | null>("s1");

  // --- Aux tree state ---
  const [expandedAuxIds, setExpandedAuxIds] = useState<Set<string>>(
    () => new Set(["root-char", "root-area"]),
  );
  const [activeAuxNodeId, setActiveAuxNodeId] = useState<string | null>(null);

  // --- Timeline state ---
  const [timelinePoints, setTimelinePoints] = useState<MockTimelinePoint[]>(mockTimelinePoints);
  const [activeTimelinePointId, setActiveTimelinePointId] = useState<string>("origin");

  // --- Editor state ---
  const [editorBody, setEditorBody] = useState<string>("");
  const [bodyOverrides, setBodyOverrides] = useState<Record<string, string>>({});

  // Derived: all flat content nodes
  const allContentNodes = flattenContentNodes(mockContentTree);

  // Derived: active content node
  const activeContentNode = activeContentNodeId
    ? (allContentNodes.find((n) => n.id === activeContentNodeId) ?? null)
    : null;

  // Derived: editor body with overrides applied
  const effectiveBody =
    activeContentNodeId && bodyOverrides[activeContentNodeId] != null
      ? bodyOverrides[activeContentNodeId]
      : editorBody;

  // Derived: aux tree for the active timeline point
  const currentAuxTree: MockAuxNode[] = auxTreeMap[activeTimelinePointId] ?? mockAuxTreeOrigin;

  // --- Handlers ---

  const toggleContentExpanded = (id: string) => {
    setExpandedContentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAuxExpanded = (id: string) => {
    setExpandedAuxIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleContentSelect = (node: MockContentNode) => {
    setActiveContentNodeId(node.id);
    setEditorBody(bodyOverrides[node.id] ?? node.body);
    // Also select the associated timeline point (which updates aux tree)
    setActiveTimelinePointId(node.anchorTimelinePointId);
  };

  const handleTimelineSelect = (pointId: string) => {
    setActiveTimelinePointId(pointId);
    // Don't change content node
  };

  const handleTimelineReorder = (fromIndex: number, toIndex: number) => {
    setTimelinePoints((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      if (moved) next.splice(toIndex, 0, moved);
      return next;
    });
  };

  const handleTimelineAdd = () => {
    const count = timelinePoints.length + 1;
    const newPoint: MockTimelinePoint = {
      id: `point_${crypto.randomUUID().slice(0, 8)}`,
      key: `new-point-${count}`,
      label: `新时间点 ${count}`,
      description: "",
    };
    setTimelinePoints((prev) => [...prev, newPoint]);
  };

  const handleTimelineDelete = (pointId: string) => {
    if (pointId === "origin") return; // cannot delete origin
    setTimelinePoints((prev) => prev.filter((p) => p.id !== pointId));
    if (activeTimelinePointId === pointId) {
      setActiveTimelinePointId("origin");
    }
  };

  // When body changes in editor, update the mock data
  const handleBodyChange = (newBody: string) => {
    setEditorBody(newBody);
    if (activeContentNodeId) {
      setBodyOverrides((prev) => ({ ...prev, [activeContentNodeId]: newBody }));
    }
  };

  const handleAuxSelect = (node: MockAuxNode) => {
    setActiveAuxNodeId(node.id);
  };

  // Derive the initial editor body from the first content node (s1)
  useState(function initBody() {
    setEditorBody(allContentNodes.find((n) => n.id === "s1")?.body ?? "");
  });

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-editor-background text-foreground select-none">
      {/* Activity Bar */}
      <div className="flex w-12 shrink-0 flex-col items-center gap-1 bg-activity-bar-background pt-2">
        <div className="flex w-full items-center justify-center border-l-2 border-l-activity-bar-active-foreground py-1">
          <span className="icon-[material-symbols--description] text-2xl text-activity-bar-active-foreground" />
        </div>
        <div className="flex w-full items-center justify-center py-1">
          <span className="icon-[material-symbols--search] text-2xl text-activity-bar-foreground" />
        </div>
        <div className="flex w-full items-center justify-center py-1">
          <span className="icon-[material-symbols--source-control] text-2xl text-activity-bar-foreground" />
        </div>
        <div className="mt-auto flex w-full items-center justify-center py-2">
          <span className="icon-[material-symbols--settings] text-2xl text-activity-bar-foreground" />
        </div>
      </div>

      {/* Left Sidebar – three stacked panels */}
      <div className="flex w-72 shrink-0 flex-col bg-sidebar-background border-r border-border overflow-hidden">
        {/* 正文 */}
        <SidebarSection title="正文">
          <ContentTreePanel
            tree={mockContentTree}
            expandedIds={expandedContentIds}
            onToggle={toggleContentExpanded}
            onSelect={handleContentSelect}
            activeId={activeContentNodeId}
          />
        </SidebarSection>

        {/* 辅助信息 */}
        <div className="border-t border-border" />
        <SidebarSection title="辅助信息">
          <AuxTreePanel
            tree={currentAuxTree}
            expandedIds={expandedAuxIds}
            onToggle={toggleAuxExpanded}
            activeId={activeAuxNodeId}
            onSelect={handleAuxSelect}
          />
        </SidebarSection>

        {/* 时间轴 */}
        <div className="border-t border-border" />
        <SidebarSection
          title="时间轴"
          actions={
            <button
              onClick={handleTimelineAdd}
              className="icon-[material-symbols--add] text-base hover:text-foreground"
              title="添加时间点"
            />
          }
        >
          <TimelinePanel
            points={timelinePoints}
            activeId={activeTimelinePointId}
            onSelect={handleTimelineSelect}
            onReorder={handleTimelineReorder}
            onDelete={handleTimelineDelete}
          />
        </SidebarSection>
      </div>

      {/* Main Editor Area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <EditorArea node={activeContentNode} body={effectiveBody} onBodyChange={handleBodyChange} />
      </div>
    </div>
  );
}

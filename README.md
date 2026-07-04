# Nova Story

> **把小说创作过程建模成一个可分支、可提交、可按故事时间切换上下文的本地工作区。**

NovaStory 不是一个"写作工具 + AI 聊天框"。它的核心是把长篇创作从"一堆 Markdown 文件"重新建模成**带世界状态的工作区**：正文树承载创作结构，时间锚点切分故事状态，辅助资料按时间层叠加成快照，底层用 bare Git repo + SQLite VirtualWorkdir 管理当前态和历史态。

---

## 核心架构

### 正文树

正文不是一篇大文档，而是一棵树。每个节点代表一个章节或场景，节点之间有父子关系、同级顺序、标题、正文内容和锚定时间点。节点级移动、重排、拆分比整篇文档编辑更贴近真实写作过程，也为语义化 diff 和 AI 操作提供基础。

### 时间锚点

时间锚点是**故事世界状态发生重大变化的断面**，不是章节编号。它承担的是上下文切分机制：

- 一个锚点可以跨越多个章节；
- 一个章节不一定意味着世界状态变化；
- 创作时需要切换的不是文档，而是当前处于哪个故事断面。

### 辅助资料 overlay

辅助资料（人物设定、世界观说明等）不是一份静态全量文件树，而是**分层叠加模型**：

- `aux/origin` — 故事开始前的初始设定
- `aux/timeline/<pointId>` — 某个时间点新增或修改的资料层

读取某个时间点的辅助资料快照时，按顺序叠加各层，并应用 whiteout 删除标记。这样 AI 读到的就不再是项目资料全集，而是**当前故事断面下真正可见、真正成立的设定**。

---

## 存储设计

### Bare Git Repo + SQLite VirtualWorkdir

项目的底层不是传统的数据库 + 文件目录，而是一个 bare Git repository 作为对象和历史内核，加上一个 SQLite VirtualWorkdir 作为当前分支的可编辑工作区：

```
<projectId>.git/
  HEAD
  refs/heads/<branch>
  refs/novel-evolver/meta           # 项目元数据
  refs/novel-evolver/chats          # AI 聊天记录
  branch-map.json                    # 分支 → workdir key 映射
  workdir.db                         # SQLite 虚拟工作区
```

- **Git** 负责"历史上发生过什么"（commit / tree / blob、分支引用、自定义 refs）
- **VirtualWorkdir** 负责"我现在正在编辑什么"（可编辑的当前态、可提交的快照）
- 分支切换不需要在磁盘上搬运文件，只需切换 VirtualWorkdir 的基线 tree

工作区内部文件布局：

```
index.jsonl                         # 正文树结构索引（id / parentId / title / anchorTimelinePointId）
timeline.jsonl                      # 时间锚点链
manuscript/<nodeId>.md              # 每个正文节点的内容
aux/origin/**                       # 辅助资料原点层
aux/timeline/<pointId>/**           # 辅助资料时间增量层
```

### 语义化 diff

Git 底层 diff 看到的是 `index.jsonl` 变了、某个 `manuscript/<id>.md` 变了。NovaStory 在上面翻译了一层**创作语义**，把变更拆成三个 area：

| area     | 面向作者的语义                                 |
| -------- | ---------------------------------------------- |
| content  | 章节新增、删除、重排、改标题、改正文、改锚点   |
| timeline | 时间点新增、删除、改名、改描述、改顺序         |
| aux      | 某份辅助资料在哪个时间点新增、修改、删除或失效 |

单项 revert 也因此成立——可以撤回单个正文节点的修改、某个时间点的改动、或某条辅助资料的变更。

---

## AI 集成：不是外挂，是运行时

AI 不是拿到一大段字符串自由发挥，而是运行在项目模型之上：

- **上下文是显式注入的** — AI 运行时拿到的是当前编辑器状态：当前正文节点、当前辅助资料路径、当前时间锚点
- **AI 通过工具操作领域对象** — 读取/修改正文节点、创建/修改时间锚点、在当前时间断面下读写辅助资料
- **工具结果触发 UI 刷新** — 前端根据工具结果刷新正文树、时间线或辅助资料
- **时间锚点可在同一轮工具调用中切换** — `set_current_timeline` 后后续工具立即基于新断面工作

AI 的上下文不是靠 prompt 去猜"我现在到底在写什么"，而是直接拿到当前工作区的事实状态。

---

## 技术栈

| 层       | 技术                                                                                      |
| -------- | ----------------------------------------------------------------------------------------- |
| 运行时   | **Bun**（HTTP 服务、HMR、测试、打包）                                                     |
| 前端     | **React 19** + **Tailwind CSS 4** + **Wouter**（路由）+ **Zustand**（状态管理）           |
| 编辑器   | **Lexical**（AI 输入框 / `@prompt` mention）+ **CodeMirror 6**（正文编辑）                |
| AI       | **Vercel AI SDK**（Anthropic / OpenAI / Google / XAI / OpenRouter / Azure / Cerebras 等） |
| Git      | **nano-git**（bare repo + SQLite VirtualWorkdir）                                         |
| 样式     | **Iconify**（`material-symbols`）+ **Motion**（动画）                                     |
| 代码质量 | **Oxlint** + **Prettier** + **Husky** + **lint-staged**                                   |

---

## 快速开始

```bash
git clone <repo>
cd NovaStory
bun install
```

### 开发

```bash
bun dev
```

启动 HMR 开发服务器，默认 `http://localhost:3000`。

### 生产构建

```bash
bun run build
NODE_ENV=production bun start
```

### 测试 / 类型检查 / Lint

```bash
bun test           # 运行测试
bunx tsc --noEmit  # TypeScript 类型检查
bun run lint       # Oxlint 静态分析
bun run format     # Prettier 格式化
```

## 脚本

| 命令             | 说明                          |
| ---------------- | ----------------------------- |
| `bun dev`        | 开发服务器（HMR）             |
| `bun start`      | 生产服务器                    |
| `bun run build`  | 前端构建（Tailwind + minify） |
| `bun run lint`   | Oxlint 检查                   |
| `bun run format` | Prettier 格式化               |

## 项目结构

```
src/
├── app/                    服务端 / 客户端外壳 / 路由
│   ├── server.ts           Bun.serve() 入口，挂载 RPC 与 Chat API
│   └── client/             前端 HTML + 路由 + 状态初始化
├── modules/
│   ├── ai/                 AI 模块
│   │   ├── domain/         模型目录、用户配置、项目聊天存储
│   │   ├── server/         流式 Chat API 处理器
│   │   └── ui/             聊天面板、配置界面
│   ├── projects/           项目管理
│   │   └── ui/             项目列表、工作台、分支管理、提交历史
│   ├── workspace/          核心工作区
│   │   ├── domain/         领域模型
│   │   │   ├── content.ts      正文树 CRUD
│   │   │   ├── timeline.ts     时间锚点链 CRUD
│   │   │   ├── aux.ts          辅助资料 overlay 模型
│   │   │   ├── working-tree-status.ts  语义化 diff
│   │   │   ├── commit-diff.ts          提交差异分析
│   │   │   ├── branches.ts    分支管理
│   │   │   ├── commits.ts     提交管理
│   │   │   ├── lifecycle.ts   工作区生命周期
│   │   │   └── git-storage/   bare repo + SQLite VirtualWorkdir 封装
│   │   └── ui/              编辑器、文件树、变更面板
│   └── config/              应用配置
├── rpc/                    RPC API 路由（绑定所有模块的 RPC 处理器）
└── shared/                 通用组件与工具
    ├── lib/                cn()、domain 工具、路径工具
    └── components/         Editor、Markdown、Sidebar、Tree 等通用 UI
```

每个模块按 **domain/**（业务逻辑）、**rpc/**（API 契约）、**server/**（服务端处理）、**ui/**（React 组件与状态）分层组织。

---

## 设计理念

1. **小说项目不是文档集合，而是有世界状态的工作区** — 正文树 + 时间锚点 + 辅助资料 overlay 是数据模型的中心
2. **Git 是状态机，不是 UI 概念** — 底层用 bare repo + VirtualWorkdir，对作者暴露的是创作语义而不是 staging area / rebase / cherry-pick
3. **AI 不是外挂聊天框，而是工作区运行时** — AI 操作的是领域对象，上下文由编辑器状态显式注入，工具结果驱动 UI 刷新
4. **决定性的复杂度在领域模型，不在前端框架** — UI 只是呈现层，RPC 只是分发层，AI 只是运行时扩展

---

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) 本项目使用 MIT 协议。

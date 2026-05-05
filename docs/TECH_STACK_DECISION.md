# 技术栈确认 v0.1

## 1. 本轮结论
当前项目的首版技术栈确认如下：

- 桌面端：Tauri 2
- 前端框架：React + TypeScript
- 样式方案：Tailwind CSS
- 基础组件：shadcn/ui，按 macOS 风格定制
- 富文本编辑器：TipTap
- Markdown 处理：remark + unified
- 代码块编辑：CodeMirror 6
- 代码高亮：Shiki
- 本地数据库：SQLite
- 全文检索：SQLite FTS5
- 本地数据存储：Markdown 文件 + assets 附件目录 + SQLite 索引
- 首版 NAS 方案：绿联云 NAS 通过系统挂载目录访问

## 2. 为什么这样选

### Tauri 2
- 更适合本地优先桌面软件。
- 安装包和运行资源通常比 Electron 更轻。
- 访问本地文件系统、窗口能力、系统菜单会更自然。
- 后续 Windows 支持也比较顺。

### React + TypeScript
- 生态成熟，适合和 AI 协作开发。
- 组件化清晰，方便快速搭建三栏工作台、搜索弹窗、编辑器壳层。
- TypeScript 能帮助我们稳定数据模型，减少知识库结构演进时的混乱。

### TipTap
- 适合做富文本编辑。
- 基于 ProseMirror，扩展性足够强。
- 后续做 `[[引用]]`、标签、代码块、任务列表都更容易。

### remark + unified
- 适合 Markdown 解析、序列化、格式处理。
- 后续导入导出 Markdown、生成预览、做语法清洗会更稳。

### CodeMirror 6 + Shiki
- CodeMirror 6 适合交互式代码输入。
- Shiki 的代码高亮观感更好，适合做阅读和预览。
- 这两个组合起来，编辑和展示都兼顾。

### SQLite + FTS5
- 本地全文检索成熟稳定。
- 适合标题、正文、标签、引用片段的检索。
- 易于重建索引，适合“文件是真实源数据，数据库是加速层”的架构。

## 3. NAS 方案确认

### 当前前提
用户当前使用的是绿联云 NAS。

### 首版策略
- App 初版不做完整自研 WebDAV 文件客户端。
- macOS 方向优先尝试调用系统 WebDAV 挂载能力，再把挂载结果当作本地目录使用。
- 当前 NAS 已知 WebDAV 路径形态示例为 `http://47.103.114.153//home/data`，路径部分需要保留双斜杠。
- Windows 或其他平台仍可先按“系统已挂载目录”方式接入。

### 这样做的好处
- 实现简单很多。
- 不需要首版就处理网络鉴权、连接状态、协议差异。
- 更符合“本地优先，文件可见”的产品方向。

### 首版需要补的能力
- 路径可用性检测。
- 自动挂载恢复。
- 知识库目录自动初始化。
- 只读降级模式。
- 文件冲突提示。
- 索引损坏后重建。

## 4. 数据模型确认

推荐目录结构：

```text
KnowledgeBase/
  notes/
    inbox/
    projects/
    topics/
  assets/
  .app/
    index.db
    settings.json
```

说明：
- `notes/` 保存 Markdown 笔记。
- `assets/` 保存图片和附件。
- `.app/index.db` 保存搜索索引、关系索引和缓存信息。
- 用户真实数据以文件为准，数据库可重建。

## 5. 开发顺序确认

### Phase 1
- 先做 macOS 桌面端。
- 同时保持 Windows 可编译，但不追求第一天完全适配。

### Phase 2
- 完成本地目录知识库读写。
- 接入绿联云 NAS 挂载目录。
- 完成搜索、引用、反向链接。

### Phase 3
- 补 Windows 细节。
- 再决定 iPhone 方案。

## 6. 暂不采用的方案

- Electron：先不选，原因是更重，首版没有必要。
- 直接做 React Native iPhone 客户端：先不选，原因是核心难点在桌面端编辑器和知识库模型。
- App 内直接连接 SMB/WebDAV：先不选，原因是会显著增加首版复杂度。
- 一开始做图谱：先不选，原因是展示成本高，但对 MVP 价值不如检索和双链直接。

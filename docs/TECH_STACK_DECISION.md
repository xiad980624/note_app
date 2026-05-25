# 技术栈确认 v0.1

## 1. 本轮结论
当前项目的首版技术栈确认如下：

- 桌面端：Tauri 2
- 前端框架：React + TypeScript
- 样式方案：Tailwind CSS
- 基础组件：shadcn/ui，按 macOS 风格定制
- 富文本编辑器：TipTap（后续增强方向）
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
- 组件化清晰，方便快速搭建图标栏、目录树、编辑器和关系侧栏。
- TypeScript 能帮助我们稳定数据模型，减少知识库结构演进时的混乱。

### TipTap
- 适合承载未来更完整的结构化编辑层。
- 基于 ProseMirror，扩展性足够强。
- 但当前阶段主编辑链路先以 Markdown-first 为准，优先保证输入、保存、自动保存稳定。

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
- App 首版采用“本地优先 + 可选远端同步”。
- 默认工作副本是本地离线知识库，macOS 默认路径为 `~/Documents/NoteBase`。
- App 初版不做完整自研 WebDAV 文件客户端。
- 当用户启用同步时，macOS 方向优先尝试调用系统 WebDAV 挂载能力，再把远端目录当作同步目标使用。
- 当前 NAS 已知 WebDAV 路径形态示例为 `http://47.103.114.153//home/data`，路径部分需要保留双斜杠。
- Windows 或其他平台仍可先按“系统已挂载目录”方式接入。

### 这样做的好处
- 编辑与保存不依赖远端在线状态。
- 用户打开 App 就能直接进入知识库，而不会被 NAS 状态阻塞。
- 不需要首版就处理完整网络鉴权、连接状态、协议差异。
- 更符合“本地优先，文件可见”的产品方向。

### 首版需要补的能力
- 默认本地离线路径自动初始化。
- 启动时本地与远端状态对比。
- 手动同步入口与首次同步方向选择。
- 远端可用性检测与自动挂载恢复。
- 文件冲突提示。
- 索引损坏后重建。

## 4. 数据模型确认

推荐目录结构：

```text
KnowledgeBase/
  notes/
    note/
    todo/
    journal/
    notebooks/
      Product/
      Research/
  assets/
    images/
    files/
  .notebase/
    index.db
    settings.json
```

说明：
- `notes/note/`、`notes/todo/`、`notes/journal/` 保存未归档文档。
- `notes/notebooks/<Notebook Name>/` 保存已归档到 notebook 的文档。
- 每篇文档保留两个独立属性：
  - `documentType`
  - `notebook`
- `assets/images/` 与 `assets/files/` 分别保存图片和附件。
- `.notebase/index.db` 保存搜索索引、关系索引和缓存信息。
- 用户真实数据以文件为准，数据库可重建。
- P1 基础搜索直接读取 Markdown 文件并在 Tauri 后端打分返回；后续数据量变大后再落入 `.notebase/index.db` 或专用全文索引。
- P1 基础图谱直接由 Tauri 后端解析 `[[wikilink]]` 和 frontmatter tags，前端用轻量 2D 布局渲染当前笔记邻居网络。
- P1 基础媒体库直接由 Tauri 后端解析 Markdown 链接目标，按真实相对路径回溯每个附件的被引用文档，并在前端提供 `Unlinked` 过滤。
- P1 媒体清理仅允许删除未被任何 Markdown 引用的附件；后端会再次校验引用状态和路径边界，并在删除后清理空目录。
- 媒体排序和预览交互保留在前端完成，避免为纯展示逻辑增加额外索引或后端状态。
- 同步冲突解决沿用现有 `resolve_sync_conflict` Tauri 命令，由前端负责展示冲突列表和逐项决策，不额外引入新的同步状态机。
- 搜索结果高亮和筛选记忆保留在前端完成，避免为轻量 UI 状态增加额外后端协议。
- 搜索排序仍由 Tauri 后端统一计算，当前策略为字段权重 + 命中频次 + 轻量最近修改加权，避免前端二次重排导致结果不一致。
- 媒体库批量选择保留在前端完成，仍然复用已有单文件删除命令逐项执行，避免新增一套批量删除协议。
- 图谱聚焦 / 全局切换和图内搜索保留在前端视口层完成，继续复用同一份后端图谱数据，避免重复构建图索引。
- 图谱节点详情和跳转动作也保留在前端状态层完成，节点点击不再直接切走工作区，减少上下文抖动。
- 同步敏感配置和最近同步状态落在 `.notebase/sync-config.json` 与 `.notebase/sync-state.json`，由 Tauri 负责读写，前端不再把密码写入 `localStorage`。
- 当前删除同步使用 manifest 对齐后的保守传播策略：仅当目标侧文件仍与上次同步记录一致时才自动删除，否则升级为冲突交由用户处理。
- 编辑器中的粘贴导入继续复用现有 `import_asset` 流程，不新增独立剪贴板上传协议；预览回显在前端根据笔记相对路径解析本地附件绝对路径。
- Markdown 编辑器继续保持 textarea + 轻量语义增强路线：列表 / checklist / 引用的自动续写与退出由前端按行前缀解析处理，不引入重型编辑器框架。
- 编辑器工具栏保持“主栏 + 溢出菜单”结构，继续用前端本地状态控制弹层而不是引入额外菜单框架。
- 文档移动到 notebook 时，需要同步维护正文中的相对附件路径。
- 历史测试库可能仍存在 `inbox / projects / topics` 等旧目录；当前 Tauri 后端在加载知识库时迁移其中的 markdown 文件：
  - `inbox` 迁移为未归档 `notes/note/`
  - `projects` 迁移为 notebook `Projects`
  - `topics` 迁移为 notebook `Topics`
- 对于位于 `notes/notebooks/<Notebook Name>/` 但缺少 frontmatter 的文档，索引层会从路径推断 `notebook`。
- `load_library_index` 返回 `legacyMigration`，前端据此展示一次性的迁移提示。

## 6. 后续优化方向

- 安全存储远端凭据，不再长期依赖前端本地存储。
- 基于持久化同步元数据做更强的增量同步与真正的双向比对。
- 当前本地 manifest 已落在 `.notebase/sync-manifest.json`，后续可以继续升级字段与跨端兼容性。
- 删除同步与墓碑记录，避免“只复制不清理”导致的残留文件。
- 冲突解决 UI，包括逐文件比较、保留哪一侧、或生成副本。
- 同步历史、失败恢复、重试队列和后台自动同步策略。
- 旧知识库目录迁移的回滚说明。

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
- 图谱先做轻量邻居网络，不引入复杂图布局库；等数据量和交互需求明确后再评估专用图谱引擎。

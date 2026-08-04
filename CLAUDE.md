# knowhoard（小怪兽知识库）项目交接文档

本地优先的个人知识库问答客户端。Electron 桌面应用，仅 macOS 验证过。
仓库：github.com/lymboy/knowhoard ｜ 当前版本：v0.2.0

## 用户协作方式（先读这个）

- **用户不会写代码**，所有实现都靠 AI 完成。不要问"你要不要自己改一下"，直接改。
- **用户说过的数字/要求必须严格执行**。说改到 50 就是 50，不要自作主张改成 15——这事发生过，用户很恼火。
- **不要重复造轮子**。用户反复强调：优先用开源社区成熟方案（MCP server、API 服务、组件库），不要自己手写。写之前先想"社区有没有现成的"。
- **用户对 UI 丑零容忍**。改 UI 前先看成熟产品的设计（ChatGPT / LobeChat / GitHub），不要自己拍脑袋配色。
- 直接执行，少问问题。做完一件事就启动 `npm start` 让用户能马上验证。

## 硬约束（违反必出 bug，都是踩过的坑）

### 安全
1. **所有文件工具只能访问用户已添加的数据源目录**，路径校验在 `main/tools/builtinTools.js` 的 `safePath()`，不允许越界。
2. **工具全部只读**，没有也不会加 write/delete 类工具。如果未来加 bash/shell 类 MCP，必须先做 pre-hook 权限拦截（用户明确要求过），delete/rm 类操作一律拒绝。
3. 下载文件进沙箱 `{userDataPath}/sandbox/downloads/`，危险扩展名（.sh/.exe/.bat 等 30+ 种）chmod 444 只读，50MB 上限，流式下载边下边查。

### Agent 架构
4. **工具调用用 `tool_choice` 协议参数控制，不靠提示词**。意图分类是纯规则（`classifyIntent`），不依赖模型质量——用户配的模型千差万别。
5. **引用编号 = 检索 chunk 编号 + 工具读取来源编号（连续）**。`agentLoop.js` 里 `toolReadSources` 跟踪 read_file/fetch_url 读到的文件，每轮工具调用后注入「编号→文件」映射表给 LLM。只跟踪检索 chunk 会导致引用张冠李戴（真实 bug：回答内容对、引用文件错）。
6. **工具调用用 tool_call_id 匹配结果**，不能按名字匹配——同一轮可能有多个同名工具调用。
7. 工具并行执行（`Promise.all`），MAX_TOOL_ROUNDS = **50**（用户定的，别改小）。
8. `chatCompletion`（非流式）和 `streamChatCompletion`（流式）都要传 `enable_thinking`——漏一个就会导致"思考模式开了没反应"。思考过程要收集所有轮次的，不是只取最后一轮。

### 数据
9. **工具调用记录要落库**（`messages.tool_calls` JSON 列），不然切走会话再回来记录就丢了。落库前 result 截断到 500 字符，read_file 全文可能上万字。
10. DB 迁移用 `PRAGMA table_info` 查列存在性再 `ALTER TABLE`，SQLite 没有 `ADD COLUMN IF NOT EXISTS`。

### 样式
11. **气泡内所有样式必须跟随亮/暗主题，禁止硬编码颜色**。表格、行内代码、链接、Mermaid 全是 `:root[data-theme="dark"]` 双套。踩过的坑：白底下黑表头、灰白文字隐形。代码块保留深色底（GitHub 白底主题也这么干，例外）。
12. Mermaid 主题在 `app.js` 启动时按 `document.documentElement.dataset.theme` 选亮/暗变量，`useMaxWidth: false` + `min-width: 100%` 防止图缩得太小。
13. 列表项正文 13px，气泡正文 14px——别改大，用户明确嫌大过。

### 提示词
14. **不要在系统提示词里枚举工具列表**——工具已通过 API 的 `tools` 参数传给模型，重复枚举会腐坏（self_query 意图除外，那种情况 tools 不传给 API，需要动态注入）。
15. 对话区不放工具开关——工具是否启用只在设置页控制，用户问答应该无感知。

## V2 重构强制约束（refactor/v2-vite 分支，2026-08-03 起）

本次渲染层重构一次性全部完成，以下约束强制生效：

### 需求实现原则
- **用户提的需求必须 100% 实现**，不打折扣、不"差不多就行"。说过的数字/要求严格执行（同上"用户协作方式"）。
- **动手前先列 To-do / Task 清单**，所有任务记录在 `docs/superpowers/specs/2026-08-03-v2-vite-tdesign-refactor-design.md` 第 8 节验收清单 + 任务系统，全部实现，不遗漏。
- 一次性实现全部重构功能，不分多轮等批准，连续推进到底。

### 重构功能验收（全部不允许有问题）
- (a) 对话气泡页面 UI：TDesign Chat 化
- (b) 整个 UI 全部重构：现有完整成熟功能不能有任何异常错乱
- (c) 会话列表的展示
- (d) 标题（AI 摘要）的重写
- (e) 左下角各种状态、布局的视觉呈现

### 设置功能保真（百分百原样保留，不能改坏）
1. 配置模型（Base URL / API Key）
2. 选择模型
3. 模型下拉（自动拉取模型列表）
4. 检测模型是否 think 模式
5. 向量库检索开关
6. MCP 内置工具的配置

### 交付物验收
- 最终交付一个 **DMG 文件**，能正常安装并启动（`npm run dist` 产出，ASCII 文件名 `knowhoard-x.y.z-arm64.dmg`）。
- 不只 `npm start` 跑通，必须打包验证安装启动。

### 5 个痛点必须根治
状态不及时更新 / 气泡顺序乱 / 来源数据错乱 / Markdown 渲染失败 / 非流式（见设计文档第 6 节验收表），靠新架构结构上消除。

## 架构速查

```
main/
  ai/agentLoop.js      # 核心：意图分类 → 检索 → tool_choice 路由 → 工具循环 → 引用过滤
  ai/llmClient.js      # OpenAI 兼容客户端（流式/非流式），唯一出网点
  ai/aiWorkerClient.js # 本地模型 worker 管理（embedding/rerank），CPU 负载高才卸载
  mcp/mcpClient.js     # MCP server 管理 + 内置工具注册/开关/分发（builtin__ 前缀）
  tools/builtinTools.js# read_file / list_directory / search_files（数据源目录限定）
  tools/webTools.js    # web_search(Exa/DuckDuckGo) / fetch_url(HTML/PDF/Word/Excel/CSV) / download_file
  rag/retriever.js     # 三路混合检索（向量+FTS5 trigram+文件名）→ RRF → 本地 rerank
  ingest/sync.js       # MD5 diff 增量同步
  db/sqlite.js         # better-sqlite3 + FTS5，migrate() 做增量列迁移
  ipc.js               # IPC handler，getWindow() 模式（窗口可被 Dock 重建）
renderer/
  app.js               # 原生 JS 手搓 DOM（~1500 行，待迁移 Vue）
  index.html / styles.css
```

## 待办清单（按优先级）

### P0 — 已完成（v0.4.0 随 V2 重构落地）
1. **隐藏文件/目录过滤**：导入和 Obsidian 集成时排除 `.DS_Store`、`.git`、`node_modules`、`dist`、`build`、`.idea`、`.vscode` 等。改在 `main/ingest/` 的 `walkDirectory` 和 `fileReaders`。
2. **提示词动态元数据**：系统提示词注入当前时间、时区、操作系统版本。
3. **助手人设**：回答语气定位"贴心小助理"——和蔼可亲、不厌其烦。已调 KB/PLAIN_SYSTEM_PROMPT。
4. **已提交**：tool_calls 持久化、思考模式修复、引用修复这批改动早已 commit。

### P1 — 架构演进（V2 进行中：refactor/v2-vite 分支）
5. **渲染层迁移 Vue 3 + TDesign**（v0.4.0）：已从原生 DOM 迁到 Vite + Vue 3 + TDesign。Phase 1（vite 构建链路）/ Phase 2（单 Vue 应用 + TDesign 布局）/ Phase 3（对话层 TDesign 化）/ Phase 4（清理迁移期遗留：markdown.js 直接 import 不再挂 window 全局、MessageBubble 去重复实现、移除未用的 @tdesign-vue-next/chat）主干完成。设计文档见 `docs/superpowers/specs/2026-08-03-v2-vite-tdesign-refactor-design.md`。剩余：暗色主题下新增功能（跨会话记忆卡片/技能列表）的视觉验收还没专门测过。
6. **Sub-agent / 并行任务**：聊过，暂缓。先把 tool 并行做扎实。

### P2 — 已完成（v0.5.0）
7. **Web Search MCP 化**：web_search 已从内置函数改造成 stdio MCP server（`main/mcp/webSearchServer.js`），设置页 MCP 工具列表可见可管理，保留 Exa 优先/DuckDuckGo 降级。首次启动自动写入一次默认配置，用户移除后不再补回。
8. **跨会话记忆**：`facts` 表已加（`main/db/sqlite.js`）。用户离开会话时后台调 LLM 提炼（`extractConversationFacts`，`main/ipc.js`），不是每轮问答后触发。新会话读最近 20 条注入系统提示词（`main/ai/agentLoop.js`）。设置页"跨会话记忆"卡片可查看/删除。
9. **Skill 加载**：`main/skills/skillsManager.js` 扫描 `~/.claude/skills/` 下的 SKILL.md，渐进式加载——系统提示词只放 name+description 目录，新增 `load_skill` 工具（`main/tools/skillTool.js`）供模型按需读取完整正文。设置页"技能（Skill）"区块管理开关，默认全部未启用。
10. **OCR**：`main/ingest/ocr.js`，pdfjs-dist 渲染页面 + @napi-rs/canvas（无系统依赖） + tesseract.js 识别，中英语言包随包打包在 `resources/tessdata/`（全程本地离线，不联网下载语言包）。`fileReaders.js` 原"无文本层直接报错"分支已改为先走 OCR。已知局限：CPU 密集，大批量扫描件会明显拖慢同步；没有跳过/暂停开关。
11. **Linux/Windows 打包**：`titleBarStyle` 已按 `process.platform` 条件化（原无条件 `hiddenInset` 是 macOS 专属，非 mac 平台会双重顶部留白），补了 `window.kb.platform`、`build/icon.ico`、package.json 的 win/linux target。Linux AppImage / Windows NSIS 已在 macOS 上用 electron-builder 交叉编译验证跑通，**但没有在真实 Linux/Windows 机器上装机运行过**，`main/tools/builtinTools.js` 的 `safePath()` 在 Windows 大小写不敏感文件系统下的行为也没有真机验证。

## 发布流程

```bash
npm start          # 开发模式（每次改完必跑给用户验证）
npm run dist       # 构建 DMG（dist/小怪兽知识库-x.y.z-arm64.dmg）
```

发版步骤：改 version → commit → `cp dist/小怪兽知识库-*.dmg dist/knowhoard-x.y.z-arm64.dmg`（**GitHub release 中文文件名会被吃掉，必须复制成 ASCII 名再传**）→ git tag + push → `gh release create`。

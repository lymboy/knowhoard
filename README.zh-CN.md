# 小怪兽知识库

本地优先的个人知识库问答客户端。把 Word / PDF / Markdown 文件或整个 Obsidian vault 接进来,本地做检索,你自己配置的大模型做问答，回答标注具体引用了哪份文档。

## 这是什么，为什么要做

市面上的个人知识库工具（如 AnythingLLM）用"workspace"当检索边界——文档导进来还得手动挑、手动往某个 workspace 里嵌入，新增笔记不会自动进索引，每次都要重复"导入 → 选文档 → 保存嵌入"这套流程。对一个持续在长的个人笔记库来说，这个模型不对：应该是配一次、之后任何对话都自动检索全部内容，不需要为每次提问预先想清楚"这次该搜哪个文档"。

这个客户端就是照这个预期做的：数据源配好之后，所有对话默认能检索到全部已索引内容，不存在额外的"挑文档"步骤。

## 核心设计

- **本地优先，隐私边界清晰**：本地 embedding（`bge-small-zh-v1.5`）、本地 rerank（`bge-reranker-base`）、本地向量库（LanceDB）、本地元数据库（SQLite）。唯一离开这台电脑的数据，是问答时发给你自己配置的 LLM 接口的那部分上下文——这是问答本身需要的，没有任何后台上报或遥测。
- **只读接入原始文件**：导入文档不会修改原文件，只记录路径和抽取出的文本内容，你可以继续在原文件上自由编辑。
- **MD5 增量同步**：重新扫描时按内容哈希判断文件是否真的变了，没变就跳过，不做无意义的重复分块和向量化，这是控制 CPU 占用的关键。
- **三路混合检索 + 精排**：向量语义检索 + 正文关键词（SQLite FTS5 trigram）+ 文件名/路径匹配，RRF 融合后本地精排。第三路"文件名路径匹配"专门解决"记得文件名、记不清内容"这种场景，传统的双路检索覆盖不到。
- **markdown 标题感知分块**：按标题行切分小节边界，不会把两个不相关小节的内容拼进同一个 chunk；每个 chunk 会带上所在章节路径前缀，脱离原文上下文也能看懂。
- **模型空闲自动卸载**：空闲超过 10 分钟且系统负载较高时，自动卸载本地 AI worker 释放内存，下次提问再自动重新加载，尽量少占用你机器的资源。
- **OpenAI 兼容 LLM，配置自由**：Base URL / API Key / 模型名 / 自定义请求头 / temperature / top_p / top_k / max_tokens 都可以配，不绑定任何一家。
- **Agent 架构，MCP 工具可选**：内置 MCP 客户端（stdio 方式，配置格式与 Claude Desktop 一致），对话框里可以按需开关是否使用工具调用。

## 技术栈

- **运行时**：Electron（仅打包 macOS，`npm run dist` 产出 DMG）
- **本地 AI**：`@xenova/transformers`（transformers.js，ONNX 运行时，纯 JS 无需 Python/GPU）跑在独立 `worker_thread` 里，不阻塞主进程/界面
- **向量库**：`@lancedb/lancedb`（嵌入式本地向量数据库，无需单独起服务）
- **元数据库**：`better-sqlite3`（documents / chunks / conversations / messages / favorites / settings，FTS5 trigram 做中文关键词检索）
- **文档解析**：`.md`/`.txt` 直接读，`.docx` 用 `mammoth`，`.pdf` 用 `pdf-parse`（基于文本层提取，扫描件/图片型 PDF 暂不支持 OCR，会被识别出来并标记为索引失败，不会静默产出空索引）
- **渲染**：`marked` + `DOMPurify`（Markdown 流式渲染，防 XSS）、自定义 token 配色的代码高亮（未使用 highlight.js 默认主题，手工配色贴合品牌）、`mermaid`（流程图/时序图渲染）
- **MCP**：`@modelcontextprotocol/sdk`

## 目录结构

```
main/                  # Electron 主进程
  db/                   # SQLite schema、gzip 压缩工具
  vector/                # LanceDB 封装
  ai/                    # 本地 embedding/rerank worker、LLM 客户端、Agent 循环
  ingest/                # 分块、文件解析、Obsidian 连接器、MD5 增量同步
  rag/                   # 混合检索
  mcp/                   # MCP 客户端管理
  index.js / ipc.js / preload.js / settings.js
renderer/               # 渲染进程（无打包器，直接引用 node_modules 里的 UMD/ESM 构建）
  index.html / app.js / styles.css
  vendor-src/, vendor/   # highlight.js 没有现成的浏览器全局构建，用 esbuild 单独打一个小 bundle
build/                  # 图标（icon.icns/icon.png）、吉祥物插画、electron-builder 输出目录
```

## 本地开发

前置条件：Node.js 18+（本项目用 Node 24 开发）、macOS（原生模块需要能编译）。

```bash
npm install
npm start        # 会先跑 build:vendor 生成 highlight.js 的浏览器 bundle，再启动 Electron
```

首次 `npm install` 后，如果启动时报 `NODE_MODULE_VERSION` 不匹配（Electron 内置的 Node ABI 和系统 Node 不一致，`better-sqlite3` 这类原生模块需要针对 Electron 重新编译），执行：

```bash
npx electron-rebuild -f -w better-sqlite3
```

## 配置说明

设置从应用内「设置」页填写，落盘在 `~/Library/Application Support/小怪兽知识库/settings.json`：

| 配置项 | 必填 | 说明 |
|--------|------|------|
| LLM Base URL | 是 | OpenAI 兼容的 `/v1` 地址 |
| API Key (SK) | 是 | 你自己的密钥 |
| 模型名称 | 是 | 例如 `deepseek-chat`、`gpt-4o` |
| 自定义请求头 | 否 | 部分网关需要额外 header |
| temperature / top_p / top_k / max_tokens | 否 | 高级参数，留空用默认值 |
| 系统提示词 | 否 | 留空用内置默认提示词 |
| MCP servers | 否 | JSON，格式同 Claude Desktop 的 `mcpServers` |

`autoSyncOnLaunch`（默认 `true`）和 `autoSyncIntervalMinutes`（默认 `20`）目前只能在 `settings.json` 里手动改，界面上还没做开关。作用：应用启动时、以及此后每隔这么多分钟，自动跑一遍 MD5 diff 同步——新增/改动的文件重新索引，磁盘上已经删掉的文件也会同步把索引和向量一起清掉。这一点对隐私很重要：如果不小心把带密码的文档导入了知识库，删掉原文件后索引会在下一轮自动同步里被清掉，不需要手动点"同步"才生效。

嵌入/重排模型是代码里固定的（`bge-small-zh-v1.5` + `bge-reranker-base`），首次使用会自动从 Hugging Face 下载并缓存到本地，之后离线运行。

## 数据存储位置

全部在 `~/Library/Application Support/小怪兽知识库/`：

- `kb.sqlite3`：文档元数据、分块正文、会话记录（gzip 压缩后落盘，减少长对话历史的磁盘占用）、收藏
- `lancedb/`：向量数据
- `models/`：本地 embedding/rerank 模型缓存
- `settings.json`：配置

## 打包

```bash
npm run dist    # 产出 macOS DMG，输出在 build/ 下（electron-builder 目录）
```

暂未做代码签名/公证，未签名应用在其他机器上首次打开需要手动放行（系统设置 → 隐私与安全性）。

## 已知限制 / 后续规划

- **OCR**：扫描件/图片型 PDF 目前没有文本层，不支持提取，会被标记为索引失败。
- **跨会话长期记忆**：目前的"记忆"是同一个会话内的完整历史，跨会话不共享。规划中的方案是加一张独立的事实记忆表（同一套本地 embedding），定期从对话里抽取用户画像/偏好，新会话开始时按当前问题检索相关事实注入 system prompt，并支持旧事实过期/更新，不是简单堆积。
- **Skill 加载**：架构上按"工具池"统一设计（MCP 工具、内置工具、未来的 Skill 加载工具都是同一个池子），暂未实现具体的 Skill 目录管理界面。规划是直接兼容 `~/.claude/skills/` 这类已有目录（读取 `SKILL.md` 的 frontmatter 当工具描述，选中后注入正文），不重新发明格式；不过只能复用"纯知识型"技能，依赖 Read/Bash 这类 Claude Code 专属工具的技能无法直接搬过来。
- **语音输入**：待做，计划支持配置语音转文本模型（如 Whisper 类模型）。
- **图片/更多文件类型 + 对象存储**：待做，构想是接入阿里云 OSS / 腾讯云 COS 之类的对象存储做图床，配合视觉模型理解图片内容。
- **自动更新检查**：待做，思路是启动时查一次 GitHub Releases API（`/repos/{owner}/{repo}/releases/latest`），比对版本号提示用户，不需要自建后端。真正的自动下载安装需要先解决代码签名/公证。
- **跨平台**：`package.json` 的 `build` 配置里已经写了 Linux（AppImage）/Windows（NSIS）的目标，但只在 macOS 上实际验证过，优先级低。

<p align="center">
  <img src="./build/icon.png" width="140" alt="knowhoard logo">
</p>

<h1 align="center">🐲 knowhoard · 小怪兽知识库</h1>
<p align="center"><i>本地优先的个人知识库问答客户端</i></p>

<p align="center">
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <img src="https://img.shields.io/badge/platform-macOS-lightgrey.svg" alt="Platform: macOS">
  <img src="https://img.shields.io/badge/Electron-33-47848F?logo=electron&logoColor=white" alt="Electron">
  <img src="https://img.shields.io/badge/Node.js-18%2B-339933?logo=nodedotjs&logoColor=white" alt="Node.js 18+">
  <img src="https://img.shields.io/badge/SQLite-FTS5-07405E?logo=sqlite&logoColor=white" alt="SQLite FTS5">
  <img src="https://img.shields.io/badge/LanceDB-Vector%20Store-FFCA28" alt="LanceDB">
  <img src="https://img.shields.io/badge/Obsidian-Vault%20Connector-7C3AED?logo=obsidian&logoColor=white" alt="Obsidian connector">
  <img src="https://img.shields.io/badge/MCP-Tool%20Calling-FF6B35" alt="MCP tool calling">
  <img src="https://img.shields.io/badge/Embedding-100%25%20Local-2EA44F" alt="100% local embedding">
</p>

把 Word / PDF / Markdown 文件或整个 Obsidian vault 接进来，本地做检索，你自己配置的大模型做问答，回答标注具体引用了哪份文档。

📖 [English](./README.md)

![对话视图：流式回答、思考模式、引用来源](./docs/screenshots/chat-view.png)

![设置视图：Token 用量图表、LLM 配置](./docs/screenshots/settings-token-usage.png)

---

## 🤔 这是什么，为什么要做

市面上的个人知识库工具（如 AnythingLLM）用"workspace"当检索边界——文档导进来还得手动挑、手动往某个 workspace 里嵌入，新增笔记不会自动进索引，每次都要重复"导入 → 选文档 → 保存嵌入"这套流程。对一个持续在长的个人笔记库来说，这个模型不对：应该是**配一次**，之后任何对话都自动检索全部内容，不需要为每次提问预先想清楚"这次该搜哪个文档"。

这个客户端就是照这个预期做的：数据源配好之后，所有对话默认能检索到全部已索引内容，不存在额外的"挑文档"步骤。

---

## ✨ 功能

- 💬 **和你的笔记聊天** —— 流式 Markdown 回答，支持 LaTeX 公式（KaTeX）、Mermaid 图表、代码高亮
- 🔍 **混合检索** —— 向量语义检索 + 关键词检索 + 文件名/路径匹配，融合后本地精排
- 🗂️ **Obsidian vault 连接器** —— 指定一个 vault，里面所有内容自动索引并保持同步
- 📄 **多格式接入** —— Markdown、纯文本、`.docx`、`.pdf`
- 🔗 **回答带引用** —— 每条回答都标注具体引用了哪份文档，点击可在 Finder 中定位
- ⭐ **收藏** —— 给任意回答加星标，在专门的"收藏" tab 里随时回看
- 🧠 **思考模式** —— 上游模型支持时展示推理过程，自动探测，不需要手动检测
- 🛠️ **MCP 工具调用** —— 接入你自己的 MCP server（配置格式与 Claude Desktop 一致），按对话开关是否启用工具
- 📊 **Token 用量看板** —— 按天/小时/分钟查看输入输出 token 曲线，附累计统计
- 🔄 **增量同步** —— 基于 MD5 内容哈希，没变的文件直接跳过；被删除的文件会自动从索引里清掉
- 🌓 **空闲感知的资源管理** —— 本地 AI 模型只在"空闲 + 系统确实繁忙"时才会卸载，之后自动透明重新加载
- 🔐 **隐私优先** —— 除了你提问时发给自己配置的 LLM 接口的那部分内容，没有任何数据离开这台电脑

---

## 💡 有什么创新点

- **没有"workspace"这道手续。** 同类工具要求先把文档手动分配到某个 workspace 才能被检索到；这里索引范围和检索范围是同一件事——加一个数据源，它就能被搜到，没有中间步骤。
- **要不要检索，交给模型自己判断，而不是写死的客户端规则。** 不是靠一堆正则/关键词列表去猜"1"这种短输入算不算该触发检索，而是让检索始终跑一遍（本地免费），再靠系统提示词让大模型自己判断检索到的内容跟这句话到底相不相关——更接近人类助理使用参考资料的方式。
- **引用编号前后一致。** 检索到的片段会先按"所属文档"分组、去重，再统一编号——模型在回答里用的 `[来源N]`，和界面上展示的引用卡片编号永远能对上，包括同一份文档命中多个片段的情况。
- **只展示真正用到的引用。** 界面上的引用卡片只显示回答里实际引用过的来源，不是把检索到的全部结果一股脑列出来——干扰更少，也不会意外暴露模型压根没用上的文件名。
- **真正的混合检索管线，不只是向量检索。** 文件名/路径匹配通过 RRF（Reciprocal Rank Fusion）和向量、关键词检索融合在一起，专门覆盖"记得文件名、记不清内容"这种纯语义检索容易漏掉的场景。

---

## 🚀 快速开始

```bash
git clone git@github.com:lymboy/knowhoard.git
cd knowhoard
npm install
npm start
```

就这样——应用窗口会打开，跟着首次启动的引导走一遍，指定一个目录或 Obsidian vault，就可以开始提问了。

> 前置条件：Node.js 18+（本项目用 Node 24 开发）、macOS（原生模块需要能在本机编译）。

首次启动如果报 `NODE_MODULE_VERSION` 不匹配（Electron 内置的 Node ABI 和系统 Node 不一致，`better-sqlite3` 这类原生模块需要针对 Electron 重新编译），执行：

```bash
npx electron-rebuild -f -w better-sqlite3
```

打包成可分发的 macOS 应用：

```bash
npm run dist    # 产出 DMG，输出在 dist/ 下
```

暂未做代码签名/公证，未签名应用在其他机器上首次打开需要手动放行（系统设置 → 隐私与安全性）。

---

## 🛠️ 技术栈

| 层级 | 选型 |
|---|---|
| 运行时 | Electron（目前只做 macOS 打包） |
| 本地 embedding + rerank | `@xenova/transformers`（transformers.js / ONNX，纯 JS，不需要 Python/GPU），跑在独立 `worker_thread` 里 |
| 向量库 | `@lancedb/lancedb`（嵌入式，不需要单独起服务） |
| 元数据库 | `better-sqlite3`，FTS5 trigram 分词器做中文关键词检索 |
| 文档解析 | `.md`/`.txt` 原生读取，`.docx` 用 `mammoth`，`.pdf` 用 `pdf-parse` |
| 渲染 | `marked` + `DOMPurify`、`mermaid`、KaTeX、自定义配色的代码高亮 |
| Agent 工具 | `@modelcontextprotocol/sdk`（MCP，stdio 传输） |

---

## 🗂️ 目录结构

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

---

## ⚙️ 配置说明

设置从应用内「设置」页填写，落盘在 `~/Library/Application Support/小怪兽知识库/settings.json`：

| 配置项 | 必填 | 说明 |
|---|---|---|
| 🔑 LLM Base URL | 是 | OpenAI 兼容的 `/v1` 地址 |
| 🔑 API Key (SK) | 是 | 你自己的密钥 |
| 🤖 模型名称 | 是 | 例如 `deepseek-chat`、`gpt-4o` |
| 🧾 自定义请求头 | 否 | 部分网关需要额外 header |
| 🎛️ temperature / top_p / top_k / max_tokens | 否 | 高级参数，留空用默认值 |
| 📝 系统提示词 | 否 | 留空用内置默认提示词 |
| 🛠️ MCP servers | 否 | JSON，格式同 Claude Desktop 的 `mcpServers` |

`autoSyncOnLaunch`（默认 `true`）和 `autoSyncIntervalMinutes`（默认 `20`）目前只能在 `settings.json` 里手动改，界面上还没做开关。作用：应用启动时、以及此后每隔这么多分钟，自动跑一遍 MD5 diff 同步——新增/改动的文件重新索引，磁盘上已经删掉的文件也会同步把索引和向量一起清掉，不需要手动点"同步"才生效。

嵌入/重排模型是代码里固定的（`bge-small-zh-v1.5` + `bge-reranker-base`），首次使用会自动从 Hugging Face 下载并缓存到本地，之后离线运行。

## 💾 数据存储位置

全部在 `~/Library/Application Support/小怪兽知识库/`：

- `kb.sqlite3`：文档元数据、分块正文、会话记录（gzip 压缩后落盘）、收藏
- `lancedb/`：向量数据
- `models/`：本地 embedding/rerank 模型缓存
- `settings.json`：配置

---

## 🗺️ 已知限制 / 后续规划

- 🖼️ **OCR** —— 扫描件/图片型 PDF 目前没有文本层，不支持提取，会被标记为索引失败。
- 🧵 **跨会话长期记忆** —— 目前的"记忆"是同一个会话内的完整历史，跨会话不共享。规划中的方案是加一张独立的事实记忆表，定期从对话里抽取用户画像/偏好，新会话开始时按当前问题检索相关事实注入 system prompt，支持旧事实过期/更新。
- 🧩 **Skill 加载** —— 架构上已经按"工具池"统一设计（MCP 工具、内置工具、未来的 Skill 加载工具同属一个池子），暂未实现具体的 Skill 目录管理界面。规划是直接兼容 `~/.claude/skills/` 这类已有目录。
- 🎙️ **语音输入** —— 待做，计划支持配置语音转文本模型。
- 🖼️ **图片/更多文件类型 + 对象存储** —— 待做，构想是接入阿里云 OSS / 腾讯云 COS 之类的对象存储做图床，配合视觉模型理解图片内容。
- 🔔 **自动更新检查** —— 待做，思路是启动时查一次 GitHub Releases API，比对版本号提示用户。
- 🪟 **跨平台** —— `package.json` 的 `build` 配置里已经写了 Linux（AppImage）/Windows（NSIS）的目标，但只在 macOS 上实际验证过，优先级低。

---

## 📄 License

MIT —— 见 [LICENSE](./LICENSE)。可以自由用于任何用途，**包括商业用途**，前提是保留版权声明和许可证文本，也就是注明来源于本仓库。

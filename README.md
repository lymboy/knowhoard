<p align="center">
  <img src="./build/icon.png" width="140" alt="knowhoard logo">
</p>

<h1 align="center">🐲 knowhoard</h1>
<p align="center"><i>小怪兽知识库 — a local-first personal knowledge base</i></p>

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

A **local-first** personal knowledge base desktop app. Point it at your Word / PDF / Markdown files, or an entire Obsidian vault — it indexes everything locally and lets you ask questions against your own notes using any OpenAI-compatible LLM you configure. Answers are grounded with citations back to the exact source document.

📖 [中文文档](./README.zh-CN.md)

![First-run onboarding: what it does and the privacy promise](./docs/screenshots/onboarding.png)

![Chat view: streaming answer with thinking mode and reasoning trace](./docs/screenshots/chat-view.png)

![Settings view: token usage chart and LLM configuration](./docs/screenshots/settings-token-usage.png)

---

## 🤔 Why this exists

Most personal knowledge base tools (e.g. AnythingLLM) use a "workspace" as the retrieval boundary — you have to manually pick documents and embed them into a specific workspace, and newly added notes don't automatically join the index. For a personal notes vault that keeps growing over time, that model is backwards: you should configure your sources **once**, and every conversation after that should search everything automatically.

That's the model this app follows: once your sources are configured, every conversation can retrieve from your full indexed content by default — no separate "pick documents" step, ever.

---

## ✨ Features

- 💬 **Chat with your notes** — streaming Markdown answers, LaTeX (KaTeX), Mermaid diagrams, syntax-highlighted code blocks
- 🔍 **Hybrid retrieval** — vector search + keyword search + filename/path matching, fused and reranked
- 🗂️ **Obsidian vault connector** — point at a vault, everything inside gets indexed and kept in sync
- 📄 **Multi-format ingestion** — Markdown, plain text, `.docx`, `.pdf` (including scanned/image-only PDFs via local OCR)
- 🔗 **Cited answers** — every response links back to the exact source document(s) it drew from, click-to-reveal in Finder
- ⭐ **Favorites** — star any answer and revisit it from a dedicated tab
- 🧠 **Thinking mode** — surfaces the model's reasoning trace when the upstream model supports it, auto-detected
- 🛠️ **MCP tool calling** — bring your own MCP servers (same config shape as Claude Desktop), toggle tool use per conversation
- 🌐 **Web search** — its own MCP server (Exa first, DuckDuckGo fallback), auto-registered and manageable from the MCP tools list
- 🧩 **Skill loading** — compatible with `~/.claude/skills/`-style directories; progressive loading keeps only name+description in the system prompt, full instructions fetched on demand
- 🧵 **Cross-session memory** — when you leave a conversation, a background pass distills durable facts about you (role, preferences, long-running projects) into a small memory store, injected into future conversations
- 📊 **Token usage dashboard** — input/output token charts by day / hour / minute, with running totals
- 🔄 **Incremental sync** — MD5 content hashing means unchanged files are skipped entirely; deleted files are cleaned out of the index automatically
- 🌓 **Idle-aware resource management** — the local AI model auto-unloads only when idle *and* the system is genuinely busy, and reloads transparently
- 🔐 **Privacy by design** — nothing leaves your machine except the prompt you send to *your own* configured LLM endpoint (OCR included — runs fully offline, no cloud API)

---

## 💡 What's different (the innovation points)

- **No "workspace" busywork.** Competing tools force you to manually assign documents to a workspace before they're searchable. Here, indexing and retrieval scope are the same thing — add a source, it's searchable, full stop.
- **Retrieval decisions are made by the model, not brittle client-side rules.** Instead of hand-written heuristics guessing whether a short message like `"1"` deserves a knowledge-base search, retrieval always runs (it's free and local) and the system prompt lets the LLM itself judge whether the retrieved content is actually relevant — closer to how a human assistant would use reference material.
- **Consistent citation numbering.** Retrieved chunks are grouped by source document *before* being numbered, so the `[来源N]` markers the model uses in its answer always line up 1:1 with the citation chips shown in the UI — including when multiple chunks from the same document are retrieved.
- **Citations are filtered to what's actually used.** The UI only shows citation chips for sources the model actually referenced in its answer, not everything that was retrieved — less noise, and no accidental exposure of filenames the model chose not to use.
- **A real hybrid retrieval pipeline, not just vector search.** Filename/path matching is fused in via Reciprocal Rank Fusion alongside vector and keyword search, specifically to cover "I remember the file name but not the content" — a common query pattern that pure semantic search misses.

---

## 🚀 Quick start

```bash
git clone git@github.com:lymboy/knowhoard.git
cd knowhoard
npm install
npm start
```

That's it — the app window opens, walk through the first-run onboarding, point it at a folder or an Obsidian vault, and start asking questions.

> Prerequisites: Node.js 18+ (developed on Node 24), macOS (native modules need to compile locally).

If the first launch throws a `NODE_MODULE_VERSION` mismatch (Electron's bundled Node ABI differs from your system Node — native modules like `better-sqlite3` need rebuilding against Electron's ABI), run:

```bash
npx electron-rebuild -f -w better-sqlite3
```

To build a distributable app:

```bash
npm run dist                        # macOS DMG (default, dist/)
npx electron-builder --linux        # Linux AppImage
npx electron-builder --win          # Windows NSIS installer
```

The macOS build isn't code-signed or notarized yet — on another machine, first launch requires manually allowing it (System Settings → Privacy & Security). Linux/Windows builds haven't been signed either, and haven't been run on a real machine of those platforms yet (see Roadmap).

---

## 🛠️ Tech stack

| Layer | Choice |
|---|---|
| Runtime | Electron (macOS DMG, Linux AppImage, Windows NSIS — mac fully verified, Linux/Windows packaging tested, not yet field-verified on real machines) |
| Renderer | Vite + Vue 3 + TDesign |
| Local embedding + rerank | `@xenova/transformers` (transformers.js / ONNX, pure JS, no Python/GPU), in a dedicated `worker_thread` |
| Vector store | `@lancedb/lancedb` (embedded, no server to run) |
| Metadata store | `better-sqlite3`, FTS5 trigram tokenizer for CJK keyword search |
| Document parsing | native `.md`/`.txt`, `mammoth` for `.docx`, `pdf-parse` for `.pdf`; `pdfjs-dist` + `@napi-rs/canvas` + `tesseract.js` for scanned PDFs (local OCR, bundled language packs) |
| Rendering | `marked` + `DOMPurify`, `mermaid`, KaTeX, `highlight.js` |
| Agent tools | `@modelcontextprotocol/sdk` (MCP, stdio transport) |

---

## 🗂️ Project layout

```
main/                  # Electron main process
  db/                    # SQLite schema (incl. facts table), gzip helpers
  vector/                # LanceDB wrapper
  ai/                    # local embedding/rerank worker, LLM client, agent loop
  ingest/                # chunking, file parsers (incl. OCR), Obsidian connector, MD5 incremental sync
  rag/                   # hybrid retrieval
  mcp/                   # MCP client management, web search MCP server
  skills/                # ~/.claude/skills/-compatible Skill scanning
  tools/                 # built-in tools (file access, web fetch, load_skill)
  index.js / ipc.js / preload.js / settings.js
renderer/               # renderer process — Vite + Vue 3 + TDesign, built to renderer/dist/
  App.vue / app-vue.js / store.js / markdown.js
  views/                 # top-level views (chat, settings, knowledge, favorites)
  vendor-src/components/ # chat bubbles, composer, conversation list, etc.
build/                  # icons (icns/ico/png), mascot artwork
resources/tessdata/     # bundled OCR language packs (chi_sim + eng)
```

---

## ⚙️ Configuration

Settings are entered from the in-app "设置" (Settings) page and persisted to `~/Library/Application Support/小怪兽知识库/settings.json`:

| Setting | Required | Notes |
|---|---|---|
| 🔑 LLM Base URL | Yes | An OpenAI-compatible `/v1` endpoint |
| 🔑 API Key (SK) | Yes | Your own key |
| 🤖 Model name | Yes | e.g. `deepseek-chat`, `gpt-4o` |
| 🧾 Custom headers | No | Some gateways require extra headers |
| 🎛️ temperature / top_p / top_k / max_tokens | No | Advanced params, defaults used when blank |
| 📝 System prompt | No | Falls back to the built-in default when blank |
| 🛠️ MCP servers | No | JSON, same shape as Claude Desktop's `mcpServers`; web search is registered here too |
| 🧩 Skills | No | Toggle individual skills found under `~/.claude/skills/`; unrecognized/disabled skills stay invisible to the model |
| 🧵 Cross-session memory | No | View and delete distilled facts from the "跨会话记忆" (Cross-session memory) panel |

`autoSyncOnLaunch` (default `true`) and `autoSyncIntervalMinutes` (default `20`) can currently only be changed by editing `settings.json` directly — no UI toggle yet. They control an automatic MD5-diff sync pass that runs on launch and every N minutes afterward: changed/new files get re-indexed, and files removed from disk have their index and vectors cleaned up too — without you having to remember to click "sync".

The embedding/rerank models are fixed in code (`bge-small-zh-v1.5` + `bge-reranker-base`); they're downloaded from Hugging Face and cached locally on first use, then run fully offline after that.

## 💾 Data storage location

Everything lives under `~/Library/Application Support/小怪兽知识库/`:

- `kb.sqlite3` — document metadata, chunk text, conversation history (gzip-compressed), favorites, distilled cross-session facts
- `lancedb/` — vector data
- `models/` — cached local embedding/rerank models
- `settings.json` — configuration

---

## 🗺️ Roadmap / known limitations

- 🎙️ **Voice input** — not yet implemented; planned support for a configurable speech-to-text model.
- 🖼️ **Images / more file types + object storage** — not yet implemented; planned object storage backend (e.g. Aliyun OSS / Tencent COS) paired with a vision model.
- 🔔 **Update checks** — not yet implemented; planned to query the GitHub Releases API on launch.
- 🪟 **Cross-platform field verification** — Linux (AppImage) / Windows (NSIS) packaging has been verified to build correctly on macOS via `electron-builder`'s cross-compilation, but neither has been installed and run on a real Linux/Windows machine yet.
- 🖼️ **OCR performance** — scanned PDFs are supported (local, offline), but OCR is CPU-heavy (several seconds to tens of seconds per page); large batches of scanned files will slow down sync noticeably. No pause/skip toggle yet.
- 🧵 **Memory extraction cost** — cross-session facts are distilled via one LLM call per conversation you leave (not per message), but this still means every conversation you navigate away from triggers a background completion request.

---

## 📄 License

MIT — see [LICENSE](./LICENSE). You're free to use this project for any purpose, **including commercial use**, as long as you keep the copyright notice and license text — i.e. credit this repository as the source.

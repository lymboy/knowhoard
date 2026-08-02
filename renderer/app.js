import "./lib-globals.js";
/* global marked, DOMPurify, hljs, mermaid, kb, renderMathInElement */

// Mermaid 主题跟随当前页面主题（亮/暗），不能写死深色——
// 亮色主题下深色节点配浅色文字完全看不清
const isDarkTheme = document.documentElement.dataset.theme === "dark";
mermaid.initialize({
  startOnLoad: false,
  theme: "base",
  securityLevel: "strict",
  flowchart: { useMaxWidth: false, htmlLabels: true, curve: "basis" },
  sequence: { useMaxWidth: false },
  gantt: { useMaxWidth: false },
  themeVariables: isDarkTheme
    ? {
        primaryColor: "#21262d",
        primaryTextColor: "#e6edf3",
        primaryBorderColor: "#8b949e",
        lineColor: "#8b949e",
        secondaryColor: "#161b22",
        tertiaryColor: "#0d1117",
        background: "transparent",
        mainBkg: "#21262d",
        nodeBorder: "#8b949e",
        clusterBkg: "transparent",
        clusterBorder: "#30363d",
        titleColor: "#e6edf3",
        edgeLabelBackground: "#161b22",
        textColor: "#e6edf3",
        fontSize: "14px",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif",
      }
    : {
        primaryColor: "#f6f8fa",
        primaryTextColor: "#1f2328",
        primaryBorderColor: "#57606a",
        lineColor: "#57606a",
        secondaryColor: "#ffffff",
        tertiaryColor: "#f6f8fa",
        background: "transparent",
        mainBkg: "#f6f8fa",
        nodeBorder: "#57606a",
        clusterBkg: "transparent",
        clusterBorder: "#d1d9e0",
        titleColor: "#1f2328",
        edgeLabelBackground: "#ffffff",
        textColor: "#1f2328",
        fontSize: "14px",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif",
      },
});

marked.setOptions({
  breaks: true,
  gfm: true,
});

const renderer = new marked.Renderer();
const originalCode = renderer.code.bind(renderer);
renderer.code = (token) => {
  // marked v15 的自定义 renderer 传的是一个 token 对象（{ text, lang, escaped }），
  // 不是旧版本那种 (code, infostring) 两个参数——之前一直按旧签名写，lang 永远取不到，
  // mermaid 代码块自然永远走不进下面这个分支
  const lang = (token.lang || "").trim().toLowerCase();
  if (lang === "mermaid") {
    // 先占位，真正的图交给 mermaid.run() 在插入 DOM 之后异步渲染
    const id = `mmd-${Math.random().toString(36).slice(2)}`;
    return `<div class="mermaid-block"><pre class="mermaid" id="${id}">${escapeHtml(token.text)}</pre></div>`;
  }
  return originalCode(token);
};
marked.use({ renderer });

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderMarkdown(text) {
  const html = marked.parse(text || "");
  return DOMPurify.sanitize(html, { ADD_TAGS: ["pre"] });
}

async function highlightAndRenderDiagrams(container) {
  container.querySelectorAll("pre code").forEach((block) => {
    if (block.closest(".mermaid")) return;
    hljs.highlightElement(block);
    wrapCodeBlockWithChrome(block);
  });
  const mermaidBlocks = container.querySelectorAll("pre.mermaid");
  if (mermaidBlocks.length) {
    try {
      await mermaid.run({ nodes: Array.from(mermaidBlocks) });
    } catch (err) {
      console.error("mermaid 渲染失败", err);
    }
  }
  try {
    renderMathInElement(container, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "\\[", right: "\\]", display: true },
        { left: "$", right: "$", display: false },
        { left: "\\(", right: "\\)", display: false },
      ],
      throwOnError: false,
    });
  } catch (err) {
    console.error("公式渲染失败", err);
  }
}

function wrapCodeBlockWithChrome(codeEl) {
  const pre = codeEl.parentElement;
  if (!pre || pre.parentElement?.classList.contains("code-block")) return; // 已经包过了
  const langMatch = (codeEl.className || "").match(/language-(\S+)/);
  const lang = langMatch ? langMatch[1] : "text";

  const wrapper = document.createElement("div");
  wrapper.className = "code-block";
  const header = document.createElement("div");
  header.className = "code-block-header";
  header.innerHTML = `<span class="lang">${escapeHtml(lang)}</span><button class="copy-btn">复制</button>`;
  header.querySelector(".copy-btn").addEventListener("click", () => {
    navigator.clipboard.writeText(codeEl.textContent || "");
    const btn = header.querySelector(".copy-btn");
    btn.textContent = "已复制";
    setTimeout(() => (btn.textContent = "复制"), 1500);
  });

  pre.parentElement.insertBefore(wrapper, pre);
  wrapper.appendChild(header);
  wrapper.appendChild(pre);
}

// ---------------- 自定义确认对话框（不用原生 confirm，这台机器上原生对话框不可靠）----------------
function showConfirm(message) {
  return new Promise((resolve) => {
    const overlay = el("confirmOverlay");
    el("confirmMessage").textContent = message;
    overlay.hidden = false;

    const cleanup = (result) => {
      overlay.hidden = true;
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      resolve(result);
    };
    const okBtn = el("confirmOkBtn");
    const cancelBtn = el("confirmCancelBtn");
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
  });
}

// iCloud 同步目录（Obsidian vault 常放在这）经常撞上 macOS 的隐私权限限制，
// 这种情况给个能直接跳转系统设置的入口，比让用户自己去翻"隐私与安全性"里哪一项管用得多
function showPermissionHelp(message) {
  return new Promise((resolve) => {
    const overlay = el("confirmOverlay");
    el("confirmMessage").textContent = message;
    overlay.hidden = false;
    const okBtn = el("confirmOkBtn");
    const cancelBtn = el("confirmCancelBtn");
    const prevOkText = okBtn.textContent;
    okBtn.textContent = "去系统设置开启权限";

    const cleanup = () => {
      overlay.hidden = true;
      okBtn.textContent = prevOkText;
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      resolve();
    };
    const onOk = () => {
      kb.shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles");
      cleanup();
    };
    const onCancel = cleanup;
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
  });
}

// ---------------- 状态 ----------------
const state = {
  view: "chat",
  conversations: [],
  activeConversationId: null,
  settings: null,
  mcpHasTools: false,
  toolsEnabled: true,
  thinkingSupported: false,
  sending: false,
  selecting: false,
  selectedMessageIds: new Set(),
};

const el = (id) => document.getElementById(id);

// 滚动跟随（isNearBottom/scrollToBottomIfFollowing）已迁到 Vue ChatView，由 watch messages 驱动。

// ---------------- 视图切换 ----------------
document.querySelectorAll(".nav-tab").forEach((tab) => {
  tab.addEventListener("click", () => switchView(tab.dataset.view));
});
function switchView(view) {
  state.view = view;
  document.querySelectorAll(".nav-tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  el(`view-${view}`).classList.add("active");
  // 会话列表是聊天视图专属的，切到知识库/设置时不该还留在侧边栏里，容易让人以为还在聊天上下文；
  // 用 visibility 而不是 display:none —— conversationList 是 flex:1，display:none 会让它让出空间，
  // 底下的模型状态栏就会往上飘，用 visibility 隐藏内容但保留占位，状态栏才能稳稳待在侧边栏底部
  el("conversationList").style.visibility = view === "chat" ? "" : "hidden";
  if (view === "knowledge") refreshKnowledgeView();
  if (view === "settings") refreshSettingsView();
  if (view === "favorites") refreshFavoritesView();
}

// ---------------- AI 状态 ----------------
// AI 状态栏已迁到 Vue（AiStatus.vue），由 store.aiStatus 驱动，app-vue.js 接 kb.ai.onStatus。
// 这里保留 setAiStatus 函数定义（兼容可能的旧引用），但不再监听事件，避免和 Vue 双写。
function setAiStatus(text, dotClass) {
  const t = document.getElementById("aiStatusText");
  const d = document.getElementById("aiStatusDot");
  if (t) t.textContent = text;
  if (d) d.className = `status-dot${dotClass ? " " + dotClass : ""}`;
}
// kb.ai.onStatus 已由 app-vue.js 接管，这里不再重复监听

// 批量删除消息的 DOM 绑定已迁到 Vue（ChatView.vue + MessageBubble.vue 的 checkbox）。
// updateSelectionUi / toggleSelectModeBtn / deleteSelectedBtn 这几个元素已不在 index.html，
// app.js 不再绑定，避免 el() 返回 null 报错。

// ---------------- 会话列表 ----------------
// 会话列表的 DOM 渲染和交互已迁到 Vue（ConversationList.vue），由 store.conversations 驱动。
// 这里 loadConversations 只负责刷新 state.conversations（供 app.js 自己读会话标题用）并同步到 store。
async function loadConversations() {
  state.conversations = await kb.conversations.list();
  // 同步到 Vue store（ConversationList 读 store.conversations）
  if (window.kbStore?.store) window.kbStore.store.conversations = state.conversations;
}

// 切会话：消息 DOM 已由 Vue ChatView 接管，这里只切视图 + 让 store 加载消息。
// 保留这个函数是因为收藏视图的「查看对话」会调它。
async function openConversation(id) {
  switchView("chat");
  // 走 store 的加载（更新 store.messages，ChatView 自动渲染）
  if (window.kbStore?.loadConversation) {
    await window.kbStore.loadConversation(id);
  }
}

// ---------------- 知识库视图 ----------------
async function refreshSourceStats() {
  const stats = await kb.documents.stats();
  el("statsBar").textContent = `文档 ${stats.documents} 篇 · 已索引 ${stats.indexed} 篇 · 分块 ${stats.chunks} 个`;

  const sources = await kb.sources.list();
  const list = el("sourceList");
  list.innerHTML = "";
  const typeLabel = { folder: "目录", file: "文件", obsidian_vault: "Obsidian Vault" };
  for (const s of sources) {
    const item = document.createElement("div");
    item.className = "source-item";
    const counts = s.counts || {};
    item.innerHTML = `
      <div>
        <div>${typeLabel[s.type] || s.type} · ${escapeHtml(s.label)}</div>
        <div class="meta">${escapeHtml(s.path)} · 已索引 ${counts.indexed || 0} / 出错 ${counts.error || 0}</div>
      </div>
      <div class="actions">
        <button data-action="sync">同步</button>
        <button data-action="remove">移除</button>
      </div>`;
    item.querySelector('[data-action="sync"]').addEventListener("click", async () => {
      await kb.sources.sync(s.id);
      refreshKnowledgeView();
    });
    item.querySelector('[data-action="remove"]').addEventListener("click", async () => {
      if (!(await showConfirm(`移除数据源「${s.label}」？已索引内容会一并删除，原始文件不受影响。`))) return;
      await kb.sources.remove(s.id);
      refreshKnowledgeView();
    });
    list.appendChild(item);
  }
}

async function refreshKnowledgeView() {
  await refreshSourceStats();
  await refreshDocList();
}

// ---------------- 收藏视图 ----------------
// favorites 视图还是原生 DOM（待迁 Vue），需要构造 citation chip。
// 对话层的 buildCitationChips 已随消息渲染一起删了，这里给 favorites 单独留一份。
function buildCitationChips(citations) {
  const citeWrap = document.createElement("div");
  citeWrap.className = "citations";
  citations.forEach((c, i) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "citation-chip";
    const isUrl = /^https?:\/\//.test(c.path);
    chip.title = isUrl ? `点击在浏览器中打开：${c.path}` : `点击在 Finder 中查看：${c.path}`;
    chip.textContent = `[来源${i + 1}] ${c.filename}`;
    chip.addEventListener("click", () => {
      if (isUrl) kb.shell.openExternal(c.path);
      else kb.documents.openInFinder(c.path);
    });
    citeWrap.appendChild(chip);
  });
  return citeWrap;
}

function formatFavoritedAt(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function refreshFavoritesView() {
  const list = el("favoritesList");
  const items = await kb.favorites.list();
  if (!items.length) {
    list.innerHTML = `<div class="empty-hint">还没有收藏任何消息——在对话气泡下方点「收藏」就会出现在这里。</div>`;
    return;
  }
  list.innerHTML = "";
  for (const fav of items) {
    const item = document.createElement("div");
    item.className = "favorite-item";
    const preview = document.createElement("div");
    preview.className = `favorite-preview markdown-body ${fav.role}`;
    preview.innerHTML = renderMarkdown(fav.content);
    item.innerHTML = `
      <div class="favorite-meta">
        <span class="favorite-conv-title">${escapeHtml(fav.conversationTitle)}</span>
        <span class="favorite-time">${formatFavoritedAt(fav.favoritedAt)}</span>
      </div>
    `;
    item.querySelector(".favorite-meta").insertAdjacentElement("afterend", preview);
    if (fav.citations && fav.citations.length) {
      preview.insertAdjacentElement("afterend", buildCitationChips(fav.citations));
    }
    const actions = document.createElement("div");
    actions.className = "favorite-actions";
    actions.innerHTML = `<button data-action="open">查看对话</button><button data-action="unfav">取消收藏</button>`;
    actions.querySelector('[data-action="open"]').addEventListener("click", () => openConversation(fav.conversationId));
    actions.querySelector('[data-action="unfav"]').addEventListener("click", async () => {
      await kb.favorites.remove(fav.id);
      refreshFavoritesView();
    });
    item.appendChild(actions);
    list.appendChild(item);
    highlightAndRenderDiagrams(preview);
  }
}

el("addSourceBtn").addEventListener("click", async () => {
  const ids = await kb.sources.add();
  if (ids && ids.length) refreshKnowledgeView();
});
el("syncAllBtn").addEventListener("click", async () => {
  el("syncLog").textContent = "同步中…";
  await kb.sources.sync(null);
  refreshKnowledgeView();
});

el("addObsidianBtn").addEventListener("click", async () => {
  const picker = el("obsidianVaultPicker");
  picker.hidden = false;
  picker.innerHTML = `<div class="hint">检测中…</div>`;

  const [status, existingSources] = await Promise.all([kb.obsidian.status(), kb.sources.list()]);
  if (!status.vaults.length) {
    picker.innerHTML = `<div class="hint">没有检测到 Obsidian vault，请先在 Obsidian 里打开过至少一个仓库。</div>`;
    return;
  }
  const connectedPaths = new Set(
    existingSources.filter((s) => s.type === "obsidian_vault").map((s) => s.path)
  );

  picker.innerHTML = "";
  const statusLine = document.createElement("div");
  statusLine.className = "hint";
  statusLine.textContent = `检测到 Obsidian ${status.running ? "正在运行" : "未运行"}，选一个要连接的 vault：`;
  picker.appendChild(statusLine);

  status.vaults.forEach((vault) => {
    const alreadyConnected = connectedPaths.has(vault.path);
    const row = document.createElement("div");
    row.className = "vault-option";
    row.innerHTML = `
      <div>
        <div>${escapeHtml(vault.name)}</div>
        <div class="meta">${escapeHtml(vault.path)}</div>
      </div>
      <button ${alreadyConnected ? "disabled" : ""}>${alreadyConnected ? "已连接" : "连接"}</button>`;
    if (alreadyConnected) return picker.appendChild(row);
    row.querySelector("button").addEventListener("click", async () => {
      await kb.sources.addObsidianVault(vault);
      picker.hidden = true;
      refreshKnowledgeView();
    });
    picker.appendChild(row);
  });
});

let lastStatsRefreshAt = 0;
kb.sources.onProgress((event) => {
  const logEl = el("syncLog");
  const line = {
    scanning: `扫描中：${event.source}`,
    "file-start": `索引中：${event.path} (${event.done}/${event.total})`,
    "file-skip": null, // 内容没变的文件不刷屏
    "file-done": `完成：${event.path}`,
    "file-error": `失败：${event.path} — ${event.error}`,
    deleted: `已移除：${event.path}`,
    done: `同步完成：${event.source}`,
    "scan-failed": `⚠️ 扫描失败，本次同步已中止，索引未改动：${event.error}`,
    "scan-suspicious": `⚠️ ${event.error}`,
  }[event.phase];
  if (line) logEl.textContent = line;

  // 同步跑起来的时候，"已索引 N / 出错 N" 这几个数字也要跟着动，不能等整个同步跑完才刷新——
  // 大批量同步动辄几十上百个文件，中途数字一直不变会让人以为卡住了。节流一下，不用每个文件都触发查询。
  if (state.view !== "knowledge") return;
  const isTerminal = ["file-done", "file-error", "deleted", "done"].includes(event.phase);
  const now = Date.now();
  if (isTerminal && (event.phase === "done" || now - lastStatsRefreshAt > 800)) {
    lastStatsRefreshAt = now;
    refreshSourceStats();
  }
});

async function refreshDocList() {
  const query = el("docSearchInput").value.trim();
  const docs = await kb.documents.list({ query });
  const list = el("docList");
  list.innerHTML = "";
  for (const d of docs) {
    const item = document.createElement("div");
    item.className = "doc-item";
    const errorBadge =
      d.status === "error"
        ? `<span class="doc-error-badge" title="${escapeHtml(d.error || "索引失败")}">⚠️ 索引失败</span>`
        : "";
    item.innerHTML = `
      <div>
        <div>${escapeHtml(d.filename)} ${errorBadge}</div>
        <div class="meta">${escapeHtml(d.folder)}</div>
      </div>
      <div class="actions">
        <button data-action="reveal">在 Finder 中显示</button>
        <button data-action="remove">移除</button>
      </div>`;
    item.querySelector('[data-action="reveal"]').addEventListener("click", () => kb.documents.openInFinder(d.path));
    item.querySelector('[data-action="remove"]').addEventListener("click", async () => {
      if (!(await showConfirm(`把「${d.filename}」从索引里移除？原始文件不受影响，随时可以重新同步加回来。`))) return;
      await kb.documents.removeOne(d.id);
      item.remove();
      refreshSourceStats();
    });
    list.appendChild(item);
  }
}
let docSearchTimer = null;
el("docSearchInput").addEventListener("input", () => {
  clearTimeout(docSearchTimer);
  docSearchTimer = setTimeout(refreshDocList, 250);
});

// ---------------- Token 用量统计 ----------------
function formatTokens(n) {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return String(n);
}

let currentGranularity = "day";
async function refreshTokenUsage() {
  const usage = await kb.stats.tokenUsage({ granularity: currentGranularity });
  el("usageToday").textContent = `输入 ${formatTokens(usage.today.prompt)} · 输出 ${formatTokens(usage.today.completion)}`;
  el("usageWeek").textContent = `输入 ${formatTokens(usage.thisWeek.prompt)} · 输出 ${formatTokens(usage.thisWeek.completion)}`;
  el("usageMonth").textContent = `输入 ${formatTokens(usage.thisMonth.prompt)} · 输出 ${formatTokens(usage.thisMonth.completion)}`;
  drawUsageChart(usage.series);
}

document.querySelectorAll(".granularity-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    currentGranularity = btn.dataset.granularity;
    document.querySelectorAll(".granularity-btn").forEach((b) => b.classList.toggle("active", b === btn));
    refreshTokenUsage();
  });
});

// 按天的桶是"YYYY-MM-DD"，按小时/按分钟带了空格和冒号（"YYYY-MM-DD HH:00"/"HH:MM"），
// 标签格式得分开处理，不然按小时/分钟时朝标签里会把时间部分错当成日期的一部分
function formatBucketLabel(bucket) {
  const [datePart, timePart] = bucket.split(" ");
  const [, m, d] = datePart.split("-");
  if (!timePart) return `${m}/${d}`;
  return currentGranularity === "hour" ? `${m}/${d} ${timePart.slice(0, 2)}时` : `${timePart}`;
}

// token 数量比较大时（几千、几万）直接打印全数字很占地方，折算成 xk 更好读
function formatTokenCount(v) {
  if (v >= 1000) {
    const k = v / 1000;
    return (Number.isInteger(k) ? k : k.toFixed(1)) + "k";
  }
  return String(Math.round(v));
}

// SVG 内部坐标系（viewBox）之前写死 700x180，配合 preserveAspectRatio="none" 和
// CSS width:100% 拉伸——窗口一放大，容器实际像素宽度远超 700，水平方向被拉伸的倍数
// 就比垂直方向大很多，圆点被拉成椭圆、文字也跟着变形，看起来就是"分辨率变差"。
// 根治办法：viewBox 跟着 SVG 元素实际渲染出来的像素尺寸走，横纵缩放比始终是 1:1，
// 拉伸就无从谈起。用 ResizeObserver 盯着窗口变化，尺寸一变就用同一份数据重绘一次。
let lastUsageSeries = null;
function drawUsageChart(series) {
  if (series) lastUsageSeries = series;
  else series = lastUsageSeries;
  if (!series) return;

  const svg = el("usageChart");
  const rect = svg.getBoundingClientRect();
  const W = Math.max(1, Math.round(rect.width)) || 700;
  const H = Math.max(1, Math.round(rect.height)) || 180;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const padTop = 12;
  const padBottom = 28;
  // 左边留出 Y 轴刻度文字的位置；X 轴首尾标签也需要留白，不然文字会被 viewBox 边界切掉
  const padLeft = 34;
  const padRight = 28;
  const maxVal = Math.max(1, ...series.flatMap((d) => [d.prompt, d.completion]));
  const plotW = W - padLeft - padRight;
  const stepX = plotW / Math.max(1, series.length - 1);
  const toY = (v) => padTop + (1 - v / maxVal) * (H - padTop - padBottom);
  const toX = (i) => padLeft + i * stepX;

  const buildPath = (key) =>
    series.map((d, i) => `${toX(i)},${toY(d[key])}`).join(" ");

  // Y 轴：底部（0）、中间、顶部（maxVal）三条刻度线 + 量纲文字
  const yTicks = [0, 0.5, 1].map((frac) => {
    const val = maxVal * frac;
    const y = toY(val);
    return `
      <line x1="${padLeft}" y1="${y}" x2="${W - padRight}" y2="${y}" stroke="var(--border)" stroke-width="1" stroke-dasharray="${frac === 0 ? "0" : "3,3"}" />
      <text x="${padLeft - 8}" y="${y + 3}" font-size="10" fill="var(--text-dim)" text-anchor="end">${formatTokenCount(val)}</text>
    `;
  }).join("");

  // 桶数量最多到 100（按小时/按分钟时），全标会挤成一团黑，只挑几个点标；
  // 首尾两个标签的 text-anchor 改成 start/end（而不是 middle），避免文字中心对齐在图表
  // 最边缘的点上时，一半字宽越界跑到 viewBox 外面被裁掉
  const labelCount = Math.min(6, series.length);
  const labelStep = Math.max(1, Math.floor(series.length / labelCount));
  const dayLabels = series
    .map((d, i) => {
      const isLast = i === series.length - 1;
      if (i % labelStep !== 0 && !isLast) return "";
      const anchor = i === 0 ? "start" : isLast ? "end" : "middle";
      return `<text x="${toX(i)}" y="${H - 8}" font-size="10" fill="var(--text-dim)" text-anchor="${anchor}">${formatBucketLabel(d.day)}</text>`;
    })
    .join("");

  const dotsFor = (key, color) =>
    series
      .map((d, i) => `<circle cx="${toX(i)}" cy="${toY(d[key])}" r="2.5" fill="${color}" />`)
      .join("");

  svg.innerHTML = `
    ${yTicks}
    <polyline points="${buildPath("prompt")}" fill="none" stroke="var(--accent)" stroke-width="2" />
    <polyline points="${buildPath("completion")}" fill="none" stroke="#8fd6ff" stroke-width="2" />
    ${dotsFor("prompt", "var(--accent)")}
    ${dotsFor("completion", "#8fd6ff")}
    ${dayLabels}
  `;
}

// 窗口拉伸/最大化会改变 SVG 实际渲染宽度，用同一份数据按新尺寸重绘，避免上面说的拉伸变形；
// 用 rAF 节流一下，拖拽调整窗口大小时 resize 回调本身就很密集
let usageChartResizeRaf = null;
new ResizeObserver(() => {
  if (usageChartResizeRaf) return;
  usageChartResizeRaf = requestAnimationFrame(() => {
    usageChartResizeRaf = null;
    drawUsageChart();
  });
}).observe(el("usageChart"));

// ---------------- 设置视图 ----------------
let mcpServersDraft = {};

const BUILTIN_TOOL_LABELS = {
  read_file: { icon: "📄", label: "读取文件", hint: "读取指定文件的完整内容" },
  list_directory: { icon: "📁", label: "浏览目录", hint: "列出目录下的文件和子目录" },
  search_files: { icon: "🔍", label: "搜索文件", hint: "按关键词在文件中全文搜索" },
  web_search: { icon: "🌐", label: "网络搜索", hint: "在互联网上搜索信息，用于调研任务" },
  fetch_url: { icon: "🔗", label: "抓取网页", hint: "获取指定 URL 的网页内容" },
  download_file: { icon: "⬇️", label: "下载文件", hint: "下载文件到本地沙箱目录（只存不执行）" },
};

async function renderBuiltinToolList() {
  const list = el("builtinToolList");
  list.innerHTML = "";
  let tools;
  try {
    tools = await kb.builtinTools.list();
  } catch {
    list.innerHTML = `<div class="hint">无法加载内置工具列表</div>`;
    return;
  }
  for (const tool of tools) {
    const meta = BUILTIN_TOOL_LABELS[tool.name] || { icon: "🔧", label: tool.name, hint: "" };
    const item = document.createElement("div");
    item.className = "builtin-tool-item";
    item.innerHTML = `
      <div class="builtin-tool-info">
        <div class="builtin-tool-name">${meta.icon} ${escapeHtml(meta.label)}</div>
        <div class="meta">${escapeHtml(meta.hint)}</div>
      </div>
      <label class="toggle-switch">
        <input type="checkbox" ${tool.enabled ? "checked" : ""} />
        <span class="toggle-slider"></span>
      </label>`;
    item.querySelector("input").addEventListener("change", async (e) => {
      const updated = await kb.builtinTools.toggle(tool.name, e.target.checked);
      updateToolAvailability(await kb.mcp.hasTools());
    });
    list.appendChild(item);
  }
}

function renderHeaderRows(headers) {
  const container = el("customHeaderRows");
  container.innerHTML = "";
  const entries = Object.entries(headers || {});
  if (!entries.length) entries.push(["", ""]);
  entries.forEach(([key, value]) => addHeaderRow(key, value));
}

function addHeaderRow(key = "", value = "") {
  const row = document.createElement("div");
  row.className = "header-row";
  row.innerHTML = `
    <input type="text" placeholder="请求头名称，例如 X-Api-Version" class="header-key" value="${escapeHtml(key)}" />
    <input type="text" placeholder="请求头值" class="header-value" value="${escapeHtml(value)}" />
    <button type="button" class="remove-row-btn" title="删除">−</button>`;
  row.querySelector(".remove-row-btn").addEventListener("click", () => row.remove());
  el("customHeaderRows").appendChild(row);
}

el("addHeaderRowBtn").addEventListener("click", () => addHeaderRow());

function collectCustomHeaders() {
  const headers = {};
  el("customHeaderRows")
    .querySelectorAll(".header-row")
    .forEach((row) => {
      const key = row.querySelector(".header-key").value.trim();
      const value = row.querySelector(".header-value").value.trim();
      if (key) headers[key] = value;
    });
  return headers;
}

function renderMcpServerList() {
  const list = el("mcpServerList");
  list.innerHTML = "";
  const entries = Object.entries(mcpServersDraft);
  if (!entries.length) {
    list.innerHTML = `<div class="hint">还没有配置任何 MCP 工具。</div>`;
    return;
  }
  entries.forEach(([name, cfg]) => {
    const item = document.createElement("div");
    item.className = "mcp-server-item";
    item.innerHTML = `
      <div>
        <div>${escapeHtml(name)}</div>
        <div class="meta">${escapeHtml(cfg.command)} ${escapeHtml((cfg.args || []).join(" "))}</div>
      </div>
      <button type="button" class="remove-row-btn">移除</button>`;
    item.querySelector("button").addEventListener("click", async () => {
      delete mcpServersDraft[name];
      renderMcpServerList();
      await kb.settings.update({ mcpServers: mcpServersDraft });
      await kb.mcp.reconnect();
      updateToolAvailability(await kb.mcp.hasTools());
    });
    list.appendChild(item);
  });
}

el("addMcpServerBtn").addEventListener("click", async () => {
  const mcpResult = el("mcpResult");
  const name = el("mcpNewName").value.trim();
  const command = el("mcpNewCommand").value.trim();
  const args = el("mcpNewArgs").value.trim().split(/\s+/).filter(Boolean);
  if (!name || !command) {
    mcpResult.textContent = "服务名称和启动命令不能为空";
    return;
  }
  mcpServersDraft[name] = { command, args };
  renderMcpServerList();
  el("mcpNewName").value = "";
  el("mcpNewCommand").value = "";
  el("mcpNewArgs").value = "";

  mcpResult.textContent = "连接中…";
  await kb.settings.update({ mcpServers: mcpServersDraft });
  const results = await kb.mcp.reconnect();
  const thisResult = results.find((r) => r.name === name);
  mcpResult.textContent = thisResult?.ok
    ? `已连接，发现 ${thisResult.toolCount} 个工具`
    : `连接失败：${thisResult?.error || "未知错误"}`;
  updateToolAvailability(await kb.mcp.hasTools());
});

el("toolsMasterToggle").addEventListener("change", async (e) => {
  state.toolsEnabled = e.target.checked;
  await kb.settings.update({ toolsEnabled: e.target.checked });
});

el("saveExaBtn").addEventListener("click", async () => {
  const key = el("exaApiKey").value.trim();
  await kb.settings.update({ exaApiKey: key });
  el("exaSaveHint").textContent = key ? "已保存，搜索将使用 Exa AI" : "已保存，搜索将使用 DuckDuckGo";
  setTimeout(() => (el("exaSaveHint").textContent = ""), 3000);
});

function setModelPickerMode(useSelect) {
  el("llmModelSelect").hidden = !useSelect;
  el("llmModel").hidden = useSelect;
}

async function refreshModelList() {
  const hint = el("modelListHint");
  const baseUrl = el("llmBaseUrl").value.trim();
  const apiKey = el("llmApiKey").value.trim();
  if (!baseUrl || !apiKey) return;
  hint.textContent = "拉取模型列表中…";
  const result = await kb.llm.listModels({ baseUrl, apiKey, customHeaders: collectCustomHeaders() });
  const select = el("llmModelSelect");

  if (result.success && result.models.length) {
    // 拉到了就换成真正的下拉框——不用再让用户对着接口文档手抄模型名
    const currentValue = el("llmModel").value.trim();
    select.innerHTML = "";
    result.models.forEach((id) => {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = id;
      select.appendChild(opt);
    });
    if (currentValue && !result.models.includes(currentValue)) {
      const opt = document.createElement("option");
      opt.value = currentValue;
      opt.textContent = `${currentValue}（当前配置，不在拉取到的列表里）`;
      select.appendChild(opt);
    }
    select.value = currentValue || result.models[0];
    setModelPickerMode(true);
    hint.textContent = `已拉取 ${result.models.length} 个可选模型`;
  } else {
    setModelPickerMode(false);
    hint.textContent = "没拉到模型列表（该接口可能不支持），手动填模型名称就行";
  }
}
el("llmApiKey").addEventListener("blur", refreshModelList);
el("llmBaseUrl").addEventListener("blur", refreshModelList);

async function refreshSettingsView() {
  const settings = await kb.settings.get();
  state.settings = settings;
  el("llmBaseUrl").value = settings.llm.baseUrl || "";
  el("llmApiKey").value = settings.llm.apiKey || "";
  el("llmModel").value = settings.llm.model || "";
  renderHeaderRows(settings.llm.customHeaders);
  el("llmTemperature").value = settings.llm.temperature ?? 0.7;
  el("llmTopP").value = settings.llm.topP ?? 1;
  el("llmTopK").value = settings.llm.topK || "";
  el("llmMaxTokens").value = settings.llm.maxTokens || "";
  el("systemPromptInput").value = settings.systemPrompt || "";

  mcpServersDraft = { ...(settings.mcpServers || {}) };
  renderMcpServerList();
  await renderBuiltinToolList();

  // 工具总开关
  state.toolsEnabled = settings.toolsEnabled !== false; // 默认开启
  el("toolsMasterToggle").checked = state.toolsEnabled;

  // Exa API key
  el("exaApiKey").value = settings.exaApiKey || "";

  const mcpHasTools = await kb.mcp.hasTools();
  updateToolAvailability(mcpHasTools);

  if (settings.llm.baseUrl && settings.llm.apiKey) refreshModelList();
  refreshTokenUsage();
}

function collectLlmConfig() {
  const model = el("llmModelSelect").hidden
    ? el("llmModel").value.trim()
    : el("llmModelSelect").value;
  return {
    baseUrl: el("llmBaseUrl").value.trim(),
    apiKey: el("llmApiKey").value.trim(),
    model,
    customHeaders: collectCustomHeaders(),
    temperature: parseFloat(el("llmTemperature").value) || 0.7,
    topP: parseFloat(el("llmTopP").value) || 1,
    topK: el("llmTopK").value.trim(),
    maxTokens: el("llmMaxTokens").value.trim(),
  };
}

async function probeThinkingAndSave() {
  el("thinkingProbeResult").textContent = "检测中…";
  const result = await kb.llm.probeThinking(collectLlmConfig());
  el("thinkingProbeResult").textContent = result.supported
    ? "支持思考模式 ✓"
    : `不支持（${result.reason || "未探测到 reasoning 字段"}）`;
  updateThinkingToggleVisibility(result.supported);
  // 检测结果要存下来，不然每次重启都得重新点一遍才能看到思考模式开关，太烦
  await kb.settings.update({ llm: { thinkingSupported: result.supported } });
}

el("saveLlmBtn").addEventListener("click", async () => {
  const llm = collectLlmConfig();
  await kb.settings.update({ llm });
  el("llmSaveHint").textContent = "已保存，正在自动检测是否支持思考模式…";
  // 保存配置之后直接顺手探测一次，不用用户再单独点一个"检测"按钮
  probeThinkingAndSave().then(() => {
    el("llmSaveHint").textContent = "已保存";
    setTimeout(() => (el("llmSaveHint").textContent = ""), 2000);
  });
});

el("testThinkingBtn").addEventListener("click", probeThinkingAndSave);

el("saveSystemPromptBtn").addEventListener("click", async () => {
  await kb.settings.update({ systemPrompt: el("systemPromptInput").value });
  el("systemPromptSaveHint").textContent = "已保存";
  setTimeout(() => (el("systemPromptSaveHint").textContent = ""), 2000);
});

// 工具可用性 / 思考模式开关可见性：同步到 Vue store，Composer 读 store 决定是否显示思考模式开关、
// 是否允许工具调用。思考模式开关现在是 Composer 内部（v-if store.thinkingSupported），不再有 #thinkingToggle 元素。
function updateToolAvailability(hasTools) {
  state.mcpHasTools = hasTools;
  if (window.kbStore?.store) window.kbStore.store.mcpHasTools = hasTools;
}
function updateThinkingToggleVisibility(supported) {
  state.thinkingSupported = supported;
  if (window.kbStore?.store) window.kbStore.store.thinkingSupported = supported;
}

// ---------------- 外部链接一律走系统默认程序打开（mailto / http 等）----------------
document.addEventListener("click", (e) => {
  const link = e.target.closest("a[href]");
  if (!link) return;
  const href = link.getAttribute("href");
  if (/^(mailto:|https?:)/i.test(href)) {
    e.preventDefault();
    kb.shell.openExternal(href);
  }
});

// ---------------- 首次启动引导 ----------------
async function maybeShowOnboarding() {
  const settings = await kb.settings.get();
  if (settings.hasSeenOnboarding) return;
  el("onboardingOverlay").hidden = false;
}
el("onboardingDismiss").addEventListener("click", async () => {
  el("onboardingOverlay").hidden = true;
  await kb.settings.update({ hasSeenOnboarding: true });
});
// 菜单栏"帮助 > 关于"手动触发重看引导弹窗——跳过 hasSeenOnboarding 判断，
// 这是用户主动要看，不是首次启动那次自动弹出
kb.app.onShowOnboarding(() => {
  el("onboardingOverlay").hidden = false;
});

// ---------------- 桥接：暴露给 Vue 组件（ConversationList 等）调用的回调 ----------------
// app.js 先于 app-vue.js 执行，这里挂自己的命名空间 window.kbAppBridge，不依赖 app-vue.js 的 kbStore。
// Vue 组件切会话/删除时通过这个 bridge 调 app.js 的 switchView/showConfirm；
// 消息 DOM 和顶部标题已由 ChatView 接管，不再需要 setChatTitle。
window.kbAppBridge = {
  // 切视图（ConversationList 切会话后调，把对话视图亮出来）
  switchView,
  // 复用 app.js 的自定义确认框（还没迁 Vue）
  showConfirm,
};

// ---------------- 初始化 ----------------
(async function init() {
  await maybeShowOnboarding();
  await loadConversations();
  const hasTools = await kb.mcp.hasTools();
  updateToolAvailability(hasTools);
  // 思考模式支不支持这个探测结果是存过的，启动时直接读出来用，不用每次都重新点一次检测按钮
  const settings = await kb.settings.get();
  updateThinkingToggleVisibility(!!settings.llm.thinkingSupported);
})();

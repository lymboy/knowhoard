/* global marked, DOMPurify, hljs, mermaid, kb, renderMathInElement */

mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });

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
  thinkingSupported: false,
  sending: false,
  selecting: false,
  selectedMessageIds: new Set(),
};

const el = (id) => document.getElementById(id);

const NEAR_BOTTOM_THRESHOLD = 80;
function isNearBottom(container) {
  return container.scrollHeight - container.scrollTop - container.clientHeight < NEAR_BOTTOM_THRESHOLD;
}
function scrollToBottomIfFollowing() {
  const wrap = el("messages");
  if (isNearBottom(wrap)) wrap.scrollTop = wrap.scrollHeight;
}

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
// 之前这里直接 bar.textContent = ... 把整个容器的文本全覆盖掉了，连带把里面那个状态点
// <span id="aiStatusDot"> 一起清没了——所以样式改的类名从来没生效过。改成分别更新文字和点的样式。
function setAiStatus(text, dotClass) {
  el("aiStatusText").textContent = text;
  el("aiStatusDot").className = `status-dot${dotClass ? " " + dotClass : ""}`;
}
kb.ai.onStatus((status) => {
  if (status.phase === "loading-model") {
    const pct = status.progress ? Math.round(status.progress) + "%" : "";
    setAiStatus(`本地检索模型加载中… ${status.file || ""} ${pct}`, "loading");
  } else if (status.phase === "worker-started") {
    setAiStatus("本地检索模型加载中…", "loading");
  } else if (status.phase === "ready") {
    setAiStatus("本地检索模型已就绪", "ready");
  } else if (status.phase === "unloaded") {
    setAiStatus("本地检索模型：已因空闲卸载，下次提问会自动重新加载", "");
  }
});

// ---------------- 批量删除消息 ----------------
function updateSelectionUi() {
  const count = state.selectedMessageIds.size;
  const countEl = el("selectionCount");
  const delBtn = el("deleteSelectedBtn");
  countEl.hidden = !state.selecting;
  delBtn.hidden = !state.selecting || count === 0;
  countEl.textContent = state.selecting ? `已选 ${count} 条` : "";
}

el("toggleSelectModeBtn").addEventListener("click", () => {
  state.selecting = !state.selecting;
  document.getElementById("app").classList.toggle("selecting", state.selecting);
  el("toggleSelectModeBtn").classList.toggle("active", state.selecting);
  el("toggleSelectModeBtn").textContent = state.selecting ? "取消批量" : "批量删除";
  if (!state.selecting) {
    state.selectedMessageIds.clear();
    document.querySelectorAll(".msg-select-checkbox").forEach((cb) => (cb.checked = false));
    document.querySelectorAll(".msg.selected").forEach((m) => m.classList.remove("selected"));
  }
  updateSelectionUi();
});

el("deleteSelectedBtn").addEventListener("click", async () => {
  const ids = Array.from(state.selectedMessageIds);
  if (!ids.length) return;
  if (!(await showConfirm(`删除选中的 ${ids.length} 条消息？删除后无法恢复。`))) return;
  await kb.messages.deleteMany(ids);
  ids.forEach((id) => {
    const msgEl = document.querySelector(`.msg[data-message-id="${id}"]`);
    if (msgEl) msgEl.remove();
  });
  state.selectedMessageIds.clear();
  updateSelectionUi();
});

// ---------------- 会话列表 ----------------
async function loadConversations() {
  state.conversations = await kb.conversations.list();
  const wrap = el("conversationItems");
  wrap.innerHTML = "";
  for (const conv of state.conversations) {
    const item = document.createElement("div");
    item.className = "conversation-item" + (conv.id === state.activeConversationId ? " active" : "");
    item.innerHTML = `<span class="title" title="双击重命名">${escapeHtml(conv.title)}</span><button class="del" title="删除">×</button>`;
    const titleEl = item.querySelector(".title");
    // 双击会先触发两次 click、才轮到 dblclick——之前 click 直接调 openConversation()，
    // 它内部会 loadConversations() 把整个列表 DOM 重建一遍，等 dblclick 真正触发时，
    // 这里捕获的 titleEl 早就是个不在文档里的旧节点了，replaceWith 换的是个没人看得见的幽灵节点。
    // 用一个小延迟分辨单击/双击：单击先等一下，真等到双击就取消单击那次动作。
    let clickTimer = null;
    titleEl.addEventListener("click", () => {
      if (clickTimer) return;
      clickTimer = setTimeout(() => {
        clickTimer = null;
        openConversation(conv.id);
      }, 250);
    });
    titleEl.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      clearTimeout(clickTimer);
      clickTimer = null;
      // 标题是从第一条消息自动摘出来的，可能正好摘到敏感内容——支持双击手动改成别的文案，
      // 别人瞄一眼侧边栏不至于直接看到原始问题
      const input = document.createElement("input");
      input.type = "text";
      input.className = "title-edit-input";
      input.value = conv.title;
      titleEl.replaceWith(input);
      input.focus();
      input.select();
      const commit = async () => {
        const newTitle = input.value.trim() || conv.title;
        if (newTitle !== conv.title) await kb.conversations.rename(conv.id, newTitle);
        loadConversations();
      };
      input.addEventListener("blur", commit);
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") input.blur();
        if (ev.key === "Escape") {
          input.value = conv.title;
          input.blur();
        }
      });
    });
    item.querySelector(".del").addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!(await showConfirm(`删除会话「${conv.title}」？`))) return;
      await kb.conversations.remove(conv.id);
      if (state.activeConversationId === conv.id) {
        state.activeConversationId = null;
        el("messages").innerHTML = "";
      }
      loadConversations();
    });
    wrap.appendChild(item);
  }
}

el("newConversationBtn").addEventListener("click", async () => {
  const id = await kb.conversations.create("新会话");
  state.activeConversationId = id;
  await loadConversations();
  el("messages").innerHTML = "";
  el("chatTitle").textContent = "新会话";
  pageState = { conversationId: id, oldestCreatedAt: null, hasMore: false, loadingOlder: false };
  switchView("chat");
});

// 惰性分页：进会话只取最近一页；往上滑到接近顶部再取更早一页往前拼。
// 每一页后端已经保证内部是正序（旧→新），这里只管"整页往前插"，不打乱页内顺序、不跟别的会话串。
const PAGE_SIZE = 30;
const LOAD_MORE_SCROLL_THRESHOLD = 80;
let pageState = { conversationId: null, oldestCreatedAt: null, hasMore: false, loadingOlder: false };

function renderHistoryMessage(m, prepend) {
  return appendMessageBubble(
    m.role,
    { content: m.content, reasoning: m.reasoning, citations: m.citations, id: m.id, favorited: m.favorited },
    prepend
  );
}

async function openConversation(id) {
  state.activeConversationId = id;
  switchView("chat");
  await loadConversations();
  const conv = state.conversations.find((c) => c.id === id);
  el("chatTitle").textContent = conv ? conv.title : "";

  const wrap = el("messages");
  wrap.innerHTML = "";
  const { messages, hasMore } = await kb.conversations.getMessages(id, { limit: PAGE_SIZE });
  for (const m of messages) renderHistoryMessage(m, false);
  pageState = {
    conversationId: id,
    oldestCreatedAt: messages[0]?.created_at ?? null,
    hasMore,
    loadingOlder: false,
  };
  wrap.scrollTop = wrap.scrollHeight;
}

el("messages").addEventListener("scroll", async () => {
  const wrap = el("messages");
  if (wrap.scrollTop > LOAD_MORE_SCROLL_THRESHOLD) return;
  if (pageState.loadingOlder || !pageState.hasMore) return;
  if (pageState.conversationId !== state.activeConversationId) return;

  pageState.loadingOlder = true;
  const prevScrollHeight = wrap.scrollHeight;
  const prevScrollTop = wrap.scrollTop;
  try {
    const { messages, hasMore } = await kb.conversations.getMessages(state.activeConversationId, {
      beforeCreatedAt: pageState.oldestCreatedAt,
      limit: PAGE_SIZE,
    });
    if (messages.length) {
      // 这一页内部是正序（旧→新）。prepend 每次都插在"当前最前面"，所以要倒着插——
      // 先插这页最新的一条，最后插这页最旧的一条，最旧的才会真正落到整个列表最前面，
      // 页内顺序才不会被"每次插到最前面"这个操作反过来
      for (let i = messages.length - 1; i >= 0; i--) renderHistoryMessage(messages[i], true);
      pageState.oldestCreatedAt = messages[0].created_at;
      pageState.hasMore = hasMore;
      // 往上插入内容会把已有内容往下推，不修正的话视觉上会突然跳一下——
      // 用高度差补一下 scrollTop，让用户感觉不到内容是从上面插进来的
      wrap.scrollTop = prevScrollTop + (wrap.scrollHeight - prevScrollHeight);
    } else {
      pageState.hasMore = false;
    }
  } finally {
    pageState.loadingOlder = false;
  }
});

// ---------------- 消息渲染 ----------------
const rawTextByMsgEl = new WeakMap();

function buildBubbleActions(msg, messageId, favorited) {
  const wrap = document.createElement("div");
  wrap.className = "bubble-actions";
  wrap.innerHTML = `<button data-act="copy">复制</button><button data-act="fav">${favorited ? "★ 已收藏" : "☆ 收藏"}</button>`;

  wrap.querySelector('[data-act="copy"]').addEventListener("click", () => {
    const text = rawTextByMsgEl.get(msg) || "";
    navigator.clipboard.writeText(text);
    const btn = wrap.querySelector('[data-act="copy"]');
    btn.textContent = "已复制";
    setTimeout(() => (btn.textContent = "复制"), 1200);
  });

  const favBtn = wrap.querySelector('[data-act="fav"]');
  favBtn.classList.toggle("favorited", !!favorited);
  favBtn.addEventListener("click", async () => {
    const id = msg.dataset.messageId;
    if (!id) return;
    const isFav = favBtn.classList.contains("favorited");
    if (isFav) {
      await kb.favorites.remove(id);
      favBtn.classList.remove("favorited");
      favBtn.textContent = "☆ 收藏";
    } else {
      await kb.favorites.add(id, state.activeConversationId);
      favBtn.classList.add("favorited");
      favBtn.textContent = "★ 已收藏";
    }
  });

  return wrap;
}

function buildCitationChips(citations) {
  const citeWrap = document.createElement("div");
  citeWrap.className = "citations";
  citations.forEach((c, i) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "citation-chip";
    chip.title = `点击在 Finder 中查看：${c.path}`;
    chip.textContent = `[来源${i + 1}] ${c.filename}`;
    chip.addEventListener("click", () => kb.documents.openInFinder(c.path));
    citeWrap.appendChild(chip);
  });
  return citeWrap;
}

function appendMessageBubble(role, { content = "", reasoning = "", citations = [], id = "", favorited = false } = {}) {
  const wrap = el("messages");
  const msg = document.createElement("div");
  msg.className = `msg ${role}`;
  if (id) msg.dataset.messageId = id;
  rawTextByMsgEl.set(msg, content);

  const avatar = document.createElement("img");
  avatar.className = "avatar";
  avatar.src = role === "user" ? "../build/user-avatar.png" : "../build/mascot-cropped.png";
  avatar.alt = role === "user" ? "我" : "小怪兽";
  msg.appendChild(avatar);

  const contentCol = document.createElement("div");
  contentCol.className = "msg-content";
  msg.appendChild(contentCol);

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "msg-select-checkbox";
  checkbox.addEventListener("change", () => {
    msg.classList.toggle("selected", checkbox.checked);
    const msgId = msg.dataset.messageId;
    if (!msgId) return;
    if (checkbox.checked) state.selectedMessageIds.add(msgId);
    else state.selectedMessageIds.delete(msgId);
    updateSelectionUi();
  });
  msg.appendChild(checkbox);

  if (reasoning) {
    const details = document.createElement("details");
    details.className = "reasoning";
    details.innerHTML = `<summary>思考过程</summary><div class="reasoning-body">${escapeHtml(reasoning)}</div>`;
    contentCol.appendChild(details);
  }

  const bubble = document.createElement("div");
  bubble.className = role === "user" ? "bubble" : "bubble markdown-body";
  if (role === "user") {
    bubble.textContent = content;
  } else {
    bubble.innerHTML = renderMarkdown(content);
  }
  contentCol.appendChild(bubble);

  if (citations && citations.length) {
    contentCol.appendChild(buildCitationChips(citations));
  }

  contentCol.appendChild(buildBubbleActions(msg, id, favorited));

  wrap.appendChild(msg);
  wrap.scrollTop = wrap.scrollHeight;
  highlightAndRenderDiagrams(bubble);
  return { msg, bubble, content: contentCol };
}

// ---------------- 发送消息（流式） ----------------
let currentRequestId = null;
let currentAssistantText = "";
let currentReasoningText = "";
let currentBubbleRefs = null;
let currentUserMsgEl = null;

el("messageInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
el("messageInput").addEventListener("input", (e) => {
  e.target.style.height = "auto";
  e.target.style.height = Math.min(160, e.target.scrollHeight) + "px";
  el("messageInput").closest(".composer-input").classList.toggle("multiline", e.target.scrollHeight > 40);
});
el("sendBtn").addEventListener("click", () => {
  if (state.sending) {
    kb.chat.stop(currentRequestId);
  } else {
    sendMessage();
  }
});
["ragToggle", "mcpToggle", "thinkingToggle"].forEach((id) => {
  el(id).addEventListener("click", () => el(id).classList.toggle("active"));
});

async function sendMessage() {
  if (state.sending) return;
  const input = el("messageInput");
  const text = input.value.trim();
  if (!text) return;

  if (!state.activeConversationId) {
    state.activeConversationId = await kb.conversations.create(text.slice(0, 24));
    await loadConversations();
  } else {
    // 走"+ 新建会话"创建的会话标题是写死的占位符"新会话"，第一次真正发消息时
    // 得把它换成有意义的标题——不然点"+ 新建会话"进来聊的每个会话都永远叫"新会话"
    const conv = state.conversations.find((c) => c.id === state.activeConversationId);
    if (conv && conv.title === "新会话") {
      await kb.conversations.rename(conv.id, text.slice(0, 24));
      loadConversations();
      el("chatTitle").textContent = text.slice(0, 24);
    }
  }

  input.value = "";
  input.style.height = "auto";
  const { msg: userMsgEl } = appendMessageBubble("user", { content: text });
  currentUserMsgEl = userMsgEl;

  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  currentRequestId = requestId;
  currentAssistantText = "";
  currentReasoningText = "";
  state.sending = true;
  el("sendBtn").textContent = "终止";
  el("sendBtn").classList.add("stop");

  const { msg, bubble, content } = appendMessageBubble("assistant", {});
  bubble.classList.add("empty");
  currentBubbleRefs = { msg, bubble, content };

  await kb.chat.send({
    conversationId: state.activeConversationId,
    message: text,
    ragEnabled: el("ragToggle").classList.contains("active"),
    mcpEnabled: state.mcpHasTools && el("mcpToggle").classList.contains("active"),
    thinkingEnabled: state.thinkingSupported && el("thinkingToggle").classList.contains("active"),
    requestId,
  });
}

kb.chat.onEvent((event) => {
  if (event.requestId !== currentRequestId || !currentBubbleRefs) return;
  const { bubble } = currentBubbleRefs;

  if (event.type === "user-message-saved") {
    if (currentUserMsgEl) currentUserMsgEl.dataset.messageId = event.messageId;
  } else if (event.type === "delta") {
    bubble.classList.remove("empty");
    currentAssistantText += event.text;
    rawTextByMsgEl.set(currentBubbleRefs.msg, currentAssistantText);
    bubble.innerHTML = renderMarkdown(currentAssistantText);
    highlightAndRenderDiagrams(bubble);
    // 只有用户本来就停在底部（跟着看最新内容）才继续跟随滚动；
    // 用户主动往上滑看历史的话，不该被每个 token 都拽回最底下——这就是"一闪一闪跳到最后"的原因
    scrollToBottomIfFollowing();
  } else if (event.type === "reasoning" || event.type === "reasoning-final") {
    currentReasoningText += event.type === "reasoning-final" ? "" : event.text;
    if (event.type === "reasoning-final") currentReasoningText = event.text;
    let reasoningEl = currentBubbleRefs.content.querySelector(".reasoning");
    if (!reasoningEl) {
      reasoningEl = document.createElement("details");
      reasoningEl.className = "reasoning";
      reasoningEl.innerHTML = `<summary>思考中…</summary><div class="reasoning-body"></div>`;
      currentBubbleRefs.content.insertBefore(reasoningEl, bubble);
    }
    reasoningEl.querySelector(".reasoning-body").textContent = currentReasoningText;
  } else if (event.type === "tool-call") {
    const trace = document.createElement("div");
    trace.className = "tool-trace";
    trace.textContent = `🔧 调用工具：${event.name}`;
    currentBubbleRefs.content.insertBefore(trace, bubble);
  } else if (event.type === "done") {
    bubble.classList.remove("empty");
    const doneCitations = event.citations || [];
    if (doneCitations.length) {
      currentBubbleRefs.content.appendChild(buildCitationChips(doneCitations));
    }
    // 探测到模型支持思考模式就立刻把开关亮出来，不用等重启或者手动点检测
    if (event.detectedThinkingSupport && el("thinkingToggle").hidden) {
      updateThinkingToggleVisibility(true);
    }
    endSending();
    loadConversations();
  } else if (event.type === "saved") {
    // 消息真正落库后才有 id——收藏按钮靠 msg.dataset.messageId 判断能不能点，
    // 之前这里没接，刚流完的消息永远拿不到 id，点收藏就是纯静默的 no-op
    if (event.messageId) currentBubbleRefs.msg.dataset.messageId = event.messageId;
  } else if (event.type === "stopped") {
    bubble.classList.remove("empty");
    if (!currentAssistantText) bubble.innerHTML = renderMarkdown("_已终止_");
    if (event.messageId) currentBubbleRefs.msg.dataset.messageId = event.messageId;
    endSending();
    loadConversations();
  } else if (event.type === "error") {
    bubble.classList.remove("empty");
    bubble.innerHTML = renderMarkdown(`⚠️ 出错了：${event.message}`);
    endSending();
  }
});

function endSending() {
  state.sending = false;
  const btn = el("sendBtn");
  btn.disabled = false;
  btn.textContent = "发送";
  btn.classList.remove("stop");
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
      updateMcpToggleVisibility(await kb.mcp.hasTools());
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
  updateMcpToggleVisibility(await kb.mcp.hasTools());
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

  const mcpHasTools = await kb.mcp.hasTools();
  updateMcpToggleVisibility(mcpHasTools);

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

function updateMcpToggleVisibility(hasTools) {
  state.mcpHasTools = hasTools;
  el("mcpToggle").hidden = !hasTools;
  if (!hasTools) el("mcpToggle").classList.remove("active");
}
function updateThinkingToggleVisibility(supported) {
  state.thinkingSupported = supported;
  el("thinkingToggle").hidden = !supported;
  if (!supported) el("thinkingToggle").classList.remove("active");
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

// ---------------- 初始化 ----------------
(async function init() {
  await maybeShowOnboarding();
  await loadConversations();
  const hasTools = await kb.mcp.hasTools();
  updateMcpToggleVisibility(hasTools);
  // 思考模式支不支持这个探测结果是存过的，启动时直接读出来用，不用每次都重新点一次检测按钮
  const settings = await kb.settings.get();
  updateThinkingToggleVisibility(!!settings.llm.thinkingSupported);
})();

// 全局 reactive store：对话层状态唯一真相源。
// 从 app.js 的 state 对象 + 散落变量收敛而来，新增 messages[] —— 之前流式问答靠
// currentBubbleRefs/currentToolCallsEl 一堆 DOM 引用追状态，列表一重建引用就成幽灵节点；
// 改成 messages[] 派生 DOM 后，那类 bug 结构上消失。
//
// 这个模块被 app.js（经典脚本，通过 window.kbStore 桥接）和 app-vue.js（ESM）共用。
// Vue 组件 import 它的 reactive 对象；app.js 通过 window.kbStore 暴露的方法读写。

import { reactive } from "./vendor/vue.runtime.js";

export const store = reactive({
  // 视图状态（视图切换仍由 app.js 持有，这里只是镜像供 Vue 判断可见性）
  view: "chat",
  // 会话列表
  conversations: [],
  activeConversationId: null,
  // 设置
  settings: null,
  // 工具/思考
  mcpHasTools: false,
  toolsEnabled: true,
  thinkingSupported: false,
  // 发送状态
  sending: false,
  // 批量删除
  selecting: false,
  selectedMessageIds: new Set(),
  // AI 状态栏
  aiStatus: { text: "本地检索模型：尚未加载（问答或同步时会自动加载）", dotClass: "" },
  // 对话消息：当前会话的消息数组，每条 { id, role, content, reasoning, citations, toolCalls, favorited, streaming }
  // 这是 chat 视图的唯一真相源，DOM 从它派生
  messages: [],
  // 分页游标
  pageState: { conversationId: null, oldestCreatedAt: null, hasMore: false, loadingOlder: false },
  // 当前流式请求的 requestId，用于匹配 chat 事件
  currentRequestId: null,
  // 当前流式 assistant 消息在 messages 里的索引（流式事件往这条上写）
  currentStreamIndex: -1,
});

// 把 IPC 桥（window.kb）注入进来，避免循环依赖。app-vue.js 启动时调一次。
let kb = null;
export function setKb(kbApi) {
  kb = kbApi;
}
export function getKb() {
  return kb || window.kb;
}

// ------ AI 状态 ------
export function setAiStatus(text, dotClass) {
  store.aiStatus.text = text;
  store.aiStatus.dotClass = dotClass || "";
}

// ------ 工具可用性 ------
export function updateToolAvailability(hasTools) {
  store.mcpHasTools = hasTools;
}
export function updateThinkingToggleVisibility(supported) {
  store.thinkingSupported = supported;
}

// ------ 会话列表 ------
export async function loadConversations() {
  store.conversations = await getKb().conversations.list();
}

// ------ 切换会话：载入历史消息到 messages[] ------
const PAGE_SIZE = 30;
export async function loadConversation(id) {
  store.activeConversationId = id;
  store.view = "chat";
  await loadConversations();
  const { messages, hasMore } = await getKb().conversations.getMessages(id, { limit: PAGE_SIZE });
  // 后端返回正序（旧→新），直接赋值
  store.messages = messages.map(normalizeMessage);
  store.pageState = {
    conversationId: id,
    oldestCreatedAt: messages[0]?.created_at ?? null,
    hasMore,
    loadingOlder: false,
  };
}

// 后端历史消息字段 → store message 对象。统一字段名，Vue 模板用着顺手
function normalizeMessage(m) {
  return {
    id: m.id || "",
    role: m.role,
    content: m.content || "",
    reasoning: m.reasoning || "",
    citations: m.citations || [],
    toolCalls: m.toolCalls || [],
    favorited: !!m.favorited,
    streaming: false,
  };
}

// ------ 加载更早一页（向上滚动到顶触发）------
export async function loadOlderMessages() {
  const ps = store.pageState;
  if (ps.loadingOlder || !ps.hasMore) return;
  if (ps.conversationId !== store.activeConversationId) return;
  ps.loadingOlder = true;
  try {
    const { messages, hasMore } = await getKb().conversations.getMessages(store.activeConversationId, {
      beforeCreatedAt: ps.oldestCreatedAt,
      limit: PAGE_SIZE,
    });
    if (messages.length) {
      // 这一页内部正序（旧→新），整页往前拼
      store.messages = [...messages.map(normalizeMessage), ...store.messages];
      ps.oldestCreatedAt = messages[0].created_at;
      ps.hasMore = hasMore;
    } else {
      ps.hasMore = false;
    }
  } finally {
    ps.loadingOlder = false;
  }
}

// ------ 发送消息：在 messages[] 追加 user + 占位 assistant，启动流式 ------
export async function startSending(text, opts) {
  if (store.sending) return;
  if (!store.activeConversationId) {
    store.activeConversationId = await getKb().conversations.create(text.slice(0, 24));
    await loadConversations();
  } else {
    // "+ 新建会话"创建的会话标题是占位符"新会话"，第一次发消息时换成有意义标题
    const conv = store.conversations.find((c) => c.id === store.activeConversationId);
    if (conv && conv.title === "新会话") {
      await getKb().conversations.rename(conv.id, text.slice(0, 24));
      loadConversations();
    }
  }

  // 用户消息
  store.messages.push({ id: "", role: "user", content: text, reasoning: "", citations: [], toolCalls: [], favorited: false, streaming: false });
  // 占位 assistant
  const assistantIdx = store.messages.length;
  store.messages.push({ id: "", role: "assistant", content: "", reasoning: "", citations: [], toolCalls: [], favorited: false, streaming: true });

  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  store.currentRequestId = requestId;
  store.currentStreamIndex = assistantIdx;
  store.sending = true;

  await getKb().chat.send({
    conversationId: store.activeConversationId,
    message: text,
    ragEnabled: opts.ragEnabled,
    mcpEnabled: store.toolsEnabled && store.mcpHasTools,
    thinkingEnabled: store.thinkingSupported && opts.thinkingEnabled,
    requestId,
  });

  return requestId;
}

// ------ 停止流式 ------
export function stopSending() {
  if (store.currentRequestId) getKb().chat.stop(store.currentRequestId);
}

// ------ 结束发送状态 ------
export function endSending() {
  store.sending = false;
  if (store.currentStreamIndex >= 0 && store.messages[store.currentStreamIndex]) {
    store.messages[store.currentStreamIndex].streaming = false;
  }
  store.currentStreamIndex = -1;
}

// ------ 处理 chat 流式事件：更新 messages[]，Vue 自动重渲染 ------
// 把 app.js 里那套 DOM 操作全部换成对 store.messages[currentStreamIndex] 的字段更新
export function handleChatEvent(event) {
  if (event.requestId !== store.currentRequestId) return;
  if (store.currentStreamIndex < 0) return;
  const msg = store.messages[store.currentStreamIndex];
  if (!msg) return;

  switch (event.type) {
    case "user-message-saved": {
      // 用户消息落库后才有 id，回填到前面那条用户消息
      const userMsg = store.messages[store.currentStreamIndex - 1];
      if (userMsg && userMsg.role === "user") userMsg.id = event.messageId;
      break;
    }
    case "delta":
      msg.content += event.text;
      break;
    case "reasoning":
      msg.reasoning += event.text;
      break;
    case "reasoning-final":
      msg.reasoning = event.text;
      break;
    case "tool-call": {
      if (!msg.toolCalls) msg.toolCalls = [];
      msg.toolCalls.push({
        callId: event.id || "",
        name: event.name,
        status: "执行中…",
        result: "",
        ok: null,
      });
      break;
    }
    case "tool-result": {
      // 按 callId 精确匹配（没有 id 的老数据按名字兜底），更新对应那条
      const calls = msg.toolCalls || [];
      const idx = event.id
        ? calls.findIndex((c) => c.callId === event.id)
        : calls.findIndex((c) => c.name === event.name);
      if (idx >= 0) {
        let preview;
        try {
          const parsed = JSON.parse(event.result);
          preview = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
        } catch {
          preview = event.result || "完成";
        }
        calls[idx].result = preview.length > 200 ? preview.slice(0, 200) + "…" : preview;
        calls[idx].status = "完成";
        calls[idx].ok = true;
      }
      break;
    }
    case "done": {
      msg.streaming = false;
      msg.content = msg.content || "（无法生成回答）";
      if (event.reasoning && !msg.reasoning) msg.reasoning = event.reasoning;
      msg.citations = event.citations || [];
      // done 事件里如果带 toolCalls（落库的那批），用它覆盖流式收集的（落库版本更准，含 ok 状态）
      if (event.toolCalls && event.toolCalls.length) {
        msg.toolCalls = event.toolCalls.map((tc) => ({
          callId: "",
          name: tc.name,
          status: tc.ok ? "完成" : "失败",
          result: tc.result || "",
          ok: tc.ok,
        }));
      }
      if (event.messageId) msg.id = event.messageId;
      if (event.detectedThinkingSupport) updateThinkingToggleVisibility(true);
      endSending();
      loadConversations();
      break;
    }
    case "saved": {
      if (event.messageId) msg.id = event.messageId;
      break;
    }
    case "stopped": {
      msg.streaming = false;
      if (!msg.content) msg.content = "_已终止_";
      if (event.messageId) msg.id = event.messageId;
      endSending();
      loadConversations();
      break;
    }
    case "error": {
      msg.streaming = false;
      msg.content = `⚠️ 出错了：${event.message}`;
      endSending();
      break;
    }
  }
}

// ------ 删除消息（批量）------
export async function deleteMessages(ids) {
  await getKb().messages.deleteMany(ids);
  const idSet = new Set(ids);
  store.messages = store.messages.filter((m) => !idSet.has(m.id));
  ids.forEach((id) => store.selectedMessageIds.delete(id));
}

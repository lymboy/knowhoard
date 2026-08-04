// 全局 reactive store：对话层状态唯一真相源。
// 从 app.js 的 state 对象 + 散落变量收敛而来，新增 messages[] —— 之前流式问答靠
// currentBubbleRefs/currentToolCallsEl 一堆 DOM 引用追状态，列表一重建引用就成幽灵节点；
// 改成 messages[] 派生 DOM 后，那类 bug 结构上消失。
//
// 这个模块被 app.js（经典脚本，通过 window.kbStore 桥接）和 app-vue.js（ESM）共用。
// Vue 组件 import 它的 reactive 对象；app.js 通过 window.kbStore 暴露的方法读写。

import { reactive } from "vue";

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
  // 对话开关状态（持久化在 settings，启动时从 settings 读回，切换时写 settings）
  ragEnabled: true,
  thinkingEnabled: false,
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
  // 自定义确认对话框（替代原生 confirm，跨视图共用）。showConfirm 设状态并返回 Promise，
  // App.vue 渲染 t-dialog，确定/取消回调 resolve
  confirm: { visible: false, message: "", resolve: null, okText: "确定", okDanger: false, cancelText: "取消" },
  // 首次启动引导弹窗可见性
  onboardingVisible: false,
});

// 挂到全局：组件 setup 用 window.__STORE 取 store，彻底绕过 inject/getCurrentInstance/import 时序问题
// （store.js 被 app-vue.js import 时求值，此时挂上；组件 setup 在 mount 时跑，一定已挂）
if (typeof window !== "undefined") window.__STORE = store;

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
  // 离开上一个会话时触发跨会话记忆提炼（fire-and-forget，不 await，不阻塞切换）。
  // 只在真的切到别的会话时触发，重复点同一个会话不重复提炼
  const previousId = store.activeConversationId;
  if (previousId && previousId !== id) getKb().conversations.leave(previousId);

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
    // 新会话用占位标题"新会话"创建，不截断首条消息当标题——首条截断会伪装成"像标题"，
    // 导致后端 AI 标题生成（generateConversationTitle）的 isPlaceholder 判断误以为用户改过而跳过。
    // 保持"新会话"占位，让 AI 在一轮问答后生成摘要标题接管。
    store.activeConversationId = await getKb().conversations.create("新会话");
    await loadConversations();
  }
  // 不再在首次发消息时用首条截断改名——交给 AI 标题生成

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
    // 检索开关只控制 RAG 向量检索，不控制工具。工具是否可用由工具总开关（toolsEnabled）决定，
    // 两者独立——关检索不代表禁用工具（工具能读文件是独立能力，不该被检索开关连带关掉）。
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
  // conversation:renamed 是 AI 标题摘要事件，不属于某次请求（无 requestId），单独处理，不走流式消息分支
  if (event.type === "conversation:renamed") {
    const conv = store.conversations.find((c) => c.id === event.conversationId);
    if (conv) conv.title = event.title;
    return;
  }
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
    case "assistant-message-created": {
      // 流式开始就建了占位助手消息，id 最先拿到——回填后前端立即可收藏/操作
      msg.id = event.messageId;
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
      // done 带的是重映射编号后的 content（[来源旧N]→[来源新N]，连续编号），覆盖流式累计的原始 content
      msg.content = event.content || msg.content || "（无法生成回答）";
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

// ------ 自定义确认对话框（替代原生 confirm，跨视图共用）------
// App.vue 渲染 t-dialog 绑定 store.confirm；这里设状态返回 Promise，确定/取消由 App.vue 回调 resolve。
// okDanger=true 时确定按钮显示红色（危险操作如移除/删除），okText 可自定义（如"去系统设置开启权限"）。
export function showConfirm(message, opts = {}) {
  return new Promise((resolve) => {
    store.confirm.visible = true;
    store.confirm.message = message;
    store.confirm.resolve = resolve;
    store.confirm.okText = opts.okText || "确定";
    store.confirm.okDanger = !!opts.okDanger;
    store.confirm.cancelText = opts.cancelText || "取消";
  });
}
// 确认对话框回调（App.vue 的确定按钮调）
export function resolveConfirm(result) {
  if (store.confirm.resolve) store.confirm.resolve(result);
  store.confirm.resolve = null;
  store.confirm.visible = false;
}

// iCloud/Obsidian 同步撞上 macOS 隐私权限时，给一个能直接跳系统设置的入口
export function showPermissionHelp(message) {
  return new Promise((resolve) => {
    store.confirm.visible = true;
    store.confirm.message = message;
    store.confirm.resolve = resolve;
    store.confirm.okText = "去系统设置开启权限";
    store.confirm.okDanger = false;
  });
}

// ------ 首次启动引导 ------
export async function maybeShowOnboarding() {
  try {
    const settings = await getKb().settings.get();
    if (!settings.hasSeenOnboarding) store.onboardingVisible = true;
  } catch (e) {
    console.error("[store] onboarding check error", e);
  }
}
export async function dismissOnboarding() {
  store.onboardingVisible = false;
  await getKb().settings.update({ hasSeenOnboarding: true });
}

// 把所有 API 方法挂到全局，组件用 window.__STORE_API 取，绕过 inject/import 时序问题
if (typeof window !== "undefined") {
  window.__STORE_API = {
    loadConversations,
    loadConversation,
    loadOlderMessages,
    deleteMessages,
    startSending,
    stopSending,
    setAiStatus,
    handleChatEvent,
    showConfirm,
    resolveConfirm,
    maybeShowOnboarding,
    dismissOnboarding,
  };
}

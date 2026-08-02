// Vue 渲染层 ESM 入口。建 store、注入 kb 桥、挂载 Vue 组件、接 chat 流式事件到 store。
// app.js（经典脚本）保留收藏/知识库/设置视图 + onboarding/confirm + 视图切换 + 初始化。
// 两者通过 window.kbStore 共享 store 方法（app.js 切会话调 kbStore.loadConversation 等）。
//
// 加载顺序：index.html 里经典脚本（marked/dompurify/hljs/mermaid/katex/app.js）先执行，
// 然后这个 module 脚本执行（module 默认 defer）。app.js 初始化时 window.kbStore 还没挂上，
// 所以 app.js 里要用 store 的地方都走 window.kbStore?.xxx（可选链，挂上前后都能跑）。

import { createApp } from "./vendor/vue.runtime.js";
import {
  setKb,
  store,
  handleChatEvent,
  setAiStatus,
  loadConversations as storeLoadConversations,
  loadConversation,
  loadOlderMessages,
  deleteMessages,
  startSending,
  stopSending,
} from "./store.js";
import { initMarkdown } from "./markdown.js";
import AiStatus from "./vendor/components/AiStatus.js";
import ConversationList from "./vendor/components/ConversationList.js";
import ChatView from "./vendor/components/ChatView.js";

// 注入 IPC 桥
setKb(window.kb);

// 暴露给经典脚本 app.js 用。合并而非覆盖——app.js 用独立的 kbAppBridge 命名空间，
// 这里挂 store 相关方法供 app.js（openConversation 等）调用
window.kbStore = Object.assign(window.kbStore || {}, {
  store,
  setAiStatus,
  handleChatEvent,
  loadConversation,
  loadConversations: storeLoadConversations,
  loadOlderMessages,
  deleteMessages,
  startSending,
  stopSending,
});

// 初始化 markdown 渲染器（mermaid 主题 + marked renderer）
initMarkdown();

// 启动时把已固化的设置（思考模式支持、工具可用性）同步到 store。
// app.js init 先执行但那时 store 还没建（store.js 被 app-vue.js import，晚于 app.js），
// 同步不过去；这里在挂组件前补上，Composer 的 v-if="store.thinkingSupported" 才能显示思考模式开关。
(async function initStoreFlags() {
  try {
    const settings = await window.kb.settings.get();
    store.thinkingSupported = !!settings.llm?.thinkingSupported;
    store.toolsEnabled = settings.toolsEnabled !== false;
    // 对话开关从持久化的 settings 恢复（用户上次设的）
    store.ragEnabled = settings.ragDefaultEnabled !== false;
    store.thinkingEnabled = !!settings.chatThinkingEnabled;
    const hasTools = await window.kb.mcp.hasTools();
    store.mcpHasTools = hasTools;
  } catch (e) {
    console.error("[app-vue] initStoreFlags error", e);
  }
})();

// 统一挂载帮手：给每个组件 app 注入全局 $store 和桥方法（globalProperties 自动暴露给所有组件，
// 不依赖 setup 暴露、不依赖 import 时序，根治组件拿不到 store 的问题）
function mountApp(component, el) {
  const app = createApp(component);
  // 通过 provide 注入 store 和桥方法：组件用 inject('store') 拿，inject 在 setup 同步执行时可用，
  // 不依赖 window.kbStore 挂载时序、不依赖 getCurrentInstance（后者在某些场景返回 null）。
  // 子组件（MessageBubble 等）inject 会沿组件链向上找到 app 级 provide。
  app.provide("store", store);
  app.provide("loadConversations", storeLoadConversations);
  app.provide("loadConversation", loadConversation);
  app.provide("loadOlderMessages", loadOlderMessages);
  app.provide("deleteMessages", deleteMessages);
  app.provide("startSending", startSending);
  app.provide("stopSending", stopSending);
  app.provide("kb", window.kb);
  app.provide("kbAppBridge", window.kbAppBridge);
  // globalProperties 也挂一份供模板用 $store（模板里 globalProperties 自动可用）
  const gp = app.config.globalProperties;
  gp.$store = store;
  gp.$kb = window.kb;
  gp.$kbAppBridge = window.kbAppBridge;
  app.mount(el);
  return app;
}

// 挂载 AI 状态栏（替换 index.html 里静态的 #aiStatus 内容）
var aiStatusMount = document.getElementById("aiStatus");
if (aiStatusMount) {
  aiStatusMount.innerHTML = "";
  mountApp(AiStatus, aiStatusMount);
}

// 挂载会话列表（替换 index.html 里 #conversationList 的静态内容）
var convListMount = document.getElementById("conversationList");
if (convListMount) {
  convListMount.innerHTML = "";
  mountApp(ConversationList, convListMount);
  // app.js 的 init（async）可能还没把会话列表拉完，这里自己拉一次保证 store.conversations 有数据
  storeLoadConversations();
}

// 挂载对话视图（替换 index.html 里 #view-chat 的静态内容：toolbar/messages/composer）
var chatMount = document.getElementById("chat-root");
if (chatMount) {
  mountApp(ChatView, chatMount);
}

// 接 AI 状态事件到 store
window.kb.ai.onStatus((status) => {
  if (status.phase === "loading-model") {
    var pct = status.progress ? Math.round(status.progress) + "%" : "";
    setAiStatus("本地检索模型加载中… " + (status.file || "") + " " + pct, "loading");
  } else if (status.phase === "worker-started") {
    setAiStatus("本地检索模型加载中…", "loading");
  } else if (status.phase === "ready") {
    setAiStatus("本地检索模型已就绪", "ready");
  } else if (status.phase === "unloaded") {
    setAiStatus("本地检索模型：已因空闲卸载，下次提问会自动重新加载", "");
  }
});

// 接 chat 流式事件到 store（不再操作 DOM，只更新 messages[]，Vue 自动重渲染）
window.kb.chat.onEvent((event) => {
  handleChatEvent(event);
});

// Vue 渲染层 ESM 入口。建 store、注入 kb 桥、挂载 Vue 组件、接 chat 流式事件到 store。
// app.js（经典脚本）保留收藏/知识库/设置视图 + onboarding/confirm + 视图切换 + 初始化。
// 两者通过 window.kbStore 共享 store 方法（app.js 切会话调 kbStore.loadConversation 等）。
//
// 加载顺序：index.html 里经典脚本（marked/dompurify/hljs/mermaid/katex/app.js）先执行，
// 然后这个 module 脚本执行（module 默认 defer）。app.js 初始化时 window.kbStore 还没挂上，
// 所以 app.js 里要用 store 的地方都走 window.kbStore?.xxx（可选链，挂上前后都能跑）。

import { createApp } from "./vendor/vue.runtime.js";
import { setKb, store, handleChatEvent, setAiStatus, loadConversations as storeLoadConversations } from "./store.js";
import { initMarkdown } from "./markdown.js";
import AiStatus from "./vendor/components/AiStatus.js";
import ConversationList from "./vendor/components/ConversationList.js";

// 注入 IPC 桥
setKb(window.kb);

// 暴露给经典脚本 app.js 用。合并而非覆盖——app.js 可能已经挂了 onConversationSwitched
// 等回调（共存期 app.js 还管消息 DOM，切会话时要同步它的 DOM），这里补上 store 相关方法
window.kbStore = Object.assign(window.kbStore || {}, {
  store,
  setAiStatus,
  handleChatEvent,
});

// 初始化 markdown 渲染器（mermaid 主题 + marked renderer）
initMarkdown();

// 挂载 AI 状态栏（替换 index.html 里静态的 #aiStatus 内容）
const aiStatusMount = document.getElementById("aiStatus");
if (aiStatusMount) {
  // 清掉原本静态的结构，让 Vue 接管
  aiStatusMount.innerHTML = "";
  createApp(AiStatus).mount(aiStatusMount);
}

// 挂载会话列表（替换 index.html 里 #conversationList 的静态内容：旧的新建按钮 + 空 conversationItems）
const convListMount = document.getElementById("conversationList");
if (convListMount) {
  convListMount.innerHTML = "";
  createApp(ConversationList).mount(convListMount);
  // app.js 的 init（async）可能还没把会话列表拉完，这里自己拉一次保证 store.conversations 有数据
  // （app.js 的 loadConversations 此时 window.kbStore 还没挂，同步不到 store，所以 store 自己拉）
  storeLoadConversations();
}

// 接 AI 状态事件到 store
window.kb.ai.onStatus((status) => {
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

// 接 chat 流式事件到 store（不再操作 DOM，只更新 messages[]）
// 注意：共存期 app.js 仍管对话层 DOM，这里先不接 chat 事件，避免和 app.js 双写状态。
// ChatView 迁过来、app.js 对话层代码删掉后，再放开下面这行。
// window.kb.chat.onEvent((event) => { handleChatEvent(event); });

console.log("[app-vue] 初始化完成");

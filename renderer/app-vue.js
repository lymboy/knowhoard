// V2 单 Vue 应用入口。挂载 App.vue 到 #app，注册 TDesign，接 AI 状态 + chat 流式事件到 store。
// 替代旧 app.js（经典脚本）+ 3 个分散 mount 点。所有视图由 App.vue 内部切换，状态从 store 派生。
import { createApp } from "vue";
import TDesign from "tdesign-vue-next";
import App from "./App.vue";
import "./lib-globals.js";
import { setKb, store, handleChatEvent, setAiStatus } from "./store.js";
import { initMarkdown } from "./markdown.js";

// 注入 IPC 桥
setKb(window.kb);

// 初始化 markdown 渲染器（mermaid 主题 + marked renderer）
initMarkdown();

// @tdesign-vue-next/chat 的 ChatItem/ChatList 曾尝试接入做对话气泡框架组件，
// 但其 markdown 内容渲染下沉到 tdesign-web-components + omi-vueify（Omi web component），
// 在 Vite+Electron 打包环境下有首帧渲染时序问题（复杂 prop 在 Omi connectedCallback 前未就绪，
// 导致 shadowRoot 渲染空内容）。已改用 tdesign-vue-next 基础组件（t-avatar/t-collapse/t-button）
// 手动拼气泡结构，markdown 走本项目 markdown.js 统一渲染，功能等价。不再引入 @tdesign-vue-next/chat。
const app = createApp(App);
app.use(TDesign);
app.mount("#app");

// 接 AI 状态事件到 store（AiStatus.vue 读 store.aiStatus）
window.kb.ai.onStatus((status) => {
  if (status.phase === "loading-model") {
    const pct = status.progress ? Math.round(status.progress) + "%" : "";
    setAiStatus("本地检索模型加载中… " + (status.file || "") + " " + pct, "loading");
  } else if (status.phase === "worker-started") {
    setAiStatus("本地检索模型加载中…", "loading");
  } else if (status.phase === "ready") {
    setAiStatus("本地检索模型已就绪", "ready");
  } else if (status.phase === "unloaded") {
    setAiStatus("本地检索模型：已因空闲卸载，下次提问会自动重新加载", "");
  }
});

// 接 chat 流式事件到 store（更新 messages[]，Vue 自动重渲染，不再操作 DOM）
window.kb.chat.onEvent((event) => {
  handleChatEvent(event);
});

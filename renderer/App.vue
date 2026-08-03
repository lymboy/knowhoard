<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <img :src="iconUrl" alt="logo" class="brand-logo" />
        <div class="brand-text">
          <div class="brand-title">小怪兽知识库</div>
          <div class="brand-sub">本地优先 · 隐私可靠</div>
        </div>
      </div>

      <nav class="nav-tabs">
        <button v-for="t in tabs" :key="t.key" :class="['nav-tab',{active: store.view===t.key}]" @click="switchView(t.key)">{{ t.label }}</button>
      </nav>

      <div class="conversation-list-wrap" v-show="store.view==='chat'">
        <ConversationList />
      </div>

      <AiStatus class="ai-status" />
    </aside>

    <main class="content" :class="{ 'content--knowledge': store.view==='knowledge' }">
      <div v-show="store.view==='chat'" class="chat-view-wrap"><ChatView /></div>
      <FavoritesView v-show="store.view==='favorites'" />
      <KnowledgeView v-show="store.view==='knowledge'" />
      <SettingsView v-show="store.view==='settings'" />
    </main>

    <!-- 首次启动引导 -->
    <t-dialog v-model:visible="store.onboardingVisible" :footer="false" :close-on-overlay-click="false" :close-on-esc="false" class="onboarding-dialog" width="560px">
      <div class="onboarding-card">
        <div class="onboarding-header">
          <img :src="mascotUrl" alt="小怪兽" class="onboarding-mascot" />
          <h1>你好，我是小怪兽 👋</h1>
          <p class="onboarding-sub">这是一个完全跑在你电脑本地的个人知识库问答客户端</p>
        </div>
        <div class="onboarding-scroll">
          <div class="onboarding-section">
            <h3>它能帮你做什么</h3>
            <ul>
              <li>一键接入你的 Word / PDF / Markdown 笔记，或整个 Obsidian 知识库，从成堆的文档里直接问出答案，不用自己翻</li>
              <li>回答会标注具体引用了哪份文档、哪个位置，有据可查，不是凭空瞎编</li>
              <li>大模型你说了算——接入你已有的任意 OpenAI 兼容接口，用哪个模型自己定，不绑定任何一家</li>
              <li>检索和排序全部在这台电脑上算，不额外花一分钱，也不用等云端排队</li>
            </ul>
          </div>
          <div class="onboarding-section privacy">
            <h3>关于隐私，我的承诺</h3>
            <p>你的文档、笔记、对话记录<mark>只保存在这台电脑上</mark>，全程<mark>本地处理</mark>、<mark>离线运行</mark>，不会被采集或上传到任何地方，<mark>安全不泄露</mark>。唯一会离开本机的数据，是你主动提问时发给你自己配置的那个大模型接口的内容——这是问答本身需要的，除此之外没有任何后台上报或遥测。</p>
          </div>
        </div>
        <div class="onboarding-footer">
          <p class="onboarding-contact">有问题或建议，欢迎邮件联系：<a href="mailto:liusairo@gmail.com">liusairo@gmail.com</a></p>
          <t-button theme="primary" @click="dismissOnboarding">开始使用</t-button>
        </div>
      </div>
    </t-dialog>

    <!-- 自定义确认对话框（替代原生 confirm） -->
    <t-dialog v-model:visible="store.confirm.visible" :header="false" :footer="false" :close-on-overlay-click="false" width="420px" class="confirm-dialog">
      <p class="confirm-message">{{ store.confirm.message }}</p>
      <div class="confirm-actions">
        <t-button theme="default" variant="outline" @click="resolveConfirm(false)">{{ store.confirm.cancelText }}</t-button>
        <t-button :theme="store.confirm.okDanger?'danger':'primary'" @click="resolveConfirm(true)">{{ store.confirm.okText }}</t-button>
      </div>
    </t-dialog>
  </div>
</template>

<script>
// App.vue：单 Vue 应用根。布局 + 视图切换 + onboarding/confirm 弹窗 + 桥接 + 初始化。
// 替代原 app.js（经典脚本）+ 3 个分散 mount 点。状态从 store 派生，DOM 不再手动操作。
import { store, setAiStatus, updateToolAvailability, updateThinkingToggleVisibility,
  loadConversations, maybeShowOnboarding, dismissOnboarding, resolveConfirm, showConfirm } from "./store.js";
import AiStatus from "./vendor-src/components/AiStatus.vue";
import ConversationList from "./vendor-src/components/ConversationList.vue";
import ChatView from "./vendor-src/components/ChatView.vue";
import FavoritesView from "./views/FavoritesView.vue";
import KnowledgeView from "./views/KnowledgeView.vue";
import SettingsView from "./views/SettingsView.vue";
import iconUrl from "./assets/icon.png";
import mascotUrl from "./assets/mascot-cropped.png";

const kb = () => window.kb;

export default {
  components: { AiStatus, ConversationList, ChatView, FavoritesView, KnowledgeView, SettingsView },
  data() {
    return {
      tabs: [
        { key:"chat", label:"对话" },
        { key:"favorites", label:"收藏" },
        { key:"knowledge", label:"知识库" },
        { key:"settings", label:"设置" },
      ],
    };
  },
  computed: { store() { return store; }, iconUrl() { return iconUrl; }, mascotUrl() { return mascotUrl; } },
  async mounted() {
    // 暴露给现有 Vue 组件（ConversationList/ChatView）调的桥：切视图 + 确认框
    window.kbAppBridge = { switchView: this.switchView, showConfirm };
    // 外部链接一律走系统默认程序
    this._linkHandler = (e) => {
      const link = e.target.closest("a[href]"); if (!link) return;
      const href = link.getAttribute("href");
      if (/^(mailto:|https?:)/i.test(href)) { e.preventDefault(); kb().shell.openExternal(href); }
    };
    document.addEventListener("click", this._linkHandler);
    // 菜单栏"帮助 > 关于"手动重看引导
    this._onShowOnboarding = () => { store.onboardingVisible = true; };
    kb().app.onShowOnboarding(this._onShowOnboarding);

    // 初始化
    await maybeShowOnboarding();
    await loadConversations();
    await updateToolAvailability(await kb().mcp.hasTools());
    const settings = await kb().settings.get();
    updateThinkingToggleVisibility(!!settings.llm?.thinkingSupported);
    store.thinkingSupported = !!settings.llm?.thinkingSupported;
    store.toolsEnabled = settings.toolsEnabled !== false;
    store.ragEnabled = settings.ragDefaultEnabled !== false;
    store.thinkingEnabled = !!settings.chatThinkingEnabled;
  },
  beforeUnmount() {
    document.removeEventListener("click", this._linkHandler);
  },
  methods: {
    switchView(view) { store.view = view; },
    dismissOnboarding,
    resolveConfirm,
  },
};
</script>

<style>
/* App 根布局（全局，非 scoped——App 是唯一根，全局覆盖更稳，避免和 styles.css 的 .sidebar/.content
   scoped 叠加打架）。这里统一管 sidebar 红黄绿避让 + 拖拽区 + content 布局 + 对话区限宽。 */
.app-shell { display: flex; height: 100vh; width: 100%; overflow: hidden; }

/* 侧边栏：标题栏 hiddenInset 隐藏后，红黄绿按钮悬浮在内容上方，顶部留 38px 避让；
   空白区作窗口拖拽区（-webkit-app-region: drag），内部可点击元素单独排除 */
.sidebar {
  width: 260px; flex-shrink: 0;
  display: flex; flex-direction: column;
  background: var(--td-bg-color-container);
  border-right: 1px solid var(--td-component-stroke);
  padding: 38px 12px 8px;
  box-sizing: border-box;
  -webkit-app-region: drag;
}
.sidebar button, .sidebar input, .sidebar a, .sidebar .conversation-item,
.sidebar .new-conversation, .sidebar .nav-tab { -webkit-app-region: no-drag; }

.brand { display: flex; align-items: center; gap: 10px; padding: 4px 8px 12px; }
.brand-logo { width: 34px; height: 34px; border-radius: 9px; }
.brand-title { font-size: 14px; font-weight: 600; color: var(--td-text-color-primary); }
.brand-sub { font-size: 11px; color: var(--td-text-color-secondary); }

.nav-tabs { display: flex; gap: 4px; padding: 4px 4px 12px; }
.nav-tab {
  flex: 1; padding: 7px 0; font-size: 13px; line-height: 1;
  border: none; background: transparent; color: var(--td-text-color-secondary);
  border-radius: 6px; cursor: pointer; transition: background 0.15s;
}
.nav-tab:hover { background: var(--td-bg-color-secondarycontainer); }
.nav-tab.active { background: var(--td-brand-color); color: #fff; }

.conversation-list-wrap { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }

/* 主内容区：每个视图自己控制内边距。chat 视图顶满（toolbar+消息+composer 撑满），
   其余视图（设置/知识库/收藏）用统一的内边距 + 限宽居中，避免右侧大段空白 */
/* 主内容区：每个视图自己控制内边距。chat 视图顶满（toolbar+消息+composer 撑满），
   其余视图（设置/知识库/收藏）用统一的内边距 + 大屏限宽居中，避免右侧大段空白又不会顶满难读。
   chat 视图时 content 不自滚（ChatView 内部 messages 滚），其余视图 content 自己滚 */
.content { flex: 1; min-width: 0; overflow: auto; background: var(--td-bg-color-page); }
/* knowledge 视图：content 改 flex column + overflow hidden，knowledge-view flex:1 撑满（内部 doc-list 滚）。
   用动态 class（content--knowledge）不用 :has——v-show 让 knowledge-view 常驻 DOM，:has 会永远匹配误伤其他视图 */
.content.content--knowledge { overflow: hidden; display: flex; flex-direction: column; }
.content.content--knowledge > .knowledge-view { flex: 1; min-height: 0; }
.content > .chat-view-wrap { padding: 0; height: 100%; display: flex; flex-direction: column; overflow: hidden; }
/* 设置/收藏大屏限宽居中（响应式：4K 大屏不会窄成一条，小屏自适应填满）。
   知识库不在此限——它 flex:1 撑满 content（上方 :has 规则） */
.content > .favorites-view,
.content > .settings-view {
  max-width: min(1400px, 92%); margin: 0 auto; padding: 16px 20px 40px; box-sizing: border-box;
}

/* t-card body 默认左右 padding 是 --td-comp-paddingLR-xl（24px），输入框/表单被缩进显空白。
   统一收到 12px，内容贴边又不失呼吸感。设置/知识库/收藏的 panel 都受益 */
.content .t-card__body { padding-left: 12px; padding-right: 12px; }
/* 表单控件全部撑满 form-item，消除输入框内部白边 */
.content .t-input, .content .t-textarea__inner, .content .t-select, .content .t-input-number,
.content .t-textarea { width: 100%; }

/* 对话区铺满右侧宽度（不限宽），气泡本身限宽居中保持可读。
   覆盖 styles.css 里 .messages > .msg 的 max-width:min(78%,1080px) */
.app-shell .messages > .msg { max-width: min(86%, 1080px); }
.app-shell .chat-view-inner {
  flex: 1; min-height: 0;
  width: 100%; box-sizing: border-box;
}
/* TDesign Chat 的 t-chat__list 内部限宽，放开让它撑满 */
.app-shell .t-chat { width: 100%; }
.app-shell .t-chat__list { max-width: none; }

.ai-status { margin-top: auto; }

/* onboarding / confirm 弹窗 */
.onboarding-card { padding: 8px 4px; }
.onboarding-header { text-align: center; margin-bottom: 16px; }
.onboarding-mascot { width: 88px; height: 88px; border-radius: 50%; }
.onboarding-header h1 { font-size: 22px; margin: 12px 0 4px; }
.onboarding-sub { color: var(--td-text-color-secondary); margin: 0; }
.onboarding-scroll { max-height: 320px; overflow: auto; }
.onboarding-section { margin-bottom: 16px; }
.onboarding-section h3 { font-size: 15px; margin: 0 0 8px; }
.onboarding-section ul { padding-left: 20px; margin: 0; }
.onboarding-section li { font-size: 13px; line-height: 1.7; margin-bottom: 6px; }
.onboarding-section.privacy p { font-size: 13px; line-height: 1.7; }
.onboarding-section mark { background: var(--td-warning-color-light); padding: 0 2px; border-radius: 2px; }
.onboarding-footer { text-align: center; margin-top: 8px; }
.onboarding-contact { font-size: 12px; color: var(--td-text-color-secondary); margin: 0 0 12px; }
.confirm-message { font-size: 14px; line-height: 1.6; margin: 0 0 16px; }
.confirm-actions { display: flex; justify-content: flex-end; gap: 8px; }

/* ---------- 知识库文档列表：flex 链路让列表撑满容器剩余高度，不再底部大段空白 ----------
   全局选择器（非 scoped）命中 TDesign 内部 class 稳定。链路：
   knowledge-view(flex column, height:100%) → doc-panel(flex:1) → t-card__body(flex:1, flex column)
   → kb-list(flex:1, overflow auto) 撑满 + 内部滚 */
.knowledge-view .doc-panel .t-card__body {
  flex: 1; min-height: 0; display: flex; flex-direction: column;
}
</style>

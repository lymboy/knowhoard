<template>
  <div class="chat-view-inner">
    <div class="chat-toolbar">
      <span class="chat-title">{{ title }}</span>
      <div class="chat-toolbar-actions">
        <span v-if="store.selecting" class="hint">已选 {{ store.selectedMessageIds.size }} 条</span>
        <t-button v-if="store.selecting" theme="danger" variant="outline" size="small" @click="deleteSelected" :disabled="!store.selectedMessageIds.size">删除选中</t-button>
        <t-button variant="outline" size="small" @click="toggleSelectMode">{{ store.selecting ? '取消批量' : '批量删除' }}</t-button>
      </div>
    </div>

    <div ref="messagesRef" class="messages-scroll" @scroll="onScroll">
      <MessageBubble
        v-for="m in store.messages"
        :key="m.id || m._key"
        :msg="m"
      />
    </div>

    <Composer />
  </div>
</template>

<script>
// 对话视图：消息列表 + composer。消息用 MessageBubble 渲染（markdown/思考/工具/引用/流式/收藏/复制），
// 套 TDesign --td-* token 蓝色调。ChatList(web component) 在 Vite+Electron 下 React 不 hydrate，回显失败，故用基础组件。
import { createApp } from "vue";
import MessageBubble from "./MessageBubble.vue";
import Composer from "./Composer.vue";

const NEAR_BOTTOM = 80;
const LOAD_MORE_THRESHOLD = 80;

export default {
  components: { MessageBubble, Composer },
  data() { return { title: "" }; },
  computed: {
    store() { return window.__STORE; },
    messagesLen() { return this.store.messages.length; },
    messagesContentKey() { return this.store.messages.map((m) => m.content).join(""); },
  },
  watch: {
    "store.activeConversationId"() { this.updateTitle(); },
    "store.conversations"() { this.updateTitle(); },
    messagesLen() {
      const wasNear = this.isNearBottom();
      this.$nextTick(() => { if (wasNear) this.scrollToBottom(); });
    },
    messagesContentKey() {
      const wasNear = this.isNearBottom();
      this.$nextTick(() => { if (wasNear) this.scrollToBottom(); });
    },
  },
  mounted() { this.updateTitle(); },
  methods: {
    updateTitle() {
      const conv = this.store.conversations.find((c) => c.id === this.store.activeConversationId);
      this.title = conv ? conv.title : "";
    },
    isNearBottom() {
      const el = this.$refs.messagesRef;
      if (!el) return true;
      return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM;
    },
    scrollToBottom() {
      const el = this.$refs.messagesRef;
      if (el) el.scrollTop = el.scrollHeight;
    },
    onScroll() {
      const el = this.$refs.messagesRef;
      if (!el) return;
      if (el.scrollTop > LOAD_MORE_THRESHOLD) return;
      window.__STORE_API.loadOlderMessages();
    },
    toggleSelectMode() {
      this.store.selecting = !this.store.selecting;
      if (!this.store.selecting) this.store.selectedMessageIds = new Set();
      const app = document.getElementById("app");
      if (app) app.classList.toggle("selecting", this.store.selecting);
    },
    async deleteSelected() {
      const ids = Array.from(this.store.selectedMessageIds);
      if (!ids.length) return;
      const ok = window.kbAppBridge && await window.kbAppBridge.showConfirm(`删除选中的 ${ids.length} 条消息？删除后无法恢复。`);
      if (!ok) return;
      await window.__STORE_API.deleteMessages(ids);
      this.store.selectedMessageIds = new Set();
    },
  },
};
</script>

<style scoped>
.chat-view-inner { display: flex; flex-direction: column; height: 100%; }
.chat-toolbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 24px; border-bottom: 1px solid var(--td-component-stroke); flex-shrink: 0;
}
.chat-title { font-size: 14px; color: var(--td-text-color-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-toolbar-actions { display: flex; align-items: center; gap: 10px; }
.hint { font-size: 13px; color: var(--td-text-color-secondary); }
.messages-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 24px; }
</style>

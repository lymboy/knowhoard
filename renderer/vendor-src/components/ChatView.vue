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
      <ChatList :data="chatItems" :auto-scroll="true" class="chat-list">
        <template #default="{ item, index }">
          <!-- 工具调用折叠块（产品特有，ChatItem 无专门字段，用 content slot 嵌自研组件） -->
          <ToolCallsBlock
            v-if="item.toolCalls && item.toolCalls.length"
            :tool-calls="item.toolCalls"
            class="chat-toolcalls"
          />
          <!-- markdown 正文（item.content 已是分段，ChatList 内部渲染；这里补引用 chip） -->
          <CitationChips
            v-if="item.citations && item.citations.length"
            :citations="item.citations"
            class="chat-citations"
          />
          <!-- 批量删除勾选框（selecting 模式） -->
          <input
            v-if="store.selecting && item.role === 'assistant'"
            type="checkbox"
            class="msg-select-checkbox"
            :checked="store.selectedMessageIds.has(item.id)"
            @change="toggleSelect(item.id)"
          />
        </template>
      </ChatList>
    </div>

    <Composer />
  </div>
</template>

<script>
// V2 Phase 3：TDesign Chat 接管对话层。ChatList 渲染消息，store.messages 映射成 ChatItemMeta 分段数组。
// 工具折叠块/引用 chip 是产品特有能力（ChatItem 无专门字段），用 ChatList 默认 slot 嵌自研组件。
// 流式：ChatList autoScroll 自动跟底；reasoning 用 ChatItem reasoning 字段（TDesign 自带思考折叠）。
import { ChatList } from "@tdesign-vue-next/chat";
import Composer from "./Composer.vue";
import ToolCallsBlock from "./ToolCallsBlock.vue";
import CitationChips from "./CitationChips.vue";
import userAvatarUrl from "../../assets/user-avatar.png";
import mascotUrl from "../../assets/mascot-cropped.png";

const NEAR_BOTTOM = 80;
const LOAD_MORE_THRESHOLD = 80;

export default {
  components: { ChatList, Composer, ToolCallsBlock, CitationChips },
  data() { return { title: "" }; },
  computed: {
    store() { return window.__STORE; },
    messagesLen() { return this.store.messages.length; },
    // store.messages → ChatItemMeta 分段数组。content 拼成 AIMessageContent[]：
    // reasoning 段（若有，data 是嵌套 [{type:text,data:reasoning}]）+ text 段（content markdown）
    chatItems() {
      return this.store.messages.map((m) => {
        const segments = [];
        if (m.reasoning) segments.push({ type: "reasoning", data: [{ type: "text", data: m.reasoning }] });
        if (m.content) segments.push({ type: "text", data: m.content });
        // 没内容时占位（流式开始 assistant 空气泡）
        if (!segments.length) segments.push({ type: "text", data: "" });
        return {
          id: m.id || String(Math.random()),
          role: m.role === "user" ? "user" : "assistant",
          name: m.role === "user" ? "我" : "小怪兽",
          avatar: m.role === "user" ? userAvatarUrl : mascotUrl,
          datetime: m.timestamp || "",
          content: segments,
          status: m.streaming ? "streaming" : (m.error ? "error" : "complete"),
          // 保留原始字段供 slot 用
          toolCalls: m.toolCalls,
          citations: m.citations,
        };
      });
    },
  },
  watch: {
    "store.activeConversationId"() { this.updateTitle(); },
    "store.conversations"() { this.updateTitle(); },
    messagesLen() {
      // ChatList autoScroll 已自动跟底，这里保留滚动逻辑兼容顶部加载更多检测
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
    toggleSelect(id) {
      if (this.store.selectedMessageIds.has(id)) this.store.selectedMessageIds.delete(id);
      else this.store.selectedMessageIds.add(id);
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
.chat-list { width: 100%; }
.chat-toolcalls { margin: 8px 0; }
.chat-citations { margin-top: 8px; }
.msg-select-checkbox { margin-right: 8px; cursor: pointer; }
</style>

<template>
  <div class="chat-view-inner">
    <div class="chat-toolbar">
      <span class="chat-title">{{ title }}</span>
      <div class="chat-toolbar-actions">
        <span v-if="store.selecting" class="hint">已选 {{ store.selectedMessageIds.size }} 条</span>
        <button v-if="store.selecting" class="danger" @click="deleteSelected" :disabled="!store.selectedMessageIds.size">删除选中</button>
        <button @click="toggleSelectMode">{{ store.selecting ? '取消批量' : '批量删除' }}</button>
      </div>
    </div>

    <div ref="messagesRef" class="messages" @scroll="onScroll">
      <MessageBubble
        v-for="(m, i) in store.messages"
        :key="m.id || ('idx-' + i)"
        :msg="m"
      />
    </div>

    <Composer />
  </div>
</template>

<script>
// Options API（非 <script setup>）：methods/computed/data 由 Vue 直接挂到实例，
// render 里 _ctx.xxx 一定可访问、响应式追踪正常。之前 <script setup> 手拼产物在
// setup 返回值与 render 上下文的关联上缺胶水，导致 _ctx 拿不到暴露值、响应式失效。

import MessageBubble from "./MessageBubble.js";
import Composer from "./Composer.js";

const NEAR_BOTTOM = 80;
const LOAD_MORE_THRESHOLD = 80;

export default {
  components: { MessageBubble, Composer },
  data() {
    return { title: "" };
  },
  computed: {
    store() {
      return window.__STORE;
    },
    // 用一个 computed 触发响应式追踪 messages 长度变化（滚动跟随用）
    messagesLen() {
      return this.store.messages.length;
    },
    messagesContentKey() {
      return this.store.messages.map((m) => m.content).join("");
    },
  },
  watch: {
    "store.activeConversationId"() {
      const conv = this.store.conversations.find((c) => c.id === this.store.activeConversationId);
      this.title = conv ? conv.title : "";
    },
    "store.conversations"() {
      const conv = this.store.conversations.find((c) => c.id === this.store.activeConversationId);
      this.title = conv ? conv.title : "";
    },
    messagesLen() {
      // 新消息条数变化（用户发送 / 助手新气泡 / 加载历史页）。
      // 用户主动上滑看历史时不该被拽下去——和流式一样：增长前在底部才滚。
      // 唯一例外是「用户刚发送消息」：此时一定在底部，wasNear 必为 true，会滚，符合预期。
      const wasNear = this.isNearBottom();
      this.$nextTick(() => {
        if (wasNear) this.scrollToBottom();
      });
    },
    messagesContentKey() {
      // 流式 token 增长：在 DOM 更新前判断是否在底部（增长前的真实位置），更新后若在底部才滚。
      // 用户主动上滑时 wasNear=false，不滚——不打断用户看历史。
      // 之前用 nextTick 后判断 isNearBottom，那时 scrollHeight 已增长，旧 scrollTop 不再是底部，
      // 判断恒 false，导致流式不滚动；这里改成更新前判断。
      const wasNear = this.isNearBottom();
      this.$nextTick(() => {
        if (wasNear) this.scrollToBottom();
      });
    },
  },
  mounted() {
    const conv = this.store.conversations.find((c) => c.id === this.store.activeConversationId);
    this.title = conv ? conv.title : "";
    this.$nextTick(() => {
      const el = this.$refs.messagesRef;
      if (el) el.scrollTop = el.scrollHeight;
    });
  },
  methods: {
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
      if (!this.store.selecting) {
        this.store.selectedMessageIds = new Set();
      }
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
.chat-view-inner {
  display: flex;
  flex-direction: column;
  height: 100%;
}
</style>

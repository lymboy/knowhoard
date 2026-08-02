<template>
  <div class="conversation-list-inner">
    <button class="new-conversation" @click="createConversation">+ 新建会话</button>
    <div class="conversation-items">
      <div
        v-for="conv in store.conversations"
        :key="conv.id"
        :class="['conversation-item', { active: conv.id === store.activeConversationId }]"
      >
        <span
          v-if="editingId !== conv.id"
          class="title"
          :title="'双击重命名'"
          @click="onTitleClick(conv)"
          @dblclick.stop="startEdit(conv)"
        >{{ conv.title }}</span>
        <input
          v-else
          ref="editInputs"
          v-model="editingTitle"
          class="title-edit-input"
          @blur="commitEdit(conv)"
          @keydown.enter="commitEdit(conv)"
          @keydown.esc="cancelEdit"
        />
        <button class="del" title="删除" @click.stop="removeConversation(conv)">×</button>
      </div>
    </div>
  </div>
</template>

<script>
// 用 Options API 而非 <script setup>：methods 里的函数 Vue 直接挂到组件实例，
// render 里 _ctx.onTitleClick 一定可调。之前 <script setup> 手拼产物在 setup 返回值
// 与 render 上下文关联上缺胶水，导致 _ctx.onTitleClick undefined。

const PAGE_SIZE = 30;

export default {
  data() {
    return {
      editingId: null,
      editingTitle: "",
      clickTimer: null,
    };
  },
  computed: {
    store() {
      return window.__STORE;
    },
  },
  methods: {
    async onTitleClick(conv) {
      // 单击/双击分辨：单击先等 250ms，真等到双击就取消单击
      if (this.clickTimer) return;
      this.clickTimer = setTimeout(() => {
        this.clickTimer = null;
        this.openConversation(conv.id);
      }, 250);
    },
    async openConversation(id) {
      try {
        await window.__STORE_API.loadConversation(id);
        window.kbAppBridge && window.kbAppBridge.switchView("chat");
      } catch (e) {
        console.error("[CL] openConversation error", e);
      }
    },
    async createConversation() {
      try {
        const id = await window.kb.conversations.create("新会话");
        this.store.activeConversationId = id;
        await window.__STORE_API.loadConversations();
        this.store.messages = [];
        this.store.pageState = { conversationId: id, oldestCreatedAt: null, hasMore: false, loadingOlder: false };
        window.kbAppBridge && window.kbAppBridge.switchView("chat");
      } catch (e) {
        console.error("[CL] createConversation error", e);
      }
    },
    async startEdit(conv) {
      if (this.clickTimer) { clearTimeout(this.clickTimer); this.clickTimer = null; }
      this.editingId = conv.id;
      this.editingTitle = conv.title;
      this.$nextTick(() => {
        const inputs = this.$refs.editInputs;
        const input = inputs && inputs.length ? inputs[inputs.length - 1] : null;
        if (input) { input.focus(); input.select(); }
      });
    },
    async commitEdit(conv) {
      const newTitle = (this.editingTitle || "").trim() || conv.title;
      this.editingId = null;
      if (newTitle !== conv.title) {
        await window.kb.conversations.rename(conv.id, newTitle);
        await window.__STORE_API.loadConversations();
      }
    },
    cancelEdit() {
      this.editingId = null;
    },
    async removeConversation(conv) {
      const ok = window.kbAppBridge && await window.kbAppBridge.showConfirm(`删除会话「${conv.title}」？`);
      if (!ok) return;
      await window.kb.conversations.remove(conv.id);
      if (this.store.activeConversationId === conv.id) {
        this.store.activeConversationId = null;
        this.store.messages = [];
      }
      await window.__STORE_API.loadConversations();
    },
  },
};
</script>

<style scoped>
.conversation-list-inner {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>

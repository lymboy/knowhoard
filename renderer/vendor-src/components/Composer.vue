<template>
  <div class="composer">
    <div class="composer-toggles">
      <!-- 开关用原生 button + active class（原版方案，b941c5b 即如此，已验证稳定）。
           之前改 t-tag checkable 选中态丢失（单向 checked 不更新内部 modelValue）；
           再改 t-button + theme 切换，reactive 切换 theme 时背景异常（base+primary 该蓝却白）。
           回到 button.mode-pill.active，用 TDesign token 配色：选中=蓝实底白字，未选=浅底灰字 -->
      <button type="button" class="mode-pill" :class="{ active: store.ragEnabled }" @click="toggleRag">检索本地知识库</button>
      <button
        v-if="store.thinkingSupported"
        type="button"
        class="mode-pill"
        :class="{ active: store.thinkingEnabled }"
        @click="toggleThinking"
      >思考模式</button>
    </div>
    <div class="composer-input" :class="{ multiline: multiline }">
      <textarea
        ref="textareaRef"
        v-model="text"
        placeholder="问点什么…（Enter 发送，Shift+Enter 换行）"
        rows="1"
        @keydown="onKeydown"
        @input="autoResize"
      ></textarea>
      <t-button theme="primary" @click="onSendClick">{{ sending ? '终止' : '发送' }}</t-button>
    </div>
  </div>
</template>

<script>
// Options API：methods/computed Vue 直接挂实例，render 的 _ctx 可访问。
export default {
  data() {
    return {
      text: "",
      multiline: false,
    };
  },
  computed: {
    store() {
      return window.__STORE;
    },
    // 按当前正在查看的会话判断，不是全局状态——会话A在后台生成不影响会话B的按钮显示，
    // 反之亦然。Vue 3 的 reactive() 对 Map 是深度响应式的，.has() 在 computed 里访问
    // 会被正确追踪，activeConversationId 或 activeGenerations 变化都会触发重算
    sending() {
      return window.__STORE_API.isSending(this.store.activeConversationId);
    },
  },
  watch: {
    sending(sending) {
      if (!sending) {
        this.$nextTick(() => {
          if (this.$refs.textareaRef) this.$refs.textareaRef.focus();
        });
      }
    },
  },
  methods: {
    // 开关状态持久化：切换时写 store + 存 settings，下次启动 initStoreFlags 从 settings 读回
    toggleRag() {
      this.store.ragEnabled = !this.store.ragEnabled;
      window.kb.settings.update({ ragDefaultEnabled: this.store.ragEnabled });
    },
    toggleThinking() {
      this.store.thinkingEnabled = !this.store.thinkingEnabled;
      window.kb.settings.update({ chatThinkingEnabled: this.store.thinkingEnabled });
    },
    autoResize() {
      const el = this.$refs.textareaRef;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = Math.min(160, el.scrollHeight) + "px";
      this.multiline = el.scrollHeight > 40;
    },
    onKeydown(e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.send();
      }
    },
    onSendClick() {
      if (this.sending) window.__STORE_API.stopSending();
      else this.send();
    },
    async send() {
      if (this.sending) return;
      const t = (this.text || "").trim();
      if (!t) return;
      this.text = "";
      this.$nextTick(() => this.autoResize());
      await window.__STORE_API.startSending(t, {
        ragEnabled: this.store.ragEnabled,
        thinkingEnabled: this.store.thinkingEnabled,
      });
    },
  },
};
</script>

<style scoped>
.composer {
  width: 100%;
}
</style>

<template>
  <div class="composer">
    <div class="composer-toggles">
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
      <button @click="onSendClick">{{ store.sending ? '终止' : '发送' }}</button>
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
  },
  watch: {
    "store.sending"(sending) {
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
      if (this.store.sending) window.__STORE_API.stopSending();
      else this.send();
    },
    async send() {
      if (this.store.sending) return;
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

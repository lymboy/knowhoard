import { normalizeClass as _normalizeClass, createElementVNode as _createElementVNode, openBlock as _openBlock, createElementBlock as _createElementBlock, createCommentVNode as _createCommentVNode, vModelText as _vModelText, withDirectives as _withDirectives, toDisplayString as _toDisplayString } from "../vue.runtime.js"

const _hoisted_1 = { class: "composer" }
const _hoisted_2 = { class: "composer-toggles" }

function render(_ctx, _cache) {
  return (_openBlock(), _createElementBlock("div", _hoisted_1, [
    _createElementVNode("div", _hoisted_2, [
      _createElementVNode("button", {
        type: "button",
        class: _normalizeClass(["mode-pill", { active: _ctx.store.ragEnabled }]),
        onClick: _cache[0] || (_cache[0] = (...args) => (_ctx.toggleRag && _ctx.toggleRag(...args)))
      }, "检索本地知识库", 2 /* CLASS */),
      (_ctx.store.thinkingSupported)
        ? (_openBlock(), _createElementBlock("button", {
            key: 0,
            type: "button",
            class: _normalizeClass(["mode-pill", { active: _ctx.store.thinkingEnabled }]),
            onClick: _cache[1] || (_cache[1] = (...args) => (_ctx.toggleThinking && _ctx.toggleThinking(...args)))
          }, "思考模式", 2 /* CLASS */))
        : _createCommentVNode("v-if", true)
    ]),
    _createElementVNode("div", {
      class: _normalizeClass(["composer-input", { multiline: _ctx.multiline }])
    }, [
      _withDirectives(_createElementVNode("textarea", {
        ref: "textareaRef",
        "onUpdate:modelValue": _cache[2] || (_cache[2] = $event => ((_ctx.text) = $event)),
        placeholder: "问点什么…（Enter 发送，Shift+Enter 换行）",
        rows: "1",
        onKeydown: _cache[3] || (_cache[3] = (...args) => (_ctx.onKeydown && _ctx.onKeydown(...args))),
        onInput: _cache[4] || (_cache[4] = (...args) => (_ctx.autoResize && _ctx.autoResize(...args)))
      }, null, 544 /* NEED_HYDRATION, NEED_PATCH */), [
        [_vModelText, _ctx.text]
      ]),
      _createElementVNode("button", {
        onClick: _cache[5] || (_cache[5] = (...args) => (_ctx.onSendClick && _ctx.onSendClick(...args)))
      }, _toDisplayString(_ctx.store.sending ? '终止' : '发送'), 1 /* TEXT */)
    ], 2 /* CLASS */)
  ]))
}

// Options API：methods/computed Vue 直接挂实例，render 的 _ctx 可访问。
export default { render,
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

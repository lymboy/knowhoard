import { toDisplayString as _toDisplayString, createElementVNode as _createElementVNode, openBlock as _openBlock, createElementBlock as _createElementBlock, createCommentVNode as _createCommentVNode, renderList as _renderList, Fragment as _Fragment, resolveComponent as _resolveComponent, createBlock as _createBlock, createVNode as _createVNode } from "../vue.runtime.js"

const _hoisted_1 = { class: "chat-view-inner" }
const _hoisted_2 = { class: "chat-toolbar" }
const _hoisted_3 = { class: "chat-title" }
const _hoisted_4 = { class: "chat-toolbar-actions" }
const _hoisted_5 = {
  key: 0,
  class: "hint"
}
const _hoisted_6 = ["disabled"]

function render(_ctx, _cache) {
  const _component_MessageBubble = _resolveComponent("MessageBubble")
  const _component_Composer = _resolveComponent("Composer")

  return (_openBlock(), _createElementBlock("div", _hoisted_1, [
    _createElementVNode("div", _hoisted_2, [
      _createElementVNode("span", _hoisted_3, _toDisplayString(_ctx.title), 1 /* TEXT */),
      _createElementVNode("div", _hoisted_4, [
        (_ctx.store.selecting)
          ? (_openBlock(), _createElementBlock("span", _hoisted_5, "已选 " + _toDisplayString(_ctx.store.selectedMessageIds.size) + " 条", 1 /* TEXT */))
          : _createCommentVNode("v-if", true),
        (_ctx.store.selecting)
          ? (_openBlock(), _createElementBlock("button", {
              key: 1,
              class: "danger",
              onClick: _cache[0] || (_cache[0] = (...args) => (_ctx.deleteSelected && _ctx.deleteSelected(...args))),
              disabled: !_ctx.store.selectedMessageIds.size
            }, "删除选中", 8 /* PROPS */, _hoisted_6))
          : _createCommentVNode("v-if", true),
        _createElementVNode("button", {
          onClick: _cache[1] || (_cache[1] = (...args) => (_ctx.toggleSelectMode && _ctx.toggleSelectMode(...args)))
        }, _toDisplayString(_ctx.store.selecting ? '取消批量' : '批量删除'), 1 /* TEXT */)
      ])
    ]),
    _createElementVNode("div", {
      ref: "messagesRef",
      class: "messages",
      onScroll: _cache[2] || (_cache[2] = (...args) => (_ctx.onScroll && _ctx.onScroll(...args)))
    }, [
      (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.store.messages, (m, i) => {
        return (_openBlock(), _createBlock(_component_MessageBubble, {
          key: m.id || ('idx-' + i),
          msg: m
        }, null, 8 /* PROPS */, ["msg"]))
      }), 128 /* KEYED_FRAGMENT */))
    ], 544 /* NEED_HYDRATION, NEED_PATCH */),
    _createVNode(_component_Composer)
  ]))
}

// Options API（非 <script setup>）：methods/computed/data 由 Vue 直接挂到实例，
// render 里 _ctx.xxx 一定可访问、响应式追踪正常。之前 <script setup> 手拼产物在
// setup 返回值与 render 上下文的关联上缺胶水，导致 _ctx 拿不到暴露值、响应式失效。

import MessageBubble from "./MessageBubble.js";
import Composer from "./Composer.js";

const NEAR_BOTTOM = 80;
const LOAD_MORE_THRESHOLD = 80;

export default { render,
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

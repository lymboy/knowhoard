import { normalizeClass as _normalizeClass, createElementVNode as _createElementVNode, toDisplayString as _toDisplayString, openBlock as _openBlock, createElementBlock as _createElementBlock } from "../vue.runtime.js"

const _hoisted_1 = { class: "ai-status" }

function render(_ctx, _cache) {
  return (_openBlock(), _createElementBlock("div", _hoisted_1, [
    _createElementVNode("span", {
      class: _normalizeClass(['status-dot', _ctx.dotClass])
    }, null, 2 /* CLASS */),
    _createElementVNode("span", null, _toDisplayString(_ctx.text), 1 /* TEXT */)
  ]))
}

// Options API：computed Vue 直接挂实例，render 的 _ctx 可访问，响应式正常。
// 之前 app.js 直接 bar.textContent 覆盖整个容器，把里面的 status-dot span 一起清没了，
// 样式改的类名从来没生效过。Vue 这里 DOM 从状态派生，dotClass 绑到 :class，不会互相覆盖。
export default { render,
  computed: {
    store() {
      return window.__STORE;
    },
    text() {
      return this.store.aiStatus.text;
    },
    dotClass() {
      return this.store.aiStatus.dotClass;
    },
  },
};

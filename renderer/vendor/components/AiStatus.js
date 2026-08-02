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
import { computed } from "../vue.runtime.js";
import { store } from "../../store.js";

// 之前 app.js 直接 bar.textContent 覆盖整个容器，把里面的 status-dot span 一起清没了，
// 样式改的类名从来没生效过。Vue 这里 DOM 从状态派生，dotClass 绑到 :class，不会互相覆盖。

export default { render,
  __name: 'AiStatus',
  setup(__props, { expose: __expose }) {
  __expose();

const text = computed(() => store.aiStatus.text);
const dotClass = computed(() => store.aiStatus.dotClass);

const __returned__ = { text, dotClass, get computed() { return computed }, get store() { return store } }
Object.defineProperty(__returned__, '__isScriptSetup', { enumerable: false, value: true })
return __returned__
}

}
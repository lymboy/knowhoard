import { toDisplayString as _toDisplayString, createElementVNode as _createElementVNode, renderList as _renderList, Fragment as _Fragment, openBlock as _openBlock, createElementBlock as _createElementBlock, normalizeClass as _normalizeClass } from "../vue.runtime.js"

const _hoisted_1 = ["open"]
const _hoisted_2 = { class: "tool-calls-body" }
const _hoisted_3 = { class: "tool-call-name" }

function render(_ctx, _cache) {
  return (_openBlock(), _createElementBlock("details", {
    class: "tool-calls",
    open: _ctx.open
  }, [
    _createElementVNode("summary", null, "调用了 " + _toDisplayString(_ctx.toolCalls.length) + " 个工具", 1 /* TEXT */),
    _createElementVNode("div", _hoisted_2, [
      (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.toolCalls, (tc, i) => {
        return (_openBlock(), _createElementBlock("div", {
          key: i,
          class: "tool-call-entry"
        }, [
          _createElementVNode("div", _hoisted_3, "🔧 " + _toDisplayString(_ctx.displayName(tc.name)), 1 /* TEXT */),
          _createElementVNode("div", {
            class: _normalizeClass(tc.ok === false ? 'tool-call-result tool-call-error' : 'tool-call-result')
          }, _toDisplayString(tc.result || (tc.status === '执行中…' ? '执行中…' : '完成')), 3 /* TEXT, CLASS */)
        ]))
      }), 128 /* KEYED_FRAGMENT */))
    ])
  ], 8 /* PROPS */, _hoisted_1))
}

// Options API：methods Vue 直接挂实例。
export default { render,
  props: {
    toolCalls: { type: Array, default: () => [] },
    open: { type: Boolean, default: false },
  },
  methods: {
    displayName(name) {
      if (!name) return "";
      return name.includes("__") ? name.split("__").slice(1).join("__") : name;
    },
  },
};

import { renderList as _renderList, Fragment as _Fragment, openBlock as _openBlock, createElementBlock as _createElementBlock, toDisplayString as _toDisplayString } from "../vue.runtime.js"

const _hoisted_1 = { class: "citations" }
const _hoisted_2 = ["title", "onClick"]

function render(_ctx, _cache) {
  return (_openBlock(), _createElementBlock("div", _hoisted_1, [
    (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.citations, (c, i) => {
      return (_openBlock(), _createElementBlock("button", {
        key: i,
        type: "button",
        class: "citation-chip",
        title: _ctx.isUrl(c.path) ? ('点击在浏览器中打开：' + c.path) : ('点击在 Finder 中查看：' + c.path),
        onClick: $event => (_ctx.openCitation(c))
      }, "[来源" + _toDisplayString(c.num || (i + 1)) + "] " + _toDisplayString(c.filename), 9 /* TEXT, PROPS */, _hoisted_2))
    }), 128 /* KEYED_FRAGMENT */))
  ]))
}

// Options API：methods Vue 直接挂实例。
export default { render,
  props: {
    citations: { type: Array, default: () => [] },
  },
  methods: {
    isUrl(p) {
      return /^https?:\/\//.test(p || "");
    },
    openCitation(c) {
      if (this.isUrl(c.path)) window.kb.shell.openExternal(c.path);
      else window.kb.documents.openInFinder(c.path);
    },
  },
};

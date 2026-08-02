import { createElementVNode as _createElementVNode, toDisplayString as _toDisplayString, openBlock as _openBlock, createElementBlock as _createElementBlock, createCommentVNode as _createCommentVNode, resolveComponent as _resolveComponent, createBlock as _createBlock, Fragment as _Fragment, normalizeClass as _normalizeClass } from "../vue.runtime.js"

const _hoisted_1 = ["data-message-id"]
const _hoisted_2 = ["src", "alt"]
const _hoisted_3 = { class: "msg-content" }
const _hoisted_4 = {
  key: 0,
  class: "reasoning"
}
const _hoisted_5 = { class: "reasoning-body" }
const _hoisted_6 = { key: 0 }
const _hoisted_7 = ["innerHTML"]
const _hoisted_8 = { class: "bubble-actions" }
const _hoisted_9 = ["checked"]

function render(_ctx, _cache) {
  const _component_ToolCallsBlock = _resolveComponent("ToolCallsBlock")
  const _component_CitationChips = _resolveComponent("CitationChips")

  return (_openBlock(), _createElementBlock("div", {
    class: _normalizeClass(['msg', _ctx.msg.role, { selected: _ctx.selected }]),
    "data-message-id": _ctx.msg.id
  }, [
    _createElementVNode("img", {
      class: "avatar",
      src: _ctx.avatarSrc,
      alt: _ctx.msg.role === 'user' ? '我' : '小怪兽'
    }, null, 8 /* PROPS */, _hoisted_2),
    _createElementVNode("div", _hoisted_3, [
      (_ctx.msg.reasoning)
        ? (_openBlock(), _createElementBlock("details", _hoisted_4, [
            _cache[3] || (_cache[3] = _createElementVNode("summary", null, "思考过程", -1 /* CACHED */)),
            _createElementVNode("div", _hoisted_5, _toDisplayString(_ctx.msg.reasoning), 1 /* TEXT */)
          ]))
        : _createCommentVNode("v-if", true),
      (_ctx.msg.toolCalls && _ctx.msg.toolCalls.length)
        ? (_openBlock(), _createBlock(_component_ToolCallsBlock, {
            key: 1,
            "tool-calls": _ctx.msg.toolCalls,
            open: _ctx.msg.streaming
          }, null, 8 /* PROPS */, ["tool-calls", "open"]))
        : _createCommentVNode("v-if", true),
      _createElementVNode("div", {
        ref: "bubbleEl",
        class: _normalizeClass(['bubble', { 'markdown-body': _ctx.msg.role !== 'user', empty: _ctx.msg.streaming && !_ctx.msg.content }])
      }, [
        (_ctx.msg.role === 'user')
          ? (_openBlock(), _createElementBlock("span", _hoisted_6, _toDisplayString(_ctx.msg.content), 1 /* TEXT */))
          : (_ctx.msg.streaming && !_ctx.msg.content)
            ? (_openBlock(), _createElementBlock(_Fragment, { key: 1 }, [
                _createCommentVNode(" 助手消息：流式时也用 markdown 渲染（v-html），但用固定间隔节流（每 150ms 重算一次），\n             避免每 token 全量 renderMarkdown 阻塞主线程。之前每 token 都解析导致积压卡顿；\n             改纯文本又丢了流式 markdown 体验。固定间隔节流兼顾两者：流式 markdown + 不阻塞 "),
                _cache[4] || (_cache[4] = _createElementVNode("span", { class: "generating-hint" }, "正在生成…", -1 /* CACHED */))
              ], 2112 /* STABLE_FRAGMENT, DEV_ROOT_FRAGMENT */))
            : (_openBlock(), _createElementBlock("div", {
                key: 2,
                innerHTML: _ctx.htmlContent
              }, null, 8 /* PROPS */, _hoisted_7))
      ], 2 /* CLASS */),
      (_ctx.msg.citations && _ctx.msg.citations.length)
        ? (_openBlock(), _createBlock(_component_CitationChips, {
            key: 2,
            citations: _ctx.msg.citations
          }, null, 8 /* PROPS */, ["citations"]))
        : _createCommentVNode("v-if", true),
      _createCommentVNode(" 复制 + 收藏：所有消息都有这两个按钮（原 app.js 设计如此，用户消息也能收藏）。\n           收藏需 msg.id（落库后才有），流式中没 id 时收藏按钮先不显示，落库后自动出现 "),
      _createElementVNode("div", _hoisted_8, [
        _createElementVNode("button", {
          onClick: _cache[0] || (_cache[0] = (...args) => (_ctx.copyContent && _ctx.copyContent(...args)))
        }, _toDisplayString(_ctx.copied ? '已复制' : '复制'), 1 /* TEXT */),
        (_ctx.msg.id)
          ? (_openBlock(), _createElementBlock("button", {
              key: 0,
              class: _normalizeClass({ favorited: _ctx.msg.favorited }),
              onClick: _cache[1] || (_cache[1] = (...args) => (_ctx.toggleFavorite && _ctx.toggleFavorite(...args)))
            }, _toDisplayString(_ctx.msg.favorited ? '★ 已收藏' : '☆ 收藏'), 3 /* TEXT, CLASS */))
          : _createCommentVNode("v-if", true)
      ])
    ]),
    (_ctx.store.selecting)
      ? (_openBlock(), _createElementBlock("input", {
          key: 0,
          type: "checkbox",
          class: "msg-select-checkbox",
          checked: _ctx.selected,
          onChange: _cache[2] || (_cache[2] = (...args) => (_ctx.onSelectToggle && _ctx.onSelectToggle(...args)))
        }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_9))
      : _createCommentVNode("v-if", true)
  ], 10 /* CLASS, PROPS */, _hoisted_1))
}

// Options API：methods/computed Vue 直接挂实例，render 的 _ctx 可访问，响应式正常。
import { renderMarkdown, highlightAndRenderDiagrams } from "../../markdown.js";
import ToolCallsBlock from "./ToolCallsBlock.js";
import CitationChips from "./CitationChips.js";

export default { render,
  components: { ToolCallsBlock, CitationChips },
  props: {
    msg: { type: Object, required: true },
  },
  data() {
    return { htmlContent: "", _htmlTimer: null, _lastRenderAt: 0, _enhanced: false, copied: false, _copyTimer: null };
  },
  computed: {
    store() {
      return window.__STORE;
    },
    avatarSrc() {
      return this.msg.role === "user" ? "../build/user-avatar.png" : "../build/mascot-cropped.png";
    },
    selected() {
      return !!this.msg.id && this.store.selectedMessageIds.has(this.msg.id);
    },
  },
  watch: {
    // 流式 content 节流渲染 markdown：每 token 都 renderMarkdown 全量解析会阻塞主线程，
    // 导致 delta 积压、正文最后一下蹦出（打字机效果消失）。改成节流——流式中最多每 150ms
    // 重算一次 html，结束时立即最终渲染 + 高亮。
    "msg.content"() {
      if (this.msg.role === "user") return;
      this.scheduleHtmlRender(false);
    },
    // 流式结束：立即最终渲染 + 增强（hljs/mermaid）
    "msg.streaming"(streaming, oldStreaming) {
      if (!streaming && oldStreaming && this.msg.role !== "user") {
        this.scheduleHtmlRender(true);
        this.$nextTick(() => this.enhance());
      }
    },
  },
  mounted() {
    if (this.msg.role !== "user") {
      this.htmlContent = renderMarkdown(this.msg.content || "");
      if (!this.msg.streaming) this.$nextTick(() => this.enhance());
    }
  },
  beforeUnmount() {
    if (this._htmlTimer) clearTimeout(this._htmlTimer);
  },
  methods: {
    // 节流渲染 markdown：每 token 都 renderMarkdown 全量解析会阻塞主线程。
    // 用"固定间隔"节流——距上次渲染 ≥150ms 就立即渲染，否则跳过（下次 delta 再判断）。
    // 不能用 setTimeout 重置式节流：token 间隔 <150ms 时 timer 被不断重置，流式期间一次都不渲染，
    // 直到流结束才蹦出（之前就是这个 bug）。
    scheduleHtmlRender(force) {
      if (this._htmlTimer) { clearTimeout(this._htmlTimer); this._htmlTimer = null; }
      if (force) {
        this._lastRenderAt = 0;
        this.htmlContent = renderMarkdown(this.msg.content || "");
        return;
      }
      const now = Date.now();
      if (now - (this._lastRenderAt || 0) >= 150) {
        this._lastRenderAt = now;
        this.htmlContent = renderMarkdown(this.msg.content || "");
      }
    },
    enhance() {
      const el = this.$refs.bubbleEl;
      if (!el) return;
      el.querySelectorAll("pre code:not(.hljs)").forEach((block) => {
        if (block.closest(".mermaid")) return;
        try { window.hljs.highlightElement(block); } catch (e) {}
        this.wrapCodeChrome(block);
      });
      const mmds = el.querySelectorAll("pre.mermaid");
      if (mmds.length) {
        window.mermaid.run({ nodes: Array.from(mmds) }).catch(() => {});
      }
      try {
        window.renderMathInElement(el, {
          delimiters: [
            { left: "$$", right: "$$", display: true },
            { left: "\\[", right: "\\]", display: true },
            { left: "$", right: "$", display: false },
            { left: "\\(", right: "\\)", display: false },
          ],
          throwOnError: false,
        });
      } catch (e) {}
    },
    wrapCodeChrome(codeEl) {
      const pre = codeEl.parentElement;
      if (!pre || pre.parentElement?.classList.contains("code-block")) return;
      if (pre.dataset.chromed) return;
      pre.dataset.chromed = "1";
      const langMatch = (codeEl.className || "").match(/language-(\S+)/);
      const lang = langMatch ? langMatch[1] : "text";
      const wrapper = document.createElement("div");
      wrapper.className = "code-block";
      const header = document.createElement("div");
      header.className = "code-block-header";
      const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      header.innerHTML = '<span class="lang">' + esc(lang) + '</span><button class="copy-btn">复制</button>';
      header.querySelector(".copy-btn").addEventListener("click", () => {
        navigator.clipboard.writeText(codeEl.textContent || "");
        const btn = header.querySelector(".copy-btn");
        btn.textContent = "已复制";
        setTimeout(() => (btn.textContent = "复制"), 1500);
      });
      pre.parentElement.insertBefore(wrapper, pre);
      wrapper.appendChild(header);
      wrapper.appendChild(pre);
    },
    copyContent() {
      try {
        navigator.clipboard.writeText(this.msg.content || "");
      } catch (e) {}
      this.copied = true;
      if (this._copyTimer) clearTimeout(this._copyTimer);
      this._copyTimer = setTimeout(() => { this.copied = false; }, 1200);
    },
    async toggleFavorite() {
      if (!this.msg.id) return;
      if (this.msg.favorited) {
        await window.kb.favorites.remove(this.msg.id);
        this.msg.favorited = false;
      } else {
        await window.kb.favorites.add(this.msg.id, this.store.activeConversationId);
        this.msg.favorited = true;
      }
    },
    onSelectToggle(e) {
      if (!this.msg.id) return;
      if (e.target.checked) this.store.selectedMessageIds.add(this.msg.id);
      else this.store.selectedMessageIds.delete(this.msg.id);
      this.store.selectedMessageIds = new Set(this.store.selectedMessageIds);
    },
  },
};

import { createElementVNode as _createElementVNode, renderList as _renderList, Fragment as _Fragment, openBlock as _openBlock, createElementBlock as _createElementBlock, toDisplayString as _toDisplayString, withModifiers as _withModifiers, createCommentVNode as _createCommentVNode, vModelText as _vModelText, withKeys as _withKeys, withDirectives as _withDirectives, normalizeClass as _normalizeClass } from "../vue.runtime.js"

const _hoisted_1 = { class: "conversation-list-inner" }
const _hoisted_2 = { class: "conversation-items" }
const _hoisted_3 = ["onClick", "onDblclick"]
const _hoisted_4 = ["onBlur", "onKeydown"]
const _hoisted_5 = ["onClick"]

function render(_ctx, _cache) {
  return (_openBlock(), _createElementBlock("div", _hoisted_1, [
    _createElementVNode("button", {
      class: "new-conversation",
      onClick: _cache[0] || (_cache[0] = (...args) => (_ctx.createConversation && _ctx.createConversation(...args)))
    }, "+ 新建会话"),
    _createElementVNode("div", _hoisted_2, [
      (_openBlock(true), _createElementBlock(_Fragment, null, _renderList(_ctx.store.conversations, (conv) => {
        return (_openBlock(), _createElementBlock("div", {
          key: conv.id,
          class: _normalizeClass(['conversation-item', { active: conv.id === _ctx.store.activeConversationId }])
        }, [
          (_ctx.editingId !== conv.id)
            ? (_openBlock(), _createElementBlock("span", {
                key: 0,
                class: "title",
                title: '双击重命名',
                onClick: $event => (_ctx.onTitleClick(conv)),
                onDblclick: _withModifiers($event => (_ctx.startEdit(conv)), ["stop"])
              }, _toDisplayString(conv.title), 41 /* TEXT, PROPS, NEED_HYDRATION */, _hoisted_3))
            : _withDirectives((_openBlock(), _createElementBlock("input", {
                key: 1,
                ref_for: true,
                ref: "editInputs",
                "onUpdate:modelValue": _cache[1] || (_cache[1] = $event => ((_ctx.editingTitle) = $event)),
                class: "title-edit-input",
                onBlur: $event => (_ctx.commitEdit(conv)),
                onKeydown: [
                  _withKeys($event => (_ctx.commitEdit(conv)), ["enter"]),
                  _cache[2] || (_cache[2] = _withKeys((...args) => (_ctx.cancelEdit && _ctx.cancelEdit(...args)), ["esc"]))
                ]
              }, null, 40 /* PROPS, NEED_HYDRATION */, _hoisted_4)), [
                [_vModelText, _ctx.editingTitle]
              ]),
          _createElementVNode("button", {
            class: "del",
            title: "删除",
            onClick: _withModifiers($event => (_ctx.removeConversation(conv)), ["stop"])
          }, "×", 8 /* PROPS */, _hoisted_5)
        ], 2 /* CLASS */))
      }), 128 /* KEYED_FRAGMENT */))
    ])
  ]))
}

// 用 Options API 而非 <script setup>：methods 里的函数 Vue 直接挂到组件实例，
// render 里 _ctx.onTitleClick 一定可调。之前 <script setup> 手拼产物在 setup 返回值
// 与 render 上下文关联上缺胶水，导致 _ctx.onTitleClick undefined。

const PAGE_SIZE = 30;

export default { render,
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

<template>
  <div class="conversation-list-inner">
    <button class="new-conversation" @click="createConversation">+ 新建会话</button>
    <div class="conversation-items">
      <div
        v-for="conv in store.conversations"
        :key="conv.id"
        :class="['conversation-item', { active: conv.id === store.activeConversationId }]"
      >
        <span
          v-if="editingId !== conv.id"
          class="title"
          :title="'双击重命名'"
          @click="onTitleClick(conv)"
          @dblclick.stop="startEdit(conv)"
        >{{ conv.title }}</span>
        <input
          v-else
          ref="editInputs"
          v-model="editingTitle"
          class="title-edit-input"
          @blur="commitEdit(conv)"
          @keydown.enter="commitEdit(conv)"
          @keydown.esc="cancelEdit"
        />
        <button class="del" title="删除" @click.stop="removeConversation(conv)">×</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, nextTick } from "../vue.runtime.js";
import { store, loadConversations, loadConversation } from "../../store.js";

const kb = window.kb;

// 双击重命名：用 Vue 的状态切换，不再像 app.js 那样用 setTimeout 分辨单击/双击
// ——之前 click 先 loadConversations 重建 DOM，dblclick 时捕获的 titleEl 已是旧节点，
// replaceWith 换的是幽灵节点。这里 editingId 控制渲染哪个元素，不存在节点失效问题。
const editingId = ref(null);
const editingTitle = ref("");
const editInputs = ref([]);

// 单击切换会话。双击会先触发两次 click 再 dblclick——用 250ms 延迟分辨：
// 单击先等，真等到双击就取消单击动作
let clickTimer = null;
function onTitleClick(conv) {
  if (clickTimer) return;
  clickTimer = setTimeout(() => {
    clickTimer = null;
    void openConversation(conv.id);
  }, 250);
}

async function openConversation(id) {
  await loadConversation(id);
  // 通知 app.js 切了会话（app.js 还管着消息 DOM 等待 ChatView 迁过来）
  window.kbAppBridge?.openConversation?.(id);
}

async function createConversation() {
  const id = await kb.conversations.create("新会话");
  store.activeConversationId = id;
  await loadConversations();
  // 新会话：清空消息（store 层）+ 同步 app.js 的消息 DOM
  store.messages = [];
  store.pageState = { conversationId: id, oldestCreatedAt: null, hasMore: false, loadingOlder: false };
  window.kbAppBridge?.setChatTitle?.("新会话");
  // 清掉 app.js 侧的消息 DOM（新会话是空的）
  const messagesEl = document.getElementById("messages");
  if (messagesEl) messagesEl.innerHTML = "";
  window.kbAppBridge?.switchView?.("chat");
}

async function startEdit(conv) {
  // 取消可能挂着的单击切换
  if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
  editingId.value = conv.id;
  editingTitle.value = conv.title;
  await nextTick();
  // 聚焦最新那个 input（v-for 里 ref 数组，取最后一个）
  const inputs = editInputs.value;
  if (inputs && inputs.length) {
    const input = inputs[inputs.length - 1];
    input.focus();
    input.select();
  }
}

async function commitEdit(conv) {
  const newTitle = editingTitle.value.trim() || conv.title;
  editingId.value = null;
  if (newTitle !== conv.title) {
    await kb.conversations.rename(conv.id, newTitle);
    await loadConversations();
    // 改的正好是当前会话时，顶部标题栏是 app.js 管的另一份状态，通知它同步
    if (conv.id === store.activeConversationId) {
      window.kbAppBridge?.setChatTitle?.(newTitle);
    }
  }
}

function cancelEdit() {
  editingId.value = null;
}

async function removeConversation(conv) {
  // 复用 app.js 的确认对话框（还没迁 Vue）
  const ok = await window.kbAppBridge?.showConfirm?.(`删除会话「${conv.title}」？`);
  if (!ok) return;
  await kb.conversations.remove(conv.id);
  if (store.activeConversationId === conv.id) {
    store.activeConversationId = null;
    store.messages = [];
    // 清掉 app.js 侧消息 DOM
    const messagesEl = document.getElementById("messages");
    if (messagesEl) messagesEl.innerHTML = "";
    window.kbAppBridge?.setChatTitle?.("");
  }
  await loadConversations();
}
</script>

<style scoped>
.conversation-list-inner {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>

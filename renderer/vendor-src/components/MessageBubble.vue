<template>
  <div :class="['msg', msg.role, { selected: selected }]" :data-message-id="msg.id">
    <img class="avatar" :src="avatarSrc" :alt="msg.role === 'user' ? '我' : '小怪兽'" />
    <div class="msg-content">
      <details v-if="msg.reasoning" class="reasoning">
        <summary>思考过程</summary>
        <div class="reasoning-body">{{ msg.reasoning }}</div>
      </details>

      <ToolCallsBlock
        v-if="msg.toolCalls && msg.toolCalls.length"
        :tool-calls="msg.toolCalls"
        :open="msg.streaming"
      />

      <div ref="bubbleEl" :class="['bubble', { 'markdown-body': msg.role !== 'user', empty: msg.streaming && !msg.content }]">
        <span v-if="msg.role === 'user'">{{ msg.content }}</span>
        <!-- 助手消息：流式时也用 markdown 渲染（v-html），但用固定间隔节流（每 150ms 重算一次），
             避免每 token 全量 renderMarkdown 阻塞主线程。之前每 token 都解析导致积压卡顿；
             改纯文本又丢了流式 markdown 体验。固定间隔节流兼顾两者：流式 markdown + 不阻塞 -->
        <span v-else-if="msg.streaming && !msg.content" class="generating-hint">正在生成…</span>
        <div v-else v-html="htmlContent"></div>
      </div>

      <CitationChips v-if="msg.citations && msg.citations.length" :citations="msg.citations" />

      <!-- 复制 + 收藏：所有消息都有这两个按钮（原 app.js 设计如此，用户消息也能收藏）。
           收藏需 msg.id（落库后才有），流式中没 id 时收藏按钮先不显示，落库后自动出现 -->
      <div class="bubble-actions">
        <button @click="copyContent">{{ copied ? '已复制' : '复制' }}</button>
        <button v-if="msg.id" :class="{ favorited: msg.favorited }" @click="toggleFavorite">{{ msg.favorited ? '★ 已收藏' : '☆ 收藏' }}</button>
      </div>
    </div>

    <input v-if="store.selecting" type="checkbox" class="msg-select-checkbox" :checked="selected" @change="onSelectToggle" />
  </div>
</template>

<script>
// Options API：methods/computed Vue 直接挂实例，render 的 _ctx 可访问，响应式正常。
import { renderMarkdown, highlightAndRenderDiagrams } from "../../markdown.js";
import ToolCallsBlock from "./ToolCallsBlock.vue";
import CitationChips from "./CitationChips.vue";

export default {
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
      return this.msg.role === "user" ? "./user-avatar.png" : "./mascot-cropped.png";
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
      this.htmlContent = renderMarkdown(this.cleanContent(this.msg.content || ""));
      if (!this.msg.streaming) this.$nextTick(() => this.enhance());
    }
  },
  beforeUnmount() {
    if (this._htmlTimer) clearTimeout(this._htmlTimer);
  },
  methods: {
    // 清理正文里模型幻觉标出的超范围 [来源N]：只保留 citations 里真实存在的编号，
    // 不存在的 [来源N] 删掉。这样正文只显示真实来源编号，和气泡下引用列表一致——
    // 根治模型标了 [来源9] 但只有 7 个来源导致正文/列表数量对不上的问题。
    // 之前靠提示词约束模型不标超范围编号，但模型仍偶发幻觉，这里渲染兜底清理。
    cleanContent(content) {
      const cits = this.msg.citations || [];
      if (!cits.length) return content; // 没有引用就不清理（避免误删）
      // 用 citations 里的真实编号 num（后端 filterReferencedCitations 带 num），
      // 兼容老数据没 num 时按数组下标+1
      const validNums = new Set(cits.map((c, i) => c.num || i + 1));
      // 把不在 validNums 的 [来源N] 删掉。保留存在的——正文只显示真实来源编号，和引用列表一致
      return content.replace(/\[来源(\d+)\]/g, (match, n) => {
        return validNums.has(Number(n)) ? match : "";
      });
    },
    // 节流渲染 markdown：每 token 都 renderMarkdown 全量解析会阻塞主线程。
    // 用"固定间隔"节流——距上次渲染 ≥150ms 就立即渲染，否则跳过（下次 delta 再判断）。
    // 不能用 setTimeout 重置式节流：token 间隔 <150ms 时 timer 被不断重置，流式期间一次都不渲染，
    // 直到流结束才蹦出（之前就是这个 bug）。
    scheduleHtmlRender(force) {
      if (this._htmlTimer) { clearTimeout(this._htmlTimer); this._htmlTimer = null; }
      if (force) {
        this._lastRenderAt = 0;
        this.htmlContent = renderMarkdown(this.cleanContent(this.msg.content || ""));
        return;
      }
      const now = Date.now();
      if (now - (this._lastRenderAt || 0) >= 150) {
        this._lastRenderAt = now;
        this.htmlContent = renderMarkdown(this.cleanContent(this.msg.content || ""));
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
</script>

<style scoped>
/* 流式时纯文本显示，去掉 pre 默认样式，像普通正文一样 */
.bubble-raw {
  margin: 0;
  padding: 0;
  font: inherit;
  white-space: pre-wrap;
  word-break: break-word;
  background: transparent;
  border: none;
}
/* 首字等待期提示：模型 TTFT 期间让用户知道在生成，不是卡死 */
.generating-hint {
  color: var(--text-dim);
}
.bubble.empty::after {
  content: "";
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
  animation: pulse 1s infinite ease-in-out;
}
@keyframes pulse {
  0%, 100% { opacity: 0.2; }
  50% { opacity: 1; }
}
.bubble-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.15s ease;
  margin-top: 2px;
}
.msg:hover .bubble-actions {
  opacity: 1;
}
</style>

<template>
  <div class="favorites-view">
    <t-card class="panel" :bordered="false">
      <template #header><div class="panel-header"><h2>收藏</h2></div></template>
      <div v-if="!items.length" class="empty-hint">还没有收藏任何消息——在对话气泡下方点「收藏」就会出现在这里。</div>
      <div v-for="fav in items" :key="fav.id" class="favorite-item">
        <div class="favorite-meta">
          <span class="favorite-conv-title">{{ fav.conversationTitle }}</span>
          <span class="favorite-time">{{ formatFavoritedAt(fav.favoritedAt) }}</span>
        </div>
        <div ref="previews" :class="['favorite-preview','markdown-body',fav.role]" v-html="renderHtml(fav.content)"></div>
        <div v-if="fav.citations && fav.citations.length" class="citations">
          <button v-for="(c,i) in fav.citations" :key="i" type="button" class="citation-chip"
            :title="isUrl(c.path) ? `点击在浏览器中打开：${c.path}` : `点击在 Finder 中查看：${c.path}`"
            @click="openCitation(c)">{{ `[来源${i+1}] ${c.filename}` }}</button>
        </div>
        <div class="favorite-actions">
          <t-button size="small" variant="outline" @click="openConversation(fav.conversationId)">查看对话</t-button>
          <t-button size="small" theme="danger" variant="text" @click="unfav(fav)">取消收藏</t-button>
        </div>
      </div>
    </t-card>
  </div>
</template>

<script>
// 收藏视图：从 app.js refreshFavoritesView 迁移。预览用 markdown 渲染 + 高亮/公式增强。
import { renderMarkdown, highlightAndRenderDiagrams } from "../markdown.js";
import { store } from "../store.js";
const kb = () => window.kb;

export default {
  data() { return { items: [] }; },
  async activated() { await this.refresh(); },
  async mounted() { await this.refresh(); },
  methods: {
    async refresh() {
      this.items = await kb().favorites.list();
      this.$nextTick(() => {
        // 对每个预览块做高亮/mermaid/公式增强
        const els = this.$refs.previews || [];
        els.forEach(el => highlightAndRenderDiagrams(el));
      });
    },
    renderHtml(content) { return renderMarkdown(content); },
    isUrl(p) { return /^https?:\/\//.test(p); },
    openCitation(c) {
      if (this.isUrl(c.path)) kb().shell.openExternal(c.path);
      else kb().documents.openInFinder(c.path);
    },
    async openConversation(id) {
      store.view = "chat";
      if (window.__STORE_API?.loadConversation) await window.__STORE_API.loadConversation(id);
    },
    async unfav(fav) { await kb().favorites.remove(fav.id); this.refresh(); },
    formatFavoritedAt(ts) {
      const d = new Date(ts); const p = (n) => String(n).padStart(2,"0");
      return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    },
  },
};
</script>

<style scoped>
.favorites-view { display: flex; flex-direction: column; gap: 16px; }
.panel { background: var(--td-bg-color-container); }
.panel-header h2 { margin: 0; font-size: 16px; }
.empty-hint { color: var(--td-text-color-secondary); padding: 24px 0; text-align: center; }
.favorite-item { padding: 12px 0; border-bottom: 1px solid var(--td-component-stroke); }
.favorite-meta { display: flex; justify-content: space-between; margin-bottom: 8px; }
.favorite-conv-title { font-weight: 500; }
.favorite-time { color: var(--td-text-color-secondary); font-size: 12px; }
.favorite-preview { padding: 8px 12px; border-radius: 6px; background: var(--td-bg-color-secondarycontainer); font-size: 14px; }
.citations { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.citation-chip { background: var(--td-bg-color-secondarycontainer); border: 1px solid var(--td-component-stroke); border-radius: 4px; padding: 2px 8px; font-size: 12px; cursor: pointer; }
.citation-chip:hover { background: var(--td-brand-color-light); }
.favorite-actions { display: flex; gap: 8px; margin-top: 8px; }
</style>

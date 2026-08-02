<template>
  <div class="knowledge-view">
    <t-card class="panel src-panel" :bordered="false">
      <template #header>
        <div class="panel-header">
          <h2>数据源</h2>
          <div class="panel-actions">
            <t-button @click="addSource">添加目录 / 文件</t-button>
            <t-button @click="addObsidian">连接 Obsidian</t-button>
            <t-button theme="primary" @click="syncAll">全部同步</t-button>
          </div>
        </div>
      </template>
      <div class="stats-bar">{{ statsText }}</div>
      <div v-if="obsidianPickerVisible" class="obsidian-vault-picker">
        <div v-if="obsidianStatus===null" class="hint">检测中…</div>
        <template v-else>
          <div class="hint">检测到 Obsidian {{ obsidianStatus.running ? "正在运行" : "未运行" }}，选一个要连接的 vault：</div>
          <div class="src-list">
            <div v-for="v in obsidianStatus.vaults" :key="v.path" class="src-card">
              <div class="src-card-main">
                <div class="src-card-title">{{ v.name }}</div>
                <div class="src-card-path">{{ v.path }}</div>
              </div>
              <t-button :disabled="connectedPaths.has(v.path)" @click="connectVault(v)">{{ connectedPaths.has(v.path) ? "已连接" : "连接" }}</t-button>
            </div>
            <div v-if="!obsidianStatus.vaults.length" class="hint">没有检测到 Obsidian vault，请先在 Obsidian 里打开过至少一个仓库。</div>
          </div>
        </template>
      </div>
      <div class="src-list">
        <div v-for="s in sources" :key="s.id" class="src-card">
          <div class="src-card-main">
            <div class="src-card-title">{{ typeLabel(s.type) }} · {{ s.label }}</div>
            <div class="src-card-path">{{ s.path }} · 已索引 {{ (s.counts||{}).indexed || 0 }} / 出错 {{ (s.counts||{}).error || 0 }}</div>
          </div>
          <div class="actions">
            <t-button size="small" variant="outline" @click="syncSource(s)">同步</t-button>
            <t-button size="small" theme="danger" variant="text" @click="removeSource(s)">移除</t-button>
          </div>
        </div>
      </div>
      <div v-if="syncLog" class="sync-log">{{ syncLog }}</div>
    </t-card>

    <t-card class="panel doc-panel" :bordered="false">
      <template #header><div class="panel-header"><h2>浏览 / 按文件名找文档</h2></div></template>
      <t-input v-model="docQuery" class="doc-search" placeholder="按文件名、目录或内容关键词搜索…" @change="onDocSearchInput" clearable />
      <!-- 原生 div 列表（不用 t-list）：flex 链路自控，列表 flex:1 撑满剩余高度 + 内部滚，
           卡片用 gap 间距，全响应式不写死高度。视窗拉大列表区跟着拉大，不再底部留空白 -->
      <div class="doc-list">
        <div v-for="d in docs" :key="d.id" class="doc-card">
          <div class="doc-card-main">
            <div class="doc-card-title">
              <span>{{ d.filename }}</span>
              <span v-if="d.status==='error'" class="doc-error-badge" :title="d.error||'索引失败'">⚠️ 索引失败</span>
            </div>
            <div class="doc-card-path">{{ d.folder }}</div>
          </div>
          <div class="actions">
            <t-button size="small" variant="outline" @click="revealDoc(d)">在 Finder 中显示</t-button>
            <t-button size="small" theme="danger" variant="text" @click="removeDoc(d)">移除</t-button>
          </div>
        </div>
        <div v-if="!docs.length" class="hint doc-empty">没有匹配的文档</div>
      </div>
    </t-card>
  </div>
</template>

<script>
// 知识库视图：数据源管理 + 文档浏览 + Obsidian 连接 + 同步日志。从 app.js 忠实迁移。
import { showConfirm } from "../store.js";
const kb = () => window.kb;

export default {
  data() {
    return {
      statsText: "",
      sources: [],
      syncLog: "",
      obsidianPickerVisible: false,
      obsidianStatus: null,
      connectedPaths: new Set(),
      docQuery: "",
      docs: [],
      _docSearchTimer: null,
      _lastStatsRefreshAt: 0,
      _progressBound: false,
    };
  },
  async activated() { await this.refreshKnowledgeView(); this.bindProgress(); },
  async mounted() { await this.refreshKnowledgeView(); this.bindProgress(); },
  methods: {
    typeLabel(t) { return { folder:"目录", file:"文件", obsidian_vault:"Obsidian Vault" }[t] || t; },
    async refreshSourceStats() {
      const stats = await kb().documents.stats();
      this.statsText = `文档 ${stats.documents} 篇 · 已索引 ${stats.indexed} 篇 · 分块 ${stats.chunks} 个`;
      this.sources = await kb().sources.list();
    },
    async refreshDocList() {
      const docs = await kb().documents.list({ query: this.docQuery.trim() });
      this.docs = docs;
    },
    async refreshKnowledgeView() { await this.refreshSourceStats(); await this.refreshDocList(); },
    bindProgress() {
      if (this._progressBound) return;
      this._progressBound = true;
      kb().sources.onProgress((event) => {
        const line = {
          scanning:`扫描中：${event.source}`,
          "file-start":`索引中：${event.path} (${event.done}/${event.total})`,
          "file-skip":null,
          "file-done":`完成：${event.path}`,
          "file-error":`失败：${event.path} — ${event.error}`,
          deleted:`已移除：${event.path}`,
          done:`同步完成：${event.source}`,
          "scan-failed":`⚠️ 扫描失败，本次同步已中止，索引未改动：${event.error}`,
          "scan-suspicious":`⚠️ ${event.error}`,
        }[event.phase];
        if (line) this.syncLog = line;
        if (store_view() !== "knowledge") return;
        const isTerminal = ["file-done","file-error","deleted","done"].includes(event.phase);
        const now = Date.now();
        if (isTerminal && (event.phase === "done" || now - this._lastStatsRefreshAt > 800)) {
          this._lastStatsRefreshAt = now;
          this.refreshSourceStats();
        }
      });
    },
    async addSource() {
      const ids = await kb().sources.add();
      if (ids && ids.length) this.refreshKnowledgeView();
    },
    async syncAll() {
      this.syncLog = "同步中…";
      await kb().sources.sync(null);
      this.refreshKnowledgeView();
    },
    async syncSource(s) { await kb().sources.sync(s.id); this.refreshKnowledgeView(); },
    async removeSource(s) {
      if (!(await showConfirm(`移除数据源「${s.label}」？已索引内容会一并删除，原始文件不受影响。`, { okDanger:true }))) return;
      await kb().sources.remove(s.id);
      this.refreshKnowledgeView();
    },
    async addObsidian() {
      this.obsidianPickerVisible = true;
      this.obsidianStatus = null;
      const [status, existingSources] = await Promise.all([kb().obsidian.status(), kb().sources.list()]);
      this.obsidianStatus = status;
      this.connectedPaths = new Set(existingSources.filter(s => s.type === "obsidian_vault").map(s => s.path));
    },
    async connectVault(vault) {
      await kb().sources.addObsidianVault(vault);
      this.obsidianPickerVisible = false;
      this.refreshKnowledgeView();
    },
    revealDoc(d) { kb().documents.openInFinder(d.path); },
    async removeDoc(d) {
      if (!(await showConfirm(`把「${d.filename}」从索引里移除？原始文件不受影响，随时可以重新同步加回来。`, { okDanger:true }))) return;
      await kb().documents.removeOne(d.id);
      this.refreshDocList();
      this.refreshSourceStats();
    },
    onDocSearchInput() {
      clearTimeout(this._docSearchTimer);
      this._docSearchTimer = setTimeout(()=>this.refreshDocList(), 250);
    },
  },
};
function store_view() { return window.__STORE?.view; }
</script>

<style scoped>
/* 响应式 flex 链路（全 flex，不写死 px，任意视窗自适应）。每层都 display:flex column + min-height:0：
   knowledge-view(flex:1 撑满 content) → src-panel(自然高 flex-shrink:0) + doc-panel(flex:1 撑剩余)
   → doc-panel 内 header(自然高) + body(flex:1) → body 内 搜索框(自然高) + doc-list(flex:1 + 滚) */
.knowledge-view { display: flex; flex-direction: column; gap: 16px; flex: 1; min-height: 0; }
.panel { background: var(--td-bg-color-container); }
/* 数据源可能很多项，限高到容器 38%（百分比响应式，非写死 px），超出内部滚；
   flex-shrink:0 不被压缩，doc-panel flex:1 拿剩余大头 */
.panel.src-panel { flex: 0 0 auto; max-height: 38%; min-height: 0; display: flex; flex-direction: column; }
.panel.src-panel :deep(.t-card__header) { flex-shrink: 0; }
.panel.src-panel :deep(.t-loading__parent) { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.panel.src-panel :deep(.t-card__body) { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; }
.panel.doc-panel { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.panel.doc-panel :deep(.t-card__header) { flex-shrink: 0; }
/* t-card 的 body 外面被 .t-loading__parent 包裹（t-card loading 容器），它默认 flex:0 1 auto 不撑开，
   是 flex 链路断点。给它 flex:1 + min-height:0 让它撑满 doc-panel 剩余，body 再 flex:1 传给 doc-list */
.panel.doc-panel :deep(.t-loading__parent) { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.panel.doc-panel :deep(.t-card__body) { flex: 1; min-height: 0; display: flex; flex-direction: column; }
/* 数据源/ vault 列表：原生 div 卡片，gap 间距（跟文档列表统一），撑满 src-panel body */
.src-list { display: flex; flex-direction: column; gap: 10px; flex: 1; min-height: 0; }
.src-card {
  display: flex; align-items: center; justify-content: space-between;
  background: var(--td-bg-color-container);
  border: 1px solid var(--td-component-stroke);
  border-radius: 10px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.05);
  padding: 10px 16px; flex-shrink: 0;
  transition: box-shadow 0.15s, border-color 0.15s;
}
.src-card:hover { border-color: var(--td-brand-color); box-shadow: 0 2px 10px rgba(0,0,0,0.09); }
.src-card-main { min-width: 0; flex: 1; }
.src-card-title { font-size: 13px; font-weight: 500; color: var(--td-text-color-primary); line-height: 1.4; }
.src-card-path { font-size: 11.5px; color: var(--td-text-color-placeholder); margin-top: 3px; line-height: 1.5; word-break: break-all; }
.doc-search { flex-shrink: 0; }
.doc-list {
  flex: 1; min-height: 0; overflow-y: auto;
  display: flex; flex-direction: column; gap: 10px;
  margin-top: 12px; padding-right: 4px;
}
.doc-card {
  display: flex; align-items: center; justify-content: space-between;
  background: var(--td-bg-color-container);
  border: 1px solid var(--td-component-stroke);
  border-radius: 10px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.05);
  padding: 10px 16px;
  flex-shrink: 0;
  transition: box-shadow 0.15s, border-color 0.15s;
}
.doc-card:hover { border-color: var(--td-brand-color); box-shadow: 0 2px 10px rgba(0,0,0,0.09); }
.doc-card-main { min-width: 0; flex: 1; }
.doc-card-title { font-size: 13px; font-weight: 500; color: var(--td-text-color-primary); line-height: 1.4; }
.doc-card-path { font-size: 11.5px; color: var(--td-text-color-placeholder); margin-top: 3px; line-height: 1.5; word-break: break-all; }
.doc-empty { text-align: center; padding: 32px 0; }

.panel-header { display: flex; align-items: center; justify-content: space-between; width: 100%; }
.panel-header h2 { margin: 0; font-size: 16px; }
.panel-actions { display: flex; gap: 8px; }
.stats-bar { color: var(--td-text-color-secondary); font-size: 13px; margin-bottom: 12px; }
.actions { display: flex; gap: 4px; flex-shrink: 0; }
.doc-error-badge { color: var(--td-error-color); font-size: 12px; margin-left: 6px; }
.sync-log { margin-top: 8px; font-size: 13px; color: var(--td-text-color-secondary); }
.obsidian-vault-picker { padding: 8px 0; }
.hint { color: var(--td-text-color-secondary); font-size: 13px; }
</style>

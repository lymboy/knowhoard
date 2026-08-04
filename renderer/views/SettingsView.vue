<template>
  <div class="settings-view">
    <!-- Token 用量 -->
    <t-card class="panel" :bordered="false" title="Token 用量">
      <div class="usage-summary">
        <div class="usage-stat"><div class="usage-label">今天</div><div class="usage-value">{{ usageDisplay.today }}</div></div>
        <div class="usage-stat"><div class="usage-label">本周</div><div class="usage-value">{{ usageDisplay.week }}</div></div>
        <div class="usage-stat"><div class="usage-label">本月</div><div class="usage-value">{{ usageDisplay.month }}</div></div>
      </div>
      <svg ref="usageChartEl" class="usage-chart" viewBox="0 0 700 180" preserveAspectRatio="none"></svg>
      <div class="usage-legend">
        <span><i class="legend-dot prompt"></i>输入</span>
        <span><i class="legend-dot completion"></i>输出</span>
        <div class="usage-granularity">
          <t-button v-for="g in ['minute','hour','day']" :key="g" size="small" :variant="granularity===g?'base':'outline'"
            @click="switchGranularity(g)">{{ g==='day'?'按天':g==='hour'?'按小时':'按分钟' }}</t-button>
        </div>
      </div>
    </t-card>

    <!-- LLM 配置 -->
    <t-card class="panel" :bordered="false" title="LLM 配置（OpenAI 兼容接口）">
      <t-form label-width="120" label-align="top" @submit.prevent>
        <div class="form-grid">
          <t-form-item label="Base URL"><t-input v-model="llm.baseUrl" placeholder="https://api.example.com/v1" @blur="refreshModelList" /></t-form-item>
          <t-form-item label="API Key (SK)"><t-input v-model="llm.apiKey" type="password" placeholder="sk-..." @blur="refreshModelList" /></t-form-item>
          <t-form-item label="模型名称" class="span-2">
            <t-select v-if="modelMode==='select'" v-model="llm.model" :options="modelOptions" filterable clearable />
            <t-input v-else v-model="llm.model" placeholder="填了 Base URL/API Key 后自动拉取模型列表，拉不到再手填" />
            <div class="hint">{{ modelListHint }}</div>
          </t-form-item>
        </div>

        <div class="header-rows-block">
          <div class="header-rows-title">自定义请求头（可选）</div>
          <div class="header-rows">
            <div v-for="(row,i) in customHeaders" :key="i" class="header-row">
              <t-input v-model="row.key" placeholder="请求头名称，例如 X-Api-Version" />
              <t-input v-model="row.value" placeholder="请求头值" />
              <t-button theme="default" variant="outline" shape="square" @click="customHeaders.splice(i,1)"><template #icon>−</template></t-button>
            </div>
          </div>
          <t-button theme="default" variant="dashed" size="small" @click="customHeaders.push({key:'',value:''})">+ 添加请求头</t-button>
        </div>

        <t-collapse class="advanced">
          <t-collapse-panel value="adv" header="高级参数">
            <div class="form-grid">
              <t-form-item label="Temperature"><t-input-number v-model="llm.temperature" :min="0" :max="2" :step="0.1" /></t-form-item>
              <t-form-item label="Top P"><t-input-number v-model="llm.topP" :min="0" :max="1" :step="0.05" /></t-form-item>
              <t-form-item label="Top K（部分网关支持）"><t-input-number v-model="llm.topK" :min="0" :step="1" /></t-form-item>
              <t-form-item label="Max Tokens（留空不限）"><t-input-number v-model="llm.maxTokens" :min="1" :step="1" /></t-form-item>
            </div>
          </t-collapse-panel>
        </t-collapse>

        <div class="s-row">
          <t-button theme="default" variant="outline" @click="probeThinking">检测是否支持思考模式</t-button>
          <span class="hint">{{ thinkingProbeResult }}</span>
        </div>
        <div class="s-row">
          <t-button theme="primary" @click="saveLlm">保存</t-button>
          <span class="hint">{{ llmSaveHint }}</span>
        </div>
      </t-form>
    </t-card>

    <!-- 系统提示词 -->
    <t-card class="panel" :bordered="false" title="系统提示词">
      <t-textarea v-model="systemPrompt" :autosize="{minRows:4}" placeholder="在内置提示词基础上追加你的要求（比如语气、人设），不会覆盖引用标注等内置行为" />
      <div class="s-row">
        <t-button theme="primary" @click="saveSystemPrompt">保存</t-button>
        <span class="hint">{{ systemPromptSaveHint }}</span>
      </div>
    </t-card>

    <!-- 工具设置 -->
    <t-card class="panel" :bordered="false" title="工具设置">
      <template #actions>
        <div class="tool-master-toggle">
          <span>启用工具</span>
          <t-switch v-model="toolsEnabled" @change="onToolsMasterToggle" />
        </div>
      </template>

      <div class="tool-section">
        <div class="tool-section-header"><h3>网络搜索</h3><span class="hint">配置 Exa AI API key 启用语义搜索（效果更好）。留空则降级到 DuckDuckGo（免费但效果一般）。<a href="https://exa.ai" target="_blank">获取 API key</a></span></div>
        <t-input v-model="exaApiKey" type="password" placeholder="留空则使用 DuckDuckGo" />
        <div class="s-row"><t-button @click="saveExa">保存</t-button><span class="hint">{{ exaSaveHint }}</span></div>
      </div>

      <div class="tool-section">
        <div class="tool-section-header"><h3>内置工具</h3><span class="hint">无需配置，开箱即用。只能访问已添加数据源目录内的文件。</span></div>
        <t-list split>
          <t-list-item v-for="t in builtinTools" :key="t.name">
            <t-list-item-meta :title="`${t.icon} ${t.label}`" :description="t.hint" />
            <template #action><t-switch v-model="t.enabled" @change="(v)=>onBuiltinToggle(t.name,v)" /></template>
          </t-list-item>
          <t-list-item v-if="!builtinTools.length">
            <span class="hint">无法加载内置工具列表</span>
          </t-list-item>
        </t-list>
      </div>

      <div class="tool-section">
        <div class="tool-section-header"><h3>MCP 工具</h3><span class="hint">填表单加一个 MCP server，不用手写 JSON。启动命令和参数照抄该工具的安装说明填就行。</span></div>
        <t-list split>
          <t-list-item v-for="[name,cfg] in mcpEntries" :key="name">
            <t-list-item-meta :title="name" :description="`${cfg.command} ${(cfg.args||[]).join(' ')}`" />
            <template #action><t-button theme="default" variant="text" size="small" @click="removeMcpServer(name)">移除</t-button></template>
          </t-list-item>
          <t-list-item v-if="!mcpEntries.length">
            <span class="hint">还没有配置任何 MCP 工具。</span>
          </t-list-item>
        </t-list>
        <div class="mcp-add-form">
          <div class="form-grid">
            <t-input v-model="mcpNew.name" placeholder="例如 filesystem" />
            <t-input v-model="mcpNew.command" placeholder="例如 npx" />
          </div>
          <t-input v-model="mcpNew.args" placeholder="例如 -y @modelcontextprotocol/server-filesystem /Users/you/notes" />
          <div class="s-row">
            <t-button theme="primary" @click="addMcpServer">+ 添加这个 MCP 工具</t-button>
            <span class="hint">{{ mcpResult }}</span>
          </div>
        </div>
      </div>
    </t-card>
  </div>
</template>

<script>
// Options API：设置视图。6 项功能（配置模型/选择模型/模型下拉/检测think/向量库检索/MCP工具配置）
// 全部从 app.js 忠实迁移，逻辑不变只换 TDesign 组件。向量库检索开关在 Composer.vue（ragEnabled）。
import { store, updateToolAvailability, updateThinkingToggleVisibility } from "../store.js";

const BUILTIN_TOOL_LABELS = {
  read_file: { icon: "📄", label: "读取文件", hint: "读取指定文件的完整内容" },
  list_directory: { icon: "📁", label: "浏览目录", hint: "列出目录下的文件和子目录" },
  search_files: { icon: "🔍", label: "搜索文件", hint: "按关键词在文件中全文搜索" },
  web_search: { icon: "🌐", label: "网络搜索", hint: "在互联网上搜索信息，用于调研任务" },
  fetch_url: { icon: "🔗", label: "抓取网页", hint: "获取指定 URL 的网页内容" },
  download_file: { icon: "⬇️", label: "下载文件", hint: "下载文件到本地沙箱目录（只存不执行）" },
};

const kb = () => window.kb;

export default {
  data() {
    return {
      // token 用量
      usage: { today: {prompt:0,completion:0}, thisWeek:{prompt:0,completion:0}, thisMonth:{prompt:0,completion:0}, series: [] },
      granularity: "minute",
      // llm
      llm: { baseUrl:"", apiKey:"", model:"", customHeaders:{}, temperature:0.7, topP:1, topK:"", maxTokens:"" },
      customHeaders: [],
      modelMode: "input", // input | select
      modelOptions: [],
      modelListHint: "",
      thinkingProbeResult: "",
      llmSaveHint: "",
      // system prompt
      systemPrompt: "",
      systemPromptSaveHint: "",
      // tools
      toolsEnabled: true,
      exaApiKey: "",
      exaSaveHint: "",
      builtinTools: [],
      mcpServersDraft: {},
      mcpNew: { name:"", command:"", args:"" },
      mcpResult: "",
      // chart
      lastUsageSeries: null,
      _usageRaf: null,
      _resizeObs: null,
    };
  },
  computed: {
    store() { return store; },
    mcpEntries() { return Object.entries(this.mcpServersDraft); },
    usageDisplay() {
      // 统一用 K/M/B 国际单位，不用"万"。>=1B 显示 1.2B，>=1M 显示 1.2M，>=1K 显示 1.2K，否则原数
      const f = (n) => {
        if (n >= 1e9) return (n / 1e9).toFixed(n >= 1e10 ? 0 : 1) + "B";
        if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M";
        if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + "K";
        return String(n);
      };
      return {
        today: `输入 ${f(this.usage.today.prompt)} · 输出 ${f(this.usage.today.completion)}`,
        week: `输入 ${f(this.usage.thisWeek.prompt)} · 输出 ${f(this.usage.thisWeek.completion)}`,
        month: `输入 ${f(this.usage.thisMonth.prompt)} · 输出 ${f(this.usage.thisMonth.completion)}`,
      };
    },
  },
  async activated() { await this.refreshSettingsView(); },
  async mounted() { await this.refreshSettingsView(); this.setupChartResize(); },
  beforeUnmount() { if (this._resizeObs) this._resizeObs.disconnect(); },
  methods: {
    async refreshSettingsView() {
      const settings = await kb().settings.get();
      this.llm.baseUrl = settings.llm.baseUrl || "";
      this.llm.apiKey = settings.llm.apiKey || "";
      this.llm.model = settings.llm.model || "";
      this.llm.temperature = settings.llm.temperature ?? 0.7;
      this.llm.topP = settings.llm.topP ?? 1;
      this.llm.topK = settings.llm.topK || "";
      this.llm.maxTokens = settings.llm.maxTokens || "";
      this.systemPrompt = settings.systemPrompt || "";
      // customHeaders → 可编辑行数组
      const entries = Object.entries(settings.llm.customHeaders || {});
      this.customHeaders = entries.length ? entries.map(([k,v])=>({key:k,value:v})) : [{key:"",value:""}];
      this.mcpServersDraft = { ...(settings.mcpServers || {}) };
      await this.renderBuiltinToolList();
      this.toolsEnabled = settings.toolsEnabled !== false;
      this.exaApiKey = settings.exaApiKey || "";
      await updateToolAvailability(await kb().mcp.hasTools());
      if (this.llm.baseUrl && this.llm.apiKey) this.refreshModelList();
      this.refreshTokenUsage();
    },
    collectCustomHeaders() {
      const h = {};
      this.customHeaders.forEach(r => { const k = (r.key||"").trim(); if (k) h[k] = (r.value||"").trim(); });
      return h;
    },
    collectLlmConfig() {
      return {
        baseUrl: (this.llm.baseUrl||"").trim(),
        apiKey: (this.llm.apiKey||"").trim(),
        model: (this.llm.model||"").trim(),
        customHeaders: this.collectCustomHeaders(),
        temperature: parseFloat(this.llm.temperature) || 0.7,
        topP: parseFloat(this.llm.topP) || 1,
        topK: (this.llm.topK+"").trim(),
        maxTokens: (this.llm.maxTokens+"").trim(),
      };
    },
    async refreshModelList() {
      const baseUrl = (this.llm.baseUrl||"").trim();
      const apiKey = (this.llm.apiKey||"").trim();
      if (!baseUrl || !apiKey) return;
      this.modelListHint = "拉取模型列表中…";
      const result = await kb().llm.listModels({ baseUrl, apiKey, customHeaders: this.collectCustomHeaders() });
      if (result.success && result.models.length) {
        const current = (this.llm.model||"").trim();
        this.modelOptions = result.models.map(id => ({ label:id, value:id }));
        if (current && !result.models.includes(current)) {
          this.modelOptions.push({ label:`${current}（当前配置，不在拉取到的列表里）`, value:current });
        }
        if (current) this.llm.model = current;
        else this.llm.model = result.models[0];
        this.modelMode = "select";
        this.modelListHint = `已拉取 ${result.models.length} 个可选模型`;
      } else {
        this.modelMode = "input";
        this.modelListHint = "没拉到模型列表（该接口可能不支持），手动填模型名称就行";
      }
    },
    async probeThinking() {
      this.thinkingProbeResult = "检测中…";
      const result = await kb().llm.probeThinking(this.collectLlmConfig());
      this.thinkingProbeResult = result.supported ? "支持思考模式 ✓" : `不支持（${result.reason || "未探测到 reasoning 字段"}）`;
      updateThinkingToggleVisibility(result.supported);
      await kb().settings.update({ llm: { thinkingSupported: result.supported } });
    },
    async saveLlm() {
      const llm = this.collectLlmConfig();
      await kb().settings.update({ llm });
      this.llmSaveHint = "已保存，正在自动检测是否支持思考模式…";
      await this.probeThinking();
      this.llmSaveHint = "已保存";
      setTimeout(()=>this.llmSaveHint="", 2000);
    },
    async saveSystemPrompt() {
      await kb().settings.update({ systemPrompt: this.systemPrompt });
      this.systemPromptSaveHint = "已保存";
      setTimeout(()=>this.systemPromptSaveHint="", 2000);
    },
    async onToolsMasterToggle(v) {
      store.toolsEnabled = v;
      await kb().settings.update({ toolsEnabled: v });
    },
    async saveExa() {
      const key = (this.exaApiKey||"").trim();
      await kb().settings.update({ exaApiKey: key });
      this.exaSaveHint = key ? "已保存，搜索将使用 Exa AI" : "已保存，搜索将使用 DuckDuckGo";
      setTimeout(()=>this.exaSaveHint="", 3000);
    },
    async renderBuiltinToolList() {
      try {
        const tools = await kb().builtinTools.list();
        this.builtinTools = tools.map(t => {
          const meta = BUILTIN_TOOL_LABELS[t.name] || { icon:"🔧", label:t.name, hint:"" };
          return { name:t.name, icon:meta.icon, label:meta.label, hint:meta.hint, enabled: !!t.enabled };
        });
      } catch {
        this.builtinTools = [];
      }
    },
    async onBuiltinToggle(name, v) {
      await kb().builtinTools.toggle(name, v);
      await updateToolAvailability(await kb().mcp.hasTools());
    },
    async addMcpServer() {
      const name = (this.mcpNew.name||"").trim();
      const command = (this.mcpNew.command||"").trim();
      const args = (this.mcpNew.args||"").trim().split(/\s+/).filter(Boolean);
      if (!name || !command) { this.mcpResult = "服务名称和启动命令不能为空"; return; }
      this.mcpServersDraft[name] = { command, args };
      this.mcpNew = { name:"", command:"", args:"" };
      this.mcpResult = "连接中…";
      await kb().settings.update({ mcpServers: this.mcpServersDraft });
      const results = await kb().mcp.reconnect();
      const r = results.find(r => r.name === name);
      this.mcpResult = r?.ok ? `已连接，发现 ${r.toolCount} 个工具` : `连接失败：${r?.error || "未知错误"}`;
      await updateToolAvailability(await kb().mcp.hasTools());
    },
    async removeMcpServer(name) {
      delete this.mcpServersDraft[name];
      await kb().settings.update({ mcpServers: this.mcpServersDraft });
      await kb().mcp.reconnect();
      await updateToolAvailability(await kb().mcp.hasTools());
    },
    async switchGranularity(g) {
      this.granularity = g;
      await this.refreshTokenUsage();
    },
    async refreshTokenUsage() {
      const usage = await kb().stats.tokenUsage({ granularity: this.granularity });
      this.usage = usage;
      this.$nextTick(() => this.drawUsageChart(usage.series));
    },
    setupChartResize() {
      this._resizeObs = new ResizeObserver(() => {
        if (this._usageRaf) return;
        this._usageRaf = requestAnimationFrame(() => { this._usageRaf = null; this.drawUsageChart(); });
      });
      if (this.$refs.usageChartEl) this._resizeObs.observe(this.$refs.usageChartEl);
    },
    formatBucketLabel(bucket) {
      const [datePart, timePart] = bucket.split(" ");
      const [, m, d] = datePart.split("-");
      if (!timePart) return `${m}/${d}`;
      return this.granularity === "hour" ? `${m}/${d} ${timePart.slice(0,2)}时` : `${timePart}`;
    },
    formatTokenCount(v) {
      // Y 轴刻度统一 K/M/B（与 usageDisplay 一致），不用"万"
      if (v >= 1e9) return (v / 1e9).toFixed(v >= 1e10 ? 0 : 1) + "B";
      if (v >= 1e6) return (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + "M";
      if (v >= 1e3) return (v / 1e3).toFixed(v >= 1e4 ? 0 : 1) + "K";
      return String(Math.round(v));
    },
    drawUsageChart(series) {
      if (series) this.lastUsageSeries = series;
      else series = this.lastUsageSeries;
      if (!series) return;
      const svg = this.$refs.usageChartEl;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const W = Math.max(1, Math.round(rect.width)) || 700;
      const H = Math.max(1, Math.round(rect.height)) || 180;
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
      const padTop=12, padBottom=28, padLeft=34, padRight=28;
      const maxVal = Math.max(1, ...series.flatMap(d=>[d.prompt,d.completion]));
      const plotW = W - padLeft - padRight;
      const stepX = plotW / Math.max(1, series.length - 1);
      const toY = (v) => padTop + (1 - v/maxVal) * (H - padTop - padBottom);
      const toX = (i) => padLeft + i * stepX;
      const buildPath = (key) => series.map((d,i)=>`${toX(i)},${toY(d[key])}`).join(" ");
      const yTicks = [0,0.5,1].map(frac => {
        const val = maxVal*frac; const y = toY(val);
        return `<line x1="${padLeft}" y1="${y}" x2="${W-padRight}" y2="${y}" stroke="var(--td-border-level-2)" stroke-width="1" stroke-dasharray="${frac===0?"0":"3,3"}" /><text x="${padLeft-8}" y="${y+3}" font-size="10" fill="var(--td-text-color-secondary)" text-anchor="end">${this.formatTokenCount(val)}</text>`;
      }).join("");
      const labelCount = Math.min(6, series.length);
      const labelStep = Math.max(1, Math.floor(series.length / labelCount));
      const dayLabels = series.map((d,i) => {
        const isLast = i === series.length - 1;
        if (i % labelStep !== 0 && !isLast) return "";
        const anchor = i===0?"start":isLast?"end":"middle";
        return `<text x="${toX(i)}" y="${H-8}" font-size="10" fill="var(--td-text-color-secondary)" text-anchor="${anchor}">${this.formatBucketLabel(d.day)}</text>`;
      }).join("");
      const dotsFor = (key,color) => series.map((d,i)=>`<circle cx="${toX(i)}" cy="${toY(d[key])}" r="2.5" fill="${color}" />`).join("");
      svg.innerHTML = `${yTicks}<polyline points="${buildPath("prompt")}" fill="none" stroke="var(--td-brand-color)" stroke-width="2" /><polyline points="${buildPath("completion")}" fill="none" stroke="#8fd6ff" stroke-width="2" />${dotsFor("prompt","var(--td-brand-color)")}${dotsFor("completion","#8fd6ff")}${dayLabels}`;
    },
  },
};
</script>

<style scoped>
.settings-view { display: flex; flex-direction: column; gap: 16px; }
.panel { background: var(--td-bg-color-container); }
.usage-summary { display: flex; gap: 16px; margin-bottom: 12px; }
.usage-stat { flex: 1; }
.usage-label { color: var(--td-text-color-secondary); font-size: 12px; margin-bottom: 4px; }
.usage-value { font-size: 14px; }
.usage-chart { width: 100%; height: 180px; display: block; }
.usage-legend { display: flex; align-items: center; gap: 16px; margin-top: 8px; font-size: 12px; }
.usage-legend .legend-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; vertical-align: middle; }
.usage-legend .legend-dot.prompt { background: var(--td-brand-color); }
.usage-legend .legend-dot.completion { background: #8fd6ff; }
.usage-granularity { margin-left: auto; display: flex; gap: 4px; }
/* LLM 配置表单：双列布局。Base URL 与 API Key 并排，模型名称 span-2 占满两列。
   保留信息密度，对齐成熟产品设置页的双列表单 */
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 20px; }
.form-grid .span-2 { grid-column: span 2; }
/* t-form-item label-align=top 时 label 在输入框上方，加底部间距 */
.panel :deep(.t-form__item) { margin-bottom: 16px; }
.panel :deep(.t-form__label) { font-size: 13px; color: var(--td-text-color-secondary); padding-bottom: 6px; }
.panel :deep(.t-input-number) { width: 100%; }
.header-rows-block { margin: 12px 0; }
.header-rows-title { font-size: 13px; color: var(--td-text-color-secondary); margin-bottom: 8px; }
.header-rows { display: flex; flex-direction: column; gap: 8px; margin-bottom: 8px; }
.header-row { display: flex; gap: 8px; align-items: center; }
.header-row :deep(.t-input) { flex: 1; }
.advanced { margin: 12px 0; }
.advanced :deep(.t-collapse-panel__content) { padding-top: 12px; }
.s-row { display: flex; align-items: center; gap: 12px; margin-top: 12px; }
.hint { color: var(--td-text-color-secondary); font-size: 12px; }
.tool-master-toggle { display: flex; align-items: center; gap: 8px; }
.tool-section { padding: 12px 0; border-top: 1px solid var(--td-component-stroke); }
.tool-section:first-of-type { border-top: none; }
.tool-section-header { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
.tool-section-header h3 { margin: 0; font-size: 14px; }
.mcp-add-form { display: flex; flex-direction: column; gap: 10px; margin-top: 12px; }
</style>

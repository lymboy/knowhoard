<template>
  <details class="tool-calls" :open="open">
    <summary>调用了 {{ toolCalls.length }} 个工具</summary>
    <div class="tool-calls-body">
      <div v-for="(tc, i) in toolCalls" :key="i" class="tool-call-entry">
        <div class="tool-call-name">🔧 {{ displayName(tc.name) }}</div>
        <div :class="tc.ok === false ? 'tool-call-result tool-call-error' : 'tool-call-result'" :title="open ? '' : tc.result">
          {{ formatResult(tc.result, open) }}
        </div>
      </div>
    </div>
  </details>
</template>

<script>
// Options API：methods Vue 直接挂实例。
export default {
  props: {
    toolCalls: { type: Array, default: () => [] },
    open: { type: Boolean, default: false },
  },
  methods: {
    displayName(name) {
      if (!name) return "";
      return name.includes("__") ? name.split("__").slice(1).join("__") : name;
    },
    // 折叠时只展示 1-2 行（截断到 ~100 字符 + …），避免长 result 撑乱气泡；展开时完整显示
    formatResult(result, isOpen) {
      if (isOpen) return result || "完成";
      if (!result) return "完成";
      const text = String(result).replace(/\n/g, " ").trim();
      if (text.length <= 100) return text;
      return text.slice(0, 100) + "…";
    },
  },
};
</script>

<style scoped>
.tool-call-error {
  color: var(--accent);
}
/* 折叠时 result 单行省略（配合 formatResult 截断），展开时正常多行 */
.tool-calls:not([open]) .tool-call-result {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tool-call-result {
  word-break: break-all;
}
</style>

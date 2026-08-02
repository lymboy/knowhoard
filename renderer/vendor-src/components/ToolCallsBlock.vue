<template>
  <details class="tool-calls" :open="open">
    <summary>调用了 {{ toolCalls.length }} 个工具</summary>
    <div class="tool-calls-body">
      <div v-for="(tc, i) in toolCalls" :key="i" class="tool-call-entry">
        <div class="tool-call-name">🔧 {{ displayName(tc.name) }}</div>
        <div :class="tc.ok === false ? 'tool-call-result tool-call-error' : 'tool-call-result'">
          {{ tc.result || (tc.status === '执行中…' ? '执行中…' : '完成') }}
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
  },
};
</script>

<style scoped>
.tool-call-error {
  color: var(--accent);
}
</style>

<template>
  <div class="ai-status">
    <span :class="['status-dot', dotClass]"></span>
    <span>{{ text }}</span>
  </div>
</template>

<script>
// Options API：computed Vue 直接挂实例，render 的 _ctx 可访问，响应式正常。
// 之前 app.js 直接 bar.textContent 覆盖整个容器，把里面的 status-dot span 一起清没了，
// 样式改的类名从来没生效过。Vue 这里 DOM 从状态派生，dotClass 绑到 :class，不会互相覆盖。
export default {
  computed: {
    store() {
      return window.__STORE;
    },
    text() {
      return this.store.aiStatus.text;
    },
    dotClass() {
      return this.store.aiStatus.dotClass;
    },
  },
};
</script>

<style scoped>
.ai-status {
  width: 100%;
}
</style>

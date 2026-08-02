<template>
  <div class="ai-status">
    <span :class="['status-dot', dotClass]"></span>
    <span>{{ text }}</span>
  </div>
</template>

<script setup>
import { computed } from "../vue.runtime.js";
import { store } from "../../store.js";

// 之前 app.js 直接 bar.textContent 覆盖整个容器，把里面的 status-dot span 一起清没了，
// 样式改的类名从来没生效过。Vue 这里 DOM 从状态派生，dotClass 绑到 :class，不会互相覆盖。
const text = computed(() => store.aiStatus.text);
const dotClass = computed(() => store.aiStatus.dotClass);
</script>

<style scoped>
.ai-status {
  width: 100%;
}
</style>

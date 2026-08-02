<template>
  <div class="citations">
    <button
      v-for="(c, i) in citations"
      :key="i"
      type="button"
      class="citation-chip"
      :title="isUrl(c.path) ? ('点击在浏览器中打开：' + c.path) : ('点击在 Finder 中查看：' + c.path)"
      @click="openCitation(c)"
    >[来源{{ c.num || (i + 1) }}] {{ c.filename }}</button>
  </div>
</template>

<script>
// Options API：methods Vue 直接挂实例。
export default {
  props: {
    citations: { type: Array, default: () => [] },
  },
  methods: {
    isUrl(p) {
      return /^https?:\/\//.test(p || "");
    },
    openCitation(c) {
      if (this.isUrl(c.path)) window.kb.shell.openExternal(c.path);
      else window.kb.documents.openInFinder(c.path);
    },
  },
};
</script>

<style scoped>
.citations {
  display: flex;
  flex-wrap: wrap;
}
</style>

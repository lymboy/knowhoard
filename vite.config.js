import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "path";

// Vite 正规构建渲染层。之前免构建（手拼 SFC + esbuild bundle TDesign）在组件实例上下文上
// 踩坑（TDesign 用 getCurrentInstance 在预编译环境返回 null）。vite 用标准 ESM + plugin-vue
// 编译 .vue，TDesign 原生 import，实例链正常。产物正经 ESM bundle，CSP script-src 'self' 兼容。
//
// root=renderer，入口 index.html，产物到 renderer/dist。Electron 加载 dist/index.html。
export default defineConfig({
  root: path.join(__dirname, "renderer"),
  base: "./", // Electron file:// 加载，相对路径
  plugins: [vue()],
  resolve: {
    alias: {
      // 让组件 import store.js / markdown.js 用相对路径正常解析（vite 默认能解析，alias 备用）
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2020",
    // TDesign 较大，提高 chunk 警告阈值
    chunkSizeWarningLimit: 8000,
    rollupOptions: {
      input: path.join(__dirname, "renderer", "index.html"),
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});

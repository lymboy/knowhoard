import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "path";

// Vite 正规构建渲染层。root=renderer，入口 index.html，产物到 renderer/dist。
// Electron 加载 dist/index.html。CSP script-src 'self' 兼容（产物正经 ESM bundle，无 eval）。
export default defineConfig({
  root: path.join(__dirname, "renderer"),
  base: "./", // Electron file:// 用相对路径
  plugins: [vue()],
  resolve: {
    alias: {},
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2020",
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

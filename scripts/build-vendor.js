// highlight.js v11 不再随包提供可直接 <script> 引入的浏览器全局构建，
// 用 esbuild 打一个小 bundle，暴露 window.hljs——这是整个渲染进程里唯一需要的构建步骤，
// marked / dompurify / mermaid 都自带 UMD 构建，直接引用即可。
const esbuild = require("esbuild");
const path = require("path");

esbuild
  .build({
    entryPoints: [path.join(__dirname, "..", "renderer", "vendor-src", "hljs-entry.js")],
    bundle: true,
    minify: true,
    format: "iife",
    platform: "browser",
    outfile: path.join(__dirname, "..", "renderer", "vendor", "hljs.bundle.js"),
  })
  .then(() => console.log("[build-vendor] hljs.bundle.js 生成完成"))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

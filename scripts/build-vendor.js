// highlight.js v11 不再随包提供可直接 <script> 引入的浏览器全局构建，
// 用 esbuild 打一个小 bundle，暴露 window.hljs。
// 另外 Vue SFC 组件也需要预编译（走 build-vue.js，CSP 'self' 下不能用运行时模板编译）。
// marked / dompurify / mermaid 都自带 UMD 构建，直接引用即可。
const esbuild = require("esbuild");
const path = require("path");
const { spawn } = require("child_process");

esbuild
  .build({
    entryPoints: [path.join(__dirname, "..", "renderer", "vendor-src", "hljs-entry.js")],
    bundle: true,
    minify: true,
    format: "iife",
    platform: "browser",
    outfile: path.join(__dirname, "..", "renderer", "vendor", "hljs.bundle.js"),
  })
  .then(() => {
    console.log("[build-vendor] hljs.bundle.js 生成完成");
    // 编译 .vue 组件（独立脚本，避免 esbuild 这边报错被吞）
    const r = spawn(process.execPath, [path.join(__dirname, "build-vue.js")], {
      stdio: "inherit",
    });
    r.on("exit", (code) => {
      if (code !== 0) process.exit(code);
    });
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

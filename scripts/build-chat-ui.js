// 把 @tdesign-vue-next/chat + tdesign-vue-next 主包预编译成免构建可直接 import 的 ESM bundle。
// 不在乎体积（客户端解压都1G+，bundle 6MB 无所谓）。
//
// 关键点：
// 1. TDesign 全用 .mjs，esbuild 默认 resolveExtensions 不含 .mjs，必须显式加（否则目录 index 解析失败）
// 2. ChatMarkdown 底层是 tdesign-web-components（web component），引入图标字体 .eot/.woff 等，
//    esbuild 没 loader，用 dataurl 内联为 base64（运行时自包含，不依赖外部字体文件）
// 3. chat 包依赖主包 tdesign-vue-next，一起 bundle
// 4. vue alias 到本地 vue.runtime.js，避免双 vue 实例导致 reactive 跨组件失效
const esbuild = require("esbuild");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const VUE = path.join(ROOT, "node_modules/vue/dist/vue.runtime.esm-browser.prod.js");
const TD_CHAT = path.join(ROOT, "node_modules/@tdesign-vue-next/chat/es/index.mjs");
const OUT = path.join(ROOT, "renderer/vendor/tdesign-chat.bundle.js");

esbuild.build({
  entryPoints: [TD_CHAT],
  bundle: true,
  minify: false,
  format: "esm",
  platform: "browser",
  outfile: OUT,
  alias: { vue: VUE },
  resolveExtensions: [".mjs", ".js", ".ts", ".tsx", ".css", ".json"],
  loader: {
    ".eot": "dataurl", ".woff": "dataurl", ".woff2": "dataurl", ".ttf": "dataurl", ".svg": "dataurl",
  },
  logLevel: "info",
}).then(() => console.log("[build-chat-ui] tdesign-chat bundle 生成完成")).catch(e => { console.error(e); process.exit(1); });

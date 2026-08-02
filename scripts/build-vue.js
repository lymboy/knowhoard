// 把 renderer/vendor-src/components/*.vue 预编译成 ESM JS render 函数，产物放 renderer/vendor/components/。
// 运行时一份共享：vue.runtime.esm-browser.prod.js 拷成 renderer/vendor/vue.runtime.js，组件 import 它的相对路径。
//
// 为什么这么搞：
// - Vue 运行时编译模板靠 new Function，要 CSP 放开 'unsafe-eval'。本应用 CSP 是 script-src 'self'，
//   走预编译——.vue 在构建期编译成 render 函数，运行时只需纯 runtime（无编译器、无 new Function）。
// - 不能每个组件都 bundle 一份 runtime：那样 N 个组件 = N 份 runtime，且各是独立模块实例，
//   reactive/provide 跨组件会失效（多个 Vue 实例）。所以 runtime 单独拷一份，组件靠 ESM 相对 import 共享。
// - 浏览器原生 ESM（<script type="module">）解析相对 import，CSP 'self' 允许，无需改 CSP。
const fs = require("fs");
const path = require("path");
const sfc = require("@vue/compiler-sfc");

const ROOT = path.join(__dirname, "..");
const SRC_DIR = path.join(ROOT, "renderer", "vendor-src", "components");
const OUT_DIR = path.join(ROOT, "renderer", "vendor", "components");
const VUE_RUNTIME_SRC = path.join(ROOT, "node_modules", "vue", "dist", "vue.runtime.esm-browser.prod.js");
const VUE_RUNTIME_DST = path.join(ROOT, "renderer", "vendor", "vue.runtime.js");
// 组件产物在 vendor/components/*.js，runtime 在 vendor/vue.runtime.js，相对路径是 ../vue.runtime.js
const RUNTIME_IMPORT_PATH = "../vue.runtime.js";

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function compileVueFile(file) {
  const filename = path.basename(file);
  const source = fs.readFileSync(file, "utf-8");
  const { descriptor, errors } = sfc.parse(source, { filename });
  if (errors && errors.length) {
    throw new Error(`[build-vue] 解析 ${filename} 失败:\n${errors.map((e) => e.message).join("\n")}`);
  }
  const baseName = path.basename(filename, ".vue");
  const idHash = Buffer.from(baseName).toString("hex").slice(0, 8);
  // 编译 <script setup>：处理 setup 语法糖，产出组件的 setup 逻辑（含 export default {...}）
  const script = sfc.compileScript(descriptor, { id: idHash });

  // compileScript 产物里的 import 都来自 "vue"，重写成相对 runtime 路径
  const setupCode = script.content.replace(
    /from\s*["']vue["']/g,
    `from "${RUNTIME_IMPORT_PATH}"`
  );

  // 单独编译 <template> 成 render 函数。compileScript 不会自动注入 render
  // （那是 vite/vue-loader 的活），这里手动编好，再把 render 挂到 export default 上。
  let renderCode = "";
  if (descriptor.template) {
    const tpl = sfc.compileTemplate({
      source: descriptor.template.content,
      filename,
      id: idHash,
      compilerOptions: { scopeId: `data-v-${idHash}` },
    });
    if (tpl.errors && tpl.errors.length) {
      throw new Error(`[build-vue] 编译 ${filename} 模板失败:\n${tpl.errors.join("\n")}`);
    }
    // tpl.code: import {...} from "vue"\n\nexport function render(_ctx, _cache) {...}
    renderCode = tpl.code
      .replace(/from\s*["']vue["']/g, `from "${RUNTIME_IMPORT_PATH}"`)
      // 去掉 export，改 const，方便后面挂到组件对象上
      .replace(/export function render/, "function render");
  }

  // 拼装顺序：render 函数定义（带它的 vue import） → setup 代码（带 export default）
  // 然后把 render 注入 export default：把 `export default {` 替换成 `export default { render,`
  let code = "";
  if (renderCode) {
    code += renderCode + "\n";
    // 把 render 挂到组件对象上。setup 产物里的 export default { ... } 改成 export default { render, ... }
    code += setupCode.replace(/export\s+default\s*\{/, "export default { render,");
  } else {
    code += setupCode;
  }



  // <style>：抽出来单独写 .css。scoped 的 data-v-xxx 选择器由 compiler-sfc 在 style.content 里已加好
  const cssParts = [];
  (descriptor.styles || []).forEach((s, i) => {
    cssParts.push(`/* ${baseName}.vue style ${i}${s.scoped ? " (scoped)" : ""} */\n${s.content}`);
  });

  return { code, css: cssParts.join("\n\n"), baseName };
}

function buildOne(file) {
  const { code, css, baseName } = compileVueFile(file);
  fs.writeFileSync(path.join(OUT_DIR, `${baseName}.js`), code, "utf-8");
  // css 不再单独写文件，由 main() 合并成单个 components.css 供 index.html 一次性引入
  console.log(`[build-vue] ${baseName}.js 生成完成${css ? " + css" : ""}`);
  return css ? { baseName, css } : null;
}

function copyRuntime() {
  fs.copyFileSync(VUE_RUNTIME_SRC, VUE_RUNTIME_DST);
  console.log("[build-vue] vue.runtime.js 已复制");
}

function main() {
  ensureDir(OUT_DIR);
  copyRuntime();
  const vueFiles = fs
    .readdirSync(SRC_DIR)
    .filter((f) => f.endsWith(".vue"))
    .map((f) => path.join(SRC_DIR, f));
  if (!vueFiles.length) {
    console.log("[build-vue] 没有 .vue 组件需要编译");
    return;
  }
  try {
    // 收集每个组件的 css，合并成单个 components.css 供 index.html 一次性 <link> 引入
    // （之前每个组件单独写 .css 但没人引，scoped 样式不生效，导致按钮窄、布局塌）
    const cssList = [];
    vueFiles.forEach((f) => {
      const r = buildOne(f);
      if (r) cssList.push(`/* ${r.baseName}.vue */\n${r.css}`);
    });
    const combinedCssPath = path.join(ROOT, "renderer", "vendor", "components.css");
    fs.writeFileSync(combinedCssPath, cssList.join("\n\n"), "utf-8");
    console.log("[build-vue] components.css 合并完成");
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();

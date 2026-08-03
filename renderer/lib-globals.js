// 第三方库统一 import + 挂 window 全局。
// 之前免构建时这些由 index.html 的 <script> 引入挂全局；vite 化后改成 npm import，
// 但 app.js（经典脚本，大量直接用 marked/DOMPurify/hljs/mermaid 全局名）和 markdown.js
// 还没全部改完，这里集中挂 window 保持兼容，迁移期间业务逻辑不用动。
// 后续 Phase 2/3 把 app.js 删掉、markdown.js 改成直接 import 后，这个文件可以移除。

import { marked } from "marked";
import DOMPurify from "dompurify";
import hljs from "highlight.js";
import mermaid from "mermaid";
import katex from "katex";
import renderMathInElement from "katex/contrib/auto-render";

window.marked = marked;
window.DOMPurify = DOMPurify;
window.hljs = hljs;
window.mermaid = mermaid;
window.katex = katex;
window.renderMathInElement = renderMathInElement;

// github-markdown-css 和 katex.css 也由这里 import，vite 打包进产物，
// 不再靠 index.html 的 <link> 引 node_modules 路径（vite 不认那种路径）
import "github-markdown-css/github-markdown.css";
import "katex/dist/katex.min.css";
// TDesign 设计系统样式（颜色/字号/圆角/间距/组件），含亮暗 token
import "tdesign-vue-next/es/style/index.css";
// hljs 语法高亮主题：统一用 github-dark（代码块始终深色底浅色字，亮暗气泡都可读，像 GitHub/ChatGPT）
import "highlight.js/styles/github-dark.css";

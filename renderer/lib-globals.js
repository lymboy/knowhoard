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

// 第三方样式由这里 import，vite 打包进产物。
// markdown 渲染用 marked（TDesign Chat 内部也用它），样式用 --td-* token 自写（见 styles.css），
// 不引 github-markdown-css（既然用 TDesign 设计语言，不混第三方 markdown 样式）。
import "katex/dist/katex.min.css";
// TDesign 设计系统样式（颜色/字号/圆角/间距/组件），含亮暗 token
import "tdesign-vue-next/es/style/index.css";
// hljs 语法高亮主题：github（亮色），代码块跟随主题浅底深字
import "highlight.js/styles/github.css";

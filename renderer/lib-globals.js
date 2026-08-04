// 第三方库的全局样式统一在此 import，vite 打包进产物。
// 库本身（marked/DOMPurify/hljs/mermaid/katex）由各模块直接 import 使用（见 markdown.js），
// 不再挂 window 全局——V2 迁移期的兼容桥接已随 app.js 删除和 MessageBubble 改用共享
// markdown.js 一并清理完毕。
// markdown 渲染用 marked（TDesign Chat 内部也用它），样式用 --td-* token 自写（见 styles.css），
// 不引 github-markdown-css（既然用 TDesign 设计语言，不混第三方 markdown 样式）。
import "katex/dist/katex.min.css";
// TDesign 设计系统样式（颜色/字号/圆角/间距/组件），含亮暗 token
import "tdesign-vue-next/es/style/index.css";
// hljs 语法高亮主题：github（亮色），代码块跟随主题浅底深字
import "highlight.js/styles/github.css";

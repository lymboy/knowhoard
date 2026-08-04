// Markdown 渲染共享模块：marked + DOMPurify + highlight.js + mermaid + katex。
// 所有 Vue 组件统一走这一份实现，避免多处各写一套渲染/高亮逻辑而漂移。

import { marked } from "marked";
import DOMPurify from "dompurify";
import hljs from "highlight.js";
import mermaid from "mermaid";
import renderMathInElement from "katex/contrib/auto-render";

// Mermaid 主题跟随当前页面主题（亮/暗），不能写死深色——
// 亮色主题下深色节点配浅色文字完全看不清
function initMermaid() {
  const isDarkTheme = document.documentElement.dataset.theme === "dark";
  mermaid.initialize({
    startOnLoad: false,
    theme: "base",
    securityLevel: "strict",
    flowchart: { useMaxWidth: false, htmlLabels: true, curve: "basis" },
    sequence: { useMaxWidth: false },
    gantt: { useMaxWidth: false },
    themeVariables: isDarkTheme
      ? {
          primaryColor: "#21262d",
          primaryTextColor: "#e6edf3",
          primaryBorderColor: "#8b949e",
          lineColor: "#8b949e",
          secondaryColor: "#161b22",
          tertiaryColor: "#0d1117",
          background: "transparent",
          mainBkg: "#21262d",
          nodeBorder: "#8b949e",
          clusterBkg: "transparent",
          clusterBorder: "#30363d",
          titleColor: "#e6edf3",
          edgeLabelBackground: "#161b22",
          textColor: "#e6edf3",
          fontSize: "14px",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif",
        }
      : {
          primaryColor: "#f6f8fa",
          primaryTextColor: "#1f2328",
          primaryBorderColor: "#57606a",
          lineColor: "#57606a",
          secondaryColor: "#ffffff",
          tertiaryColor: "#f6f8fa",
          background: "transparent",
          mainBkg: "#f6f8fa",
          nodeBorder: "#57606a",
          clusterBkg: "transparent",
          clusterBorder: "#d1d9e0",
          titleColor: "#1f2328",
          edgeLabelBackground: "#ffffff",
          textColor: "#1f2328",
          fontSize: "14px",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif",
        },
  });
}

function initMarked() {
  marked.setOptions({ breaks: true, gfm: true });
  const renderer = new marked.Renderer();
  const originalCode = renderer.code.bind(renderer);
  renderer.code = (token) => {
    // marked v15 的自定义 renderer 传的是一个 token 对象（{ text, lang, escaped }），
    // 不是旧版本那种 (code, infostring) 两个参数——之前一直按旧签名写，lang 永远取不到，
    // mermaid 代码块自然永远走不进下面这个分支
    const lang = (token.lang || "").trim().toLowerCase();
    if (lang === "mermaid") {
      // 先占位，真正的图交给 mermaid.run() 在插入 DOM 之后异步渲染
      const id = `mmd-${Math.random().toString(36).slice(2)}`;
      return `<div class="mermaid-block"><pre class="mermaid" id="${id}">${escapeHtml(token.text)}</pre></div>`;
    }
    return originalCode(token);
  };
  marked.use({ renderer });
}

export function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function renderMarkdown(text) {
  const html = marked.parse(text || "");
  return DOMPurify.sanitize(html, { ADD_TAGS: ["pre"] });
}

function wrapCodeBlockWithChrome(codeEl) {
  const pre = codeEl.parentElement;
  if (!pre || pre.parentElement?.classList.contains("code-block")) return; // 已经包过了
  const langMatch = (codeEl.className || "").match(/language-(\S+)/);
  const lang = langMatch ? langMatch[1] : "text";

  const wrapper = document.createElement("div");
  wrapper.className = "code-block";
  const header = document.createElement("div");
  header.className = "code-block-header";
  header.innerHTML = `<span class="lang">${escapeHtml(lang)}</span><button class="copy-btn">复制</button>`;
  header.querySelector(".copy-btn").addEventListener("click", () => {
    navigator.clipboard.writeText(codeEl.textContent || "");
    const btn = header.querySelector(".copy-btn");
    btn.textContent = "已复制";
    setTimeout(() => (btn.textContent = "复制"), 1500);
  });

  pre.parentElement.insertBefore(wrapper, pre);
  wrapper.appendChild(header);
  wrapper.appendChild(pre);
}

// 在给定容器里做代码高亮 + mermaid 渲染 + 公式渲染。
// Vue 组件用 v-html 渲染完 markdown 后调这个，补上 marked 管不到的增强。
// 流式消息会多次触发这个函数（每次 markdown 增量重渲染都要重新增强），
// 用 :not(.hljs) 排除已高亮过的代码块，避免 hljs.highlightElement 对同一元素重复调用报警告。
export async function highlightAndRenderDiagrams(container) {
  container.querySelectorAll("pre code:not(.hljs)").forEach((block) => {
    if (block.closest(".mermaid")) return;
    hljs.highlightElement(block);
    wrapCodeBlockWithChrome(block);
  });
  const mermaidBlocks = container.querySelectorAll("pre.mermaid");
  if (mermaidBlocks.length) {
    try {
      await mermaid.run({ nodes: Array.from(mermaidBlocks) });
    } catch (err) {
      console.error("mermaid 渲染失败", err);
    }
  }
  try {
    renderMathInElement(container, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "\\[", right: "\\]", display: true },
        { left: "$", right: "$", display: false },
        { left: "\\(", right: "\\)", display: false },
      ],
      throwOnError: false,
    });
  } catch (err) {
    console.error("公式渲染失败", err);
  }
}

// 一次性初始化 mermaid + marked。app.js 启动时和 Vue 入口都调，内部幂等（重复调只是重置配置，无副作用）。
export function initMarkdown() {
  initMermaid();
  initMarked();
}

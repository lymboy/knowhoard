/**
 * 网络工具：web_search / fetch_url / download_file。
 *
 * - web_search: Exa AI 语义搜索，专为 AI Agent 设计，理解自然语言查询
 * - fetch_url:  抓取网页/文档内容，支持 HTML、PDF、Word、Excel、CSV
 * - download_file: 下载文件到沙箱目录，只存不执行
 *
 * 安全约束：
 * - 下载的文件存在 {userDataPath}/sandbox/downloads/，与应用数据隔离
 * - 危险文件类型（.sh/.bat/.exe/.app 等）标记为危险
 * - 文件大小上限 50MB
 */

const path = require("path");
const fs = require("fs");

let sandboxDir = null;

function initSandbox(userDataPath) {
  sandboxDir = path.join(userDataPath, "sandbox", "downloads");
  fs.mkdirSync(sandboxDir, { recursive: true });
}

// ---------- 安全工具 ----------

const DANGEROUS_EXTENSIONS = new Set([
  ".sh", ".bash", ".zsh", ".csh",
  ".bat", ".cmd", ".com", ".ps1",
  ".exe", ".msi", ".dll", ".scr",
  ".app", ".dmg", ".pkg", ".deb", ".rpm",
  ".js", ".mjs", ".cjs",
  ".py", ".rb", ".pl", ".lua",
  ".vbs", ".vbe", ".wsf", ".wsh",
  ".pif", ".gadget", ".inf", ".reg", ".rgs",
]);

const MAX_DOWNLOAD_SIZE = 50 * 1024 * 1024; // 50MB

function sanitizeFilename(name) {
  return name.replace(/[/\\:*?"<>|\x00-\x1f]/g, "_").slice(0, 200);
}

function isDangerousFile(filename) {
  return DANGEROUS_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

// ---------- HTML → 可读文本 ----------

function htmlToText(html) {
  let text = html;
  text = text.replace(/<(script|style|head|noscript)[^>]*>[\s\S]*?<\/\1>/gi, "");
  text = text.replace(/<\/?(br|hr|p|div|h[1-6]|li|tr|blockquote|td|th)[^>]*>/gi, "\n");
  text = text.replace(/<[^>]+>/g, "");
  text = text
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#\d+;/g, "");
  text = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return text;
}

// ---------- Exa AI 搜索 ----------

async function searchExa(query, apiKey, maxResults = 8) {
  const resp = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      query,
      numResults: Math.min(maxResults || 8, 15),
      type: "auto",
      contents: {
        // 直接返回每个结果的正文摘要，省得再发一轮 fetch_url
        text: { maxCharacters: 1500 },
      },
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!resp.ok) {
    const err = await resp.text().catch(() => "");
    throw new Error(`Exa API 请求失败 (${resp.status}): ${err || resp.statusText}`);
  }

  const data = await resp.json();
  return (data.results || []).map((r) => ({
    title: r.title || "",
    url: r.url || "",
    snippet: r.text?.slice(0, 300) || r.highlight || "",
    publishedDate: r.publishedDate || "",
  }));
}

// DuckDuckGo 备用（用户没配 Exa API key 时降级使用）
async function searchDuckDuckGo(query, maxResults = 8) {
  const url = "https://lite.duckduckgo.com/lite";
  const body = new URLSearchParams({ q: query, kl: "cn-zh" });
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    },
    body: body.toString(),
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`DuckDuckGo 请求失败: ${resp.status}`);
  const html = await resp.text();
  const results = [];
  const linkRe = /<a[^>]+rel="nofollow"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRe = /<td[^>]*class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/gi;
  const links = [];
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    const href = m[1];
    const title = m[2].replace(/<[^>]+>/g, "").trim();
    if (title && href && !href.includes("duckduckgo.com")) links.push({ url: href, title, snippet: "" });
  }
  const snippets = [];
  while ((m = snippetRe.exec(html)) !== null) snippets.push(m[1].replace(/<[^>]+>/g, "").trim());
  for (let i = 0; i < Math.min(links.length, maxResults); i++) {
    links[i].snippet = snippets[i] || "";
    results.push(links[i]);
  }
  return results;
}

// ---------- 文档解析 ----------

async function parsePdf(buffer) {
  try {
    const pdfParse = require("pdf-parse");
    const data = await pdfParse(buffer);
    return { type: "pdf", text: data.text, pages: data.numpages };
  } catch (e) {
    throw new Error(`PDF 解析失败: ${e.message}`);
  }
}

async function parseDocx(buffer) {
  try {
    const mammoth = require("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return { type: "docx", text: result.value };
  } catch (e) {
    throw new Error(`Word 文档解析失败: ${e.message}`);
  }
}

async function parseXlsx(buffer) {
  try {
    const XLSX = require("xlsx");
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheets = {};
    for (const name of workbook.SheetNames) {
      const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name]);
      sheets[name] = csv;
    }
    const text = Object.entries(sheets)
      .map(([name, csv]) => `=== Sheet: ${name} ===\n${csv}`)
      .join("\n\n");
    return { type: "xlsx", text, sheetCount: workbook.SheetNames.length };
  } catch (e) {
    throw new Error(`Excel 解析失败: ${e.message}`);
  }
}

function parseCsv(buffer) {
  try {
    const text = buffer.toString("utf-8");
    // 简单 CSV 转表格格式，方便 LLM 阅读
    const lines = text.split("\n").filter((l) => l.trim());
    if (lines.length === 0) return { type: "csv", text: "(空文件)" };
    // 如果行数太多，只取前 200 行
    const truncated = lines.length > 200;
    const preview = lines.slice(0, 200).join("\n");
    return { type: "csv", text: preview + (truncated ? `\n...(共 ${lines.length} 行，已截断)` : "") };
  } catch (e) {
    throw new Error(`CSV 解析失败: ${e.message}`);
  }
}

/** 根据 Content-Type 和文件扩展名判断如何解析 */
async function parseResponse(resp, url) {
  const contentType = (resp.headers.get("content-type") || "").toLowerCase();
  const urlPath = new URL(url).pathname.toLowerCase();
  const limit = 10000;

  // PDF
  if (contentType.includes("pdf") || urlPath.endsWith(".pdf")) {
    const buffer = Buffer.from(await resp.arrayBuffer());
    const result = await parsePdf(buffer);
    return { ...result, text: result.text.slice(0, limit), truncated: result.text.length > limit };
  }

  // Word
  if (contentType.includes("wordprocessingml") || contentType.includes("msword") || urlPath.endsWith(".docx") || urlPath.endsWith(".doc")) {
    const buffer = Buffer.from(await resp.arrayBuffer());
    const result = await parseDocx(buffer);
    return { ...result, text: result.text.slice(0, limit), truncated: result.text.length > limit };
  }

  // Excel
  if (contentType.includes("spreadsheetml") || contentType.includes("ms-excel") || urlPath.endsWith(".xlsx") || urlPath.endsWith(".xls")) {
    const buffer = Buffer.from(await resp.arrayBuffer());
    const result = await parseXlsx(buffer);
    return { ...result, text: result.text.slice(0, limit), truncated: result.text.length > limit };
  }

  // CSV
  if (contentType.includes("csv") || urlPath.endsWith(".csv")) {
    const buffer = Buffer.from(await resp.arrayBuffer());
    const result = parseCsv(buffer);
    return { ...result, text: result.text.slice(0, limit), truncated: result.text.length > limit };
  }

  // HTML
  if (contentType.includes("text/html") || contentType.includes("xhtml")) {
    const html = await resp.text();
    const text = htmlToText(html);
    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ""])[1].trim();
    return { type: "html", title, text: text.slice(0, limit), truncated: text.length > limit };
  }

  // 纯文本
  const text = await resp.text();
  return { type: "text", text: text.slice(0, limit), truncated: text.length > limit };
}

// ---------- 工具定义 ----------

function getToolDefinitions() {
  return [
    {
      name: "web_search",
      description:
        "在互联网上搜索信息。用于调研类任务、查找技术文档、获取最新资讯。支持自然语言查询。返回搜索结果的标题、摘要和链接。如果没有配置 Exa API key，会自动降级到 DuckDuckGo。",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "搜索关键词或自然语言问题",
          },
          max_results: {
            type: "number",
            description: "返回结果数量，默认 8，最大 15",
          },
        },
        required: ["query"],
      },
      async handler({ query, max_results }, ctx) {
        if (!query?.trim()) throw new Error("搜索关键词不能为空");
        const max = Math.min(max_results || 8, 15);
        // 优先用 Exa（语义搜索，效果更好），没有 API key 就降级 DuckDuckGo
        const exaKey = ctx?.exaApiKey;
        if (exaKey) {
          const results = await searchExa(query.trim(), exaKey, max);
          return { engine: "exa", query: query.trim(), results };
        }
        const results = await searchDuckDuckGo(query.trim(), max);
        return { engine: "duckduckgo", query: query.trim(), results };
      },
    },

    {
      name: "fetch_url",
      description:
        "抓取指定 URL 的内容并转成可读文本。支持网页（HTML）、PDF 文档、Word 文档（.docx）、Excel 表格（.xlsx）、CSV 文件。用于阅读搜索结果中的链接、获取在线文档、查看用户提供的链接内容。",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "要抓取的 URL",
          },
          max_length: {
            type: "number",
            description: "返回文本的最大字符数，默认 10000",
          },
        },
        required: ["url"],
      },
      async handler({ url, max_length }) {
        if (!url?.trim()) throw new Error("URL 不能为空");
        const resp = await fetch(url.trim(), {
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            Accept: "text/html,application/xhtml+xml,text/plain,application/pdf,*/*",
          },
          signal: AbortSignal.timeout(30000),
          redirect: "follow",
        });
        if (!resp.ok) throw new Error(`请求失败: ${resp.status} ${resp.statusText}`);

        const result = await parseResponse(resp, resp.url);
        return { url: resp.url, ...result };
      },
    },

    {
      name: "download_file",
      description:
        "从 URL 下载文件到本地沙箱目录。下载后可以查看文件信息，但不会自动执行。注意：危险文件类型（.sh/.exe/.bat 等）会被标记警告。",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "文件下载地址",
          },
          filename: {
            type: "string",
            description: "保存的文件名（可选，默认从 URL 推断）",
          },
        },
        required: ["url"],
      },
      async handler({ url, filename }) {
        if (!sandboxDir) throw new Error("沙箱目录未初始化");
        if (!url?.trim()) throw new Error("URL 不能为空");

        const resp = await fetch(url.trim(), {
          headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
          signal: AbortSignal.timeout(60000),
          redirect: "follow",
        });
        if (!resp.ok) throw new Error(`下载失败: ${resp.status} ${resp.statusText}`);

        let saveName = filename || "";
        if (!saveName) {
          const disposition = resp.headers.get("content-disposition") || "";
          const nameMatch = disposition.match(/filename[*]?=(?:UTF-8''|"?)([^";\s]+)/i);
          if (nameMatch) saveName = decodeURIComponent(nameMatch[1]);
          else saveName = path.basename(new URL(resp.url).pathname) || "download";
        }
        saveName = sanitizeFilename(saveName);
        if (!saveName || saveName === "." || saveName === "_") saveName = "download";

        const dangerous = isDangerousFile(saveName);
        const contentLength = Number(resp.headers.get("content-length") || 0);
        if (contentLength > MAX_DOWNLOAD_SIZE) {
          throw new Error(`文件过大 (${(contentLength / 1024 / 1024).toFixed(1)}MB)，超过 50MB 限制`);
        }

        const savePath = path.join(sandboxDir, saveName);
        const ws = fs.createWriteStream(savePath);
        let bytesWritten = 0;

        const reader = resp.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            bytesWritten += value.length;
            if (bytesWritten > MAX_DOWNLOAD_SIZE) {
              ws.destroy();
              fs.unlinkSync(savePath);
              throw new Error("文件过大，超过 50MB 限制");
            }
            ws.write(value);
          }
        } finally {
          ws.end();
        }

        try { fs.chmodSync(savePath, 0o444); } catch { /* 忽略 */ }

        return {
          path: savePath,
          filename: saveName,
          size: bytesWritten,
          dangerous,
          warning: dangerous
            ? `⚠️ "${saveName}" 是可执行文件类型，已下载但设为只读，请勿直接执行。`
            : undefined,
        };
      },
    },
  ];
}

module.exports = { initSandbox, getToolDefinitions };

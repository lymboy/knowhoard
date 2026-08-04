/**
 * 网络搜索核心逻辑：Exa AI 优先，没配 API key 时降级 DuckDuckGo。
 * 从 webTools.js 抽出来独立成模块，供 mcp/webSearchServer.js（stdio MCP server）复用，
 * 避免搜索逻辑在内置工具和 MCP server 两处重复维护。
 */

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

async function webSearch(query, { exaApiKey, maxResults = 8 } = {}) {
  if (!query?.trim()) throw new Error("搜索关键词不能为空");
  const max = Math.min(maxResults || 8, 15);
  if (exaApiKey) {
    const results = await searchExa(query.trim(), exaApiKey, max);
    return { engine: "exa", query: query.trim(), results };
  }
  const results = await searchDuckDuckGo(query.trim(), max);
  return { engine: "duckduckgo", query: query.trim(), results };
}

module.exports = { searchExa, searchDuckDuckGo, webSearch };

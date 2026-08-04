#!/usr/bin/env node
/**
 * web_search 独立 MCP server（stdio）。
 *
 * 之前 web_search 是内置工具，用户在设置页"MCP 工具"列表里完全看不到它作为独立 server。
 * 这个脚本把它包成一个真正的 stdio MCP server，作为子进程启动，用现有 McpManager.connectAll
 * 机制连接——和用户手动添加的第三方 MCP server 走同一条路径，能在 MCP 工具列表里看到/开关/移除。
 *
 * 搜索逻辑本体在 webSearch.js（Exa 优先，无 key 降级 DuckDuckGo），这里只是协议壳。
 * exaApiKey 通过环境变量 EXA_API_KEY 传入（main/index.js 启动时从 settings 读出来注入）。
 */

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");
const { webSearch } = require("../tools/webSearch");

const server = new Server(
  { name: "web-search", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "web_search",
      description:
        "在互联网上搜索信息。用于调研类任务、查找技术文档、获取最新资讯。支持自然语言查询。返回搜索结果的标题、摘要和链接。如果没有配置 Exa API key，会自动降级到 DuckDuckGo。",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜索关键词或自然语言问题" },
          max_results: { type: "number", description: "返回结果数量，默认 8，最大 15" },
        },
        required: ["query"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "web_search") {
    throw new Error(`未知工具: ${request.params.name}`);
  }
  const { query, max_results } = request.params.arguments || {};
  const result = await webSearch(query, {
    exaApiKey: process.env.EXA_API_KEY || "",
    maxResults: max_results,
  });
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("web-search MCP server 启动失败:", err);
  process.exit(1);
});

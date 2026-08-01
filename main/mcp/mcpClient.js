/**
 * MCP（Model Context Protocol）客户端管理器。
 * 配置形式沿用 Claude Desktop 的 mcpServers 约定（大家最熟悉的格式）：
 *   { "serverName": { "command": "npx", "args": [...], "env": {...} } }
 * 目前只支持 stdio 方式起本地 MCP server，这是社区里最常见、最好排查问题的接入方式。
 */
let Client, StdioClientTransport;

async function loadSdk() {
  if (!Client) {
    ({ Client } = await import("@modelcontextprotocol/sdk/client/index.js"));
    ({ StdioClientTransport } = await import(
      "@modelcontextprotocol/sdk/client/stdio.js"
    ));
  }
}

class McpManager {
  constructor() {
    this.clients = new Map(); // serverName -> { client, tools }
  }

  async connectAll(mcpServers = {}) {
    await this.disconnectAll();
    await loadSdk();
    const entries = Object.entries(mcpServers);
    const results = [];
    for (const [name, cfg] of entries) {
      try {
        const transport = new StdioClientTransport({
          command: cfg.command,
          args: cfg.args || [],
          env: { ...process.env, ...(cfg.env || {}) },
        });
        const client = new Client(
          { name: "personal-kb", version: "0.1.0" },
          { capabilities: {} }
        );
        await client.connect(transport);
        const { tools } = await client.listTools();
        this.clients.set(name, { client, tools });
        results.push({ name, ok: true, toolCount: tools.length });
      } catch (error) {
        results.push({ name, ok: false, error: error.message });
      }
    }
    return results;
  }

  async disconnectAll() {
    for (const { client } of this.clients.values()) {
      try {
        await client.close();
      } catch {
        // 忽略关闭异常，不影响后续重连
      }
    }
    this.clients.clear();
  }

  /** 汇总所有已连接 server 的工具，转成 OpenAI function-calling 的 tools 格式 */
  listOpenAiTools() {
    const tools = [];
    for (const [serverName, { tools: serverTools }] of this.clients.entries()) {
      for (const tool of serverTools) {
        tools.push({
          type: "function",
          function: {
            // 前缀 server 名，避免多个 MCP server 出现同名工具冲突
            name: `${serverName}__${tool.name}`,
            description: tool.description || "",
            parameters: tool.inputSchema || { type: "object", properties: {} },
          },
        });
      }
    }
    return tools;
  }

  async callTool(qualifiedName, args) {
    const sepIndex = qualifiedName.indexOf("__");
    const serverName = qualifiedName.slice(0, sepIndex);
    const toolName = qualifiedName.slice(sepIndex + 2);
    const entry = this.clients.get(serverName);
    if (!entry) throw new Error(`MCP server 未连接: ${serverName}`);
    const result = await entry.client.callTool({ name: toolName, arguments: args });
    return result;
  }

  hasAnyTool() {
    return this.listOpenAiTools().length > 0;
  }
}

module.exports = { McpManager };

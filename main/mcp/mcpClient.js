/**
 * MCP（Model Context Protocol）客户端管理器 + 内置工具管理。
 *
 * 两类工具统一由这个类管理：
 * - 外部 MCP server：用户在设置里手动添加，走 stdio 协议连接
 * - 内置工具（read_file / list_directory / search_files）：代码里定义，
 *   在设置里跟 MCP server 放一起展示，用户可以逐个开关
 *
 * 两类工具对 agentLoop 来说没有区别——listOpenAiTools() 统一返回，
 * callTool() 统一分发，调用方不需要知道底层是 MCP 还是内置。
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

const BUILTIN_PREFIX = "builtin";

class McpManager {
  constructor() {
    this.clients = new Map();       // serverName -> { client, tools }
    this.builtinDefs = new Map();   // toolName -> tool definition (from builtinTools.js)
    this.builtinEnabled = new Map(); // toolName -> boolean
  }

  // ---------- 内置工具管理 ----------

  /** 注册内置工具定义，调用一次即可（启动时从 index.js 调） */
  setBuiltinTools(tools) {
    this.builtinDefs.clear();
    for (const tool of tools) {
      this.builtinDefs.set(tool.name, tool);
    }
  }

  /** 从 settings 恢复每个内置工具的开关状态；没有存过就全部默认开启 */
  restoreBuiltinState(enabledMap) {
    for (const name of this.builtinDefs.keys()) {
      // enabledMap 为 undefined（首次启动，settings 里没有 builtinTools 字段）时全部开启
      this.builtinEnabled.set(name, enabledMap ? (enabledMap[name] !== false) : true);
    }
  }

  toggleBuiltinTool(name, enabled) {
    if (!this.builtinDefs.has(name)) return;
    this.builtinEnabled.set(name, !!enabled);
  }

  /** 返回设置面板需要的列表：每个内置工具的名称、描述、是否启用 */
  listBuiltinToolInfo() {
    const result = [];
    for (const [name, def] of this.builtinDefs.entries()) {
      result.push({
        name,
        description: def.description,
        enabled: this.builtinEnabled.get(name) ?? true,
      });
    }
    return result;
  }

  // ---------- MCP server 管理 ----------

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

  // ---------- 统一工具接口 ----------

  /** 汇总所有工具（内置 + MCP），转成 OpenAI function-calling 的 tools 格式 */
  listOpenAiTools() {
    const tools = [];
    // 内置工具
    for (const [name, def] of this.builtinDefs.entries()) {
      if (!this.builtinEnabled.get(name)) continue;
      tools.push({
        type: "function",
        function: {
          name: `${BUILTIN_PREFIX}__${name}`,
          description: def.description,
          parameters: def.inputSchema,
        },
      });
    }
    // MCP 工具
    for (const [serverName, { tools: serverTools }] of this.clients.entries()) {
      for (const tool of serverTools) {
        tools.push({
          type: "function",
          function: {
            name: `${serverName}__${tool.name}`,
            description: tool.description || "",
            parameters: tool.inputSchema || { type: "object", properties: {} },
          },
        });
      }
    }
    return tools;
  }

  async callTool(qualifiedName, args, ctx) {
    const sepIndex = qualifiedName.indexOf("__");
    const prefix = qualifiedName.slice(0, sepIndex);
    const toolName = qualifiedName.slice(sepIndex + 2);

    // 内置工具
    if (prefix === BUILTIN_PREFIX) {
      const def = this.builtinDefs.get(toolName);
      if (!def) throw new Error(`未知的内置工具: ${toolName}`);
      return await def.handler(args, ctx);
    }

    // MCP 工具
    const entry = this.clients.get(prefix);
    if (!entry) throw new Error(`MCP server 未连接: ${prefix}`);
    const result = await entry.client.callTool({ name: toolName, arguments: args });
    return result;
  }

  hasAnyTool() {
    // 内置工具有任何一个启用的
    for (const enabled of this.builtinEnabled.values()) {
      if (enabled) return true;
    }
    // MCP 工具有任何一个连接的
    return this.clients.size > 0;
  }
}

module.exports = { McpManager };

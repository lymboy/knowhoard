const fs = require("fs");
const path = require("path");

const DEFAULTS = {
  llm: {
    baseUrl: "",
    apiKey: "",
    model: "",
    customHeaders: {},
    thinkingSupported: false,
    temperature: 0.7,
    topP: 1,
    topK: "",
    maxTokens: "",
  },
  ragDefaultEnabled: true,
  // 对话开关状态持久化：用户上次设的思考/检索开关，下次进来直接恢复，不用每次重选
  chatThinkingEnabled: false,
  autoSyncOnLaunch: true,
  autoSyncIntervalMinutes: 20,
  hasSeenOnboarding: false,
  toolsEnabled: true,
  exaApiKey: "",
  builtinTools: {
    read_file: true,
    list_directory: true,
    search_files: true,
    fetch_url: true,
    download_file: true,
  },
  mcpServers: {},
  // web_search 曾是内置工具，现在改造成独立 MCP server（main/mcp/webSearchServer.js）。
  // 首次启动时自动写入 mcpServers.web-search 一次；标记置 true 后不再重复插入——
  // 这样用户手动移除它之后，重启 app 不会又被自动加回来
  webSearchMcpBootstrapped: false,
  // Skill 开关：key 是 skill 目录的绝对路径（见 main/skills/skillsManager.js 的 getSkillRoots），
  // 不用目录名——不同来源目录下可能有同名 skill 子目录，目录名不足以唯一标识。
  // 没扫到过的 Skill 不在这里，默认视为未启用（新增的 Skill 目录不会自动开启）
  skillsEnabled: {},
};

let settingsPath = null;
let cache = null;

function initSettings(userDataPath) {
  settingsPath = path.join(userDataPath, "settings.json");
  if (fs.existsSync(settingsPath)) {
    try {
      cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsPath, "utf-8")) };
    } catch {
      cache = { ...DEFAULTS };
    }
  } else {
    cache = { ...DEFAULTS };
  }
  return cache;
}

function getSettings() {
  if (!cache) throw new Error("设置尚未初始化");
  return cache;
}

function updateSettings(partial) {
  cache = {
    ...cache,
    ...partial,
    llm: { ...cache.llm, ...(partial.llm || {}) },
  };
  fs.writeFileSync(settingsPath, JSON.stringify(cache, null, 2), "utf-8");
  return cache;
}

module.exports = { initSettings, getSettings, updateSettings };

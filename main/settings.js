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
    web_search: true,
    fetch_url: true,
    download_file: true,
  },
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

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("kb", {
  shell: {
    openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url),
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    update: (partial) => ipcRenderer.invoke("settings:update", partial),
  },
  obsidian: {
    status: () => ipcRenderer.invoke("obsidian:status"),
  },
  sources: {
    list: () => ipcRenderer.invoke("sources:list"),
    add: () => ipcRenderer.invoke("sources:add"),
    addObsidianVault: (vault) => ipcRenderer.invoke("sources:addObsidianVault", vault),
    remove: (id) => ipcRenderer.invoke("sources:remove", id),
    sync: (id) => ipcRenderer.invoke("sources:sync", id),
    onProgress: (cb) => {
      const listener = (_e, data) => cb(data);
      ipcRenderer.on("sync:progress", listener);
      return () => ipcRenderer.removeListener("sync:progress", listener);
    },
  },
  documents: {
    list: (params) => ipcRenderer.invoke("documents:list", params),
    openInFinder: (filePath) => ipcRenderer.invoke("documents:openInFinder", filePath),
    removeOne: (documentId) => ipcRenderer.invoke("documents:removeOne", documentId),
    stats: () => ipcRenderer.invoke("documents:stats"),
  },
  mcp: {
    test: (servers) => ipcRenderer.invoke("mcp:test", servers),
    reconnect: () => ipcRenderer.invoke("mcp:reconnect"),
    hasTools: () => ipcRenderer.invoke("mcp:hasTools"),
  },
  builtinTools: {
    list: () => ipcRenderer.invoke("builtinTools:list"),
    toggle: (name, enabled) => ipcRenderer.invoke("builtinTools:toggle", { name, enabled }),
  },
  llm: {
    probeThinking: (config) => ipcRenderer.invoke("llm:probeThinking", config),
    listModels: (config) => ipcRenderer.invoke("llm:listModels", config),
  },
  stats: {
    tokenUsage: (options) => ipcRenderer.invoke("stats:tokenUsage", options),
  },
  messages: {
    deleteMany: (ids) => ipcRenderer.invoke("messages:deleteMany", ids),
  },
  favorites: {
    add: (messageId, conversationId) => ipcRenderer.invoke("favorites:add", { messageId, conversationId }),
    remove: (messageId) => ipcRenderer.invoke("favorites:remove", messageId),
    list: () => ipcRenderer.invoke("favorites:list"),
  },
  conversations: {
    list: () => ipcRenderer.invoke("conversations:list"),
    create: (title) => ipcRenderer.invoke("conversations:create", title),
    rename: (id, title) => ipcRenderer.invoke("conversations:rename", { id, title }),
    remove: (id) => ipcRenderer.invoke("conversations:delete", id),
    getMessages: (id, options) => ipcRenderer.invoke("conversations:getMessages", id, options),
  },
  chat: {
    send: (params) => ipcRenderer.invoke("chat:send", params),
    stop: (requestId) => ipcRenderer.invoke("chat:stop", requestId),
    onEvent: (cb) => {
      const listener = (_e, data) => cb(data);
      ipcRenderer.on("chat:event", listener);
      return () => ipcRenderer.removeListener("chat:event", listener);
    },
  },
  ai: {
    onStatus: (cb) => {
      const listener = (_e, data) => cb(data);
      ipcRenderer.on("ai:status", listener);
      return () => ipcRenderer.removeListener("ai:status", listener);
    },
  },
  app: {
    onShowOnboarding: (cb) => {
      const listener = () => cb();
      ipcRenderer.on("show-onboarding", listener);
      return () => ipcRenderer.removeListener("show-onboarding", listener);
    },
  },
});

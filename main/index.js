const { app, BrowserWindow, Menu, shell, screen } = require("electron");
const path = require("path");
const os = require("os");

const { initDb } = require("./db/sqlite");
const { initVectorStore } = require("./vector/store");
const { initSettings, getSettings } = require("./settings");
const { AiWorkerClient } = require("./ai/aiWorkerClient");
const { McpManager } = require("./mcp/mcpClient");
const { TOOL_DEFINITIONS } = require("./tools/builtinTools");
const webTools = require("./tools/webTools");
const { EMBEDDING_DIMENSIONS } = require("./ai/dimensions");
const { registerIpcHandlers } = require("./ipc");
const sync = require("./ingest/sync");

const APP_NAME = "小怪兽知识库";
const AUTHOR_BLURB =
  "作者：小怪兽\n一个本地优先、隐私优先的个人知识库问答客户端。\n如有需要，请联系 liusairo@gmail.com";

app.setName(APP_NAME); // 必须在 app 'ready' 之前调用，否则开发模式下菜单栏可能仍显示 "Electron"

// 开发模式开 remote debugging 端口，方便 chrome-devtools MCP 连上看渲染层 Console
// 必须在 app ready 之前调 appendSwitch 才生效
if (process.env.NODE_ENV !== "production") {
  app.commandLine.appendSwitch("remote-debugging-port", "9223");
  app.commandLine.appendSwitch("remote-allow-origins", "*");
}

let mainWindow = null;
let lastAiStatus = null; // 窗口/渲染进程还没就绪时状态事件就先发出来了，缓存最新一条，页面加载完补发一次

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "编辑",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "视图",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "帮助",
      submenu: [
        {
          label: "关于小怪兽的个人知识库",
          // 原生 dialog.showMessageBox 太干瘪了，直接复用首次启动那个做好的引导弹窗，
          // 视觉上跟应用本身一致，内容也更完整（功能介绍 + 隐私承诺），不用维护两份文案
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send("show-onboarding");
            }
          },
        },
        {
          label: "联系作者",
          click: () => shell.openExternal("mailto:liusairo@gmail.com"),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// 按"用户当前正在用的那块屏幕"算窗口大小，而不是固定尺寸——
// 同一个固定尺寸在自带小屏和外接 2K/4K 屏上观感差异很大：小屏可能顶到边，大屏又显得窗口小得突兀。
function computeWindowBounds() {
  const cursorPoint = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursorPoint);
  const { workArea } = display;

  // 只做 Mac 一个平台，分辨率区间相对可控，窗口可以给得更大一点，不用过度保守
  const targetWidth = Math.round(workArea.width * 0.86);
  const targetHeight = Math.round(workArea.height * 0.92);
  const width = Math.min(1800, Math.max(1280, targetWidth));
  const height = Math.min(1150, Math.max(820, targetHeight));

  const x = Math.round(workArea.x + (workArea.width - width) / 2);
  const y = Math.round(workArea.y + (workArea.height - height) / 2);

  return { x, y, width, height };
}

function createWindow() {
  const bounds = computeWindowBounds();
  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 860,
    minHeight: 560,
    title: APP_NAME,
    titleBarStyle: "hiddenInset", // 去掉那条灰色标题栏文字，红黄绿三个按钮保留、悬浮在内容上方
    icon: path.join(__dirname, "..", "build", "icon.png"),
    backgroundColor: "#0c0a1a",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  // 开发模式自动打开 DevTools，方便排查 Vue 迁移期的渲染层报错
  if (process.env.NODE_ENV !== "production" && !process.env.KB_NO_DEVTOOLS) {
    mainWindow.webContents.once("dom-ready", () => mainWindow.webContents.openDevTools({ mode: "detach" }));
  }
  // 模型预热可能在渲染进程的监听器还没挂上之前就已经在发状态了，页面刚加载完这里补发一次，
  // 不然状态事件全被早发的那几条白白扔掉，界面永远卡在写死的默认文案上
  mainWindow.webContents.once("did-finish-load", () => {
    if (lastAiStatus) mainWindow.webContents.send("ai:status", lastAiStatus);
  });
  // 关窗口不等于进程退出（Mac 上进程还留在 Dock 里，点图标要能重新弹出窗口）——
  // 不清空这个引用的话，它会一直指向一个已经 destroyed 的 BrowserWindow，之后任何
  // 一次 mainWindow.webContents.send(...)（AI 状态推送、同步进度等）都会直接抛异常炸主进程
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  return mainWindow;
}

let autoSyncTimer = null;
let autoSyncRunning = false;
// 退出前 flush 进行中流式的函数，由 registerIpcHandlers 返回，whenReady 里赋值，before-quit 用
let flushPendingChats = null;

// 增删改都要能感知到，尤其是删除——用户删掉一份含密码的文档，索引里也得跟着清掉，
// 这不是"锦上添花"，是数据隐私的底线。不需要实时，定期跑一遍 MD5 diff 同步就够了：
// 内容没变的文件立刻跳过，几乎不占资源；变了/删了的才会真正重新处理。
function scheduleAutoSync(aiClient) {
  const runOnce = async () => {
    if (autoSyncRunning) return; // 上一轮还没跑完就跳过这次，不重叠堆积
    if (!sync.listSources().length) return;
    autoSyncRunning = true;
    try {
      await sync.syncAll(aiClient, (event) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("sync:progress", event);
      });
    } catch (error) {
      console.error("自动同步失败", error);
    } finally {
      autoSyncRunning = false;
    }
  };

  const settings = getSettings();
  if (settings.autoSyncOnLaunch) runOnce();

  const intervalMs = Math.max(5, settings.autoSyncIntervalMinutes || 20) * 60 * 1000;
  autoSyncTimer = setInterval(runOnce, intervalMs);
}

app.whenReady().then(async () => {
  // 开发模式下（直接跑 node_modules 里的 Electron 二进制）没有打包过的 Info.plist 可读，
  // Dock 图标会默认显示 Electron 自己的原子 logo；打包成 DMG 后 electron-builder 会自动读
  // build/icon.icns 不需要这一步，但开发时得手动设一下，不然看到的一直是原子图标
  if (process.platform === "darwin" && app.dock) {
    app.dock.setIcon(path.join(__dirname, "..", "build", "icon.png"));
  }

  const userDataPath = app.getPath("userData");
  initDb(userDataPath);
  initSettings(userDataPath);
  await initVectorStore(userDataPath, EMBEDDING_DIMENSIONS);

  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: app.getVersion(),
    credits: AUTHOR_BLURB,
  });

  const aiClient = new AiWorkerClient(
    path.join(userDataPath, "models"),
    (status) => {
      lastAiStatus = status;
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("ai:status", status);
    }
  );
  const mcpManager = new McpManager();
  const settings = getSettings();
  // 初始化下载沙箱
  webTools.initSandbox(userDataPath);
  // 注册内置工具（文件工具 + 网络工具），然后从 settings 恢复每个工具的开关状态
  const allBuiltinTools = [...TOOL_DEFINITIONS, ...webTools.getToolDefinitions()];
  mcpManager.setBuiltinTools(allBuiltinTools);
  mcpManager.restoreBuiltinState(settings.builtinTools);

  if (settings.mcpServers && Object.keys(settings.mcpServers).length) {
    mcpManager.connectAll(settings.mcpServers).catch((err) => {
      console.error("MCP 初始连接失败", err);
    });
  }

  buildMenu();
  createWindow();
  // 传函数而不是当时那个窗口对象快照——这些 handler 只在启动时注册一次，
  // 但窗口可能关了又通过 Dock 图标重新建一个新的，用函数才能每次都拿到当前活着的窗口
  const ipcApi = registerIpcHandlers({ getWindow: () => mainWindow, aiClient, mcpManager, userDataPath });
  flushPendingChats = ipcApi.flushPendingChats;
  scheduleAutoSync(aiClient);

  // 预热跟"要不要检索本地知识库"这个开关完全无关——不管开没开，本地模型都该提前热好，
  // 省得用户第一次真正用到的时候（不管是问答检索还是同步）现场等冷启动。
  // 之前这里还判断了一下开机负载，够不着阈值就跳过，而且跳过时界面上什么提示都没有，
  // 看起来就是"一直没加载"——这个判断意义不大（加载一个 23MB 的小模型算不上重负担），
  // 直接去掉，开机就无条件预热。
  aiClient.warmup().catch((err) => console.error("模型预热失败", err));

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 退出前收尾：把进行中的流式问答 abort 掉（触发它们把已流出的内容落库），等落库完成再真正退出。
// 不做这一步的话，关窗/pkill 时正在生成的助手消息会整条丢失（之前要等 done 才写库）
let isQuitting = false;
app.on("before-quit", (event) => {
  if (autoSyncTimer) clearInterval(autoSyncTimer);
  if (isQuitting) return;
  isQuitting = true;
  event.preventDefault();
  // abort 全部 + 等落库（最多等 2 秒，避免卡死退出）
  Promise.race([
    flushPendingChats(),
    new Promise((r) => setTimeout(r, 2000)),
  ]).finally(() => app.exit());
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

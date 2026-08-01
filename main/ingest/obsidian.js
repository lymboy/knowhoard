const fs = require("fs");
const os = require("os");
const path = require("path");
const { exec } = require("child_process");
const util = require("util");

const execAsync = util.promisify(exec);

function obsidianConfigPath() {
  // Obsidian 官方客户端在 macOS 上的全局配置，记录了所有"已知 vault"及其路径
  return path.join(os.homedir(), "Library", "Application Support", "obsidian", "obsidian.json");
}

async function isObsidianRunning() {
  try {
    const { stdout } = await execAsync("pgrep -x Obsidian");
    return stdout.trim().length > 0;
  } catch {
    return false; // pgrep 找不到进程时会以非 0 退出，等价于"没在运行"
  }
}

/**
 * 读取 Obsidian 官方配置文件里记录的所有 vault，不依赖任何第三方 CLI，
 * 只要本机装过 Obsidian 客户端就能读到，兼容性最好。
 */
async function listKnownVaults() {
  const configPath = obsidianConfigPath();
  if (!fs.existsSync(configPath)) return [];

  try {
    const raw = await fs.promises.readFile(configPath, "utf-8");
    const config = JSON.parse(raw);
    const vaults = config.vaults || {};
    return Object.entries(vaults)
      .map(([id, info]) => ({
        id,
        path: info.path,
        name: path.basename(info.path),
        open: !!info.open,
        lastUsed: info.ts || 0,
        exists: fs.existsSync(info.path),
      }))
      .sort((a, b) => b.lastUsed - a.lastUsed);
  } catch (error) {
    console.error("读取 Obsidian 配置失败:", error);
    return [];
  }
}

async function getObsidianStatus() {
  const [running, vaults] = await Promise.all([
    isObsidianRunning(),
    listKnownVaults(),
  ]);
  return { running, vaults };
}

module.exports = { isObsidianRunning, listKnownVaults, getObsidianStatus };

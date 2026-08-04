const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SUPPORTED_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".docx", ".pdf"]);

function isSupported(filePath) {
  return SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function computeMd5(buffer) {
  return crypto.createHash("md5").update(buffer).digest("hex");
}

/**
 * 只读文件内容，绝不写回原文件——这是保护用户原始资料的硬规则。
 * @param {string} filePath
 * @param {(info: {page: number, total: number}) => void} [onOcrPageProgress] OCR 逐页进度回调（仅扫描件 PDF 会用到）
 * @returns {Promise<{text: string, hash: string, size: number, mtime: number}>}
 */
async function readFileContent(filePath, onOcrPageProgress) {
  const ext = path.extname(filePath).toLowerCase();
  const stat = await fs.promises.stat(filePath);
  const buffer = await fs.promises.readFile(filePath);
  const hash = computeMd5(buffer);

  let text = "";
  if (ext === ".md" || ext === ".markdown" || ext === ".txt") {
    text = buffer.toString("utf-8");
  } else if (ext === ".docx") {
    const mammoth = require("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
  } else if (ext === ".pdf") {
    const pdfParse = require("pdf-parse");
    const result = await pdfParse(buffer);
    text = result.text;
    // pdf-parse 走的是文本层提取（基于 pdf.js），对由 Markdown/Word 转出来的文本型 PDF 效果很好；
    // 但扫描件/图片型 PDF 没有文本层，提取出的内容几乎空白——这种情况改走本地 OCR（main/ingest/ocr.js），
    // 而不是直接报错甩给用户。OCR 比文本提取慢得多，只在真正需要时才触发。
    if (text.trim().length < 20 && buffer.length > 5000) {
      const { ocrPdfBuffer } = require("./ocr");
      text = await ocrPdfBuffer(buffer, onOcrPageProgress);
      if (text.trim().length < 20) {
        throw new Error("OCR 未能从这个 PDF 中识别出有效文字，可能图片质量过低或页面为空白");
      }
    }
  } else {
    throw new Error(`不支持的文件类型: ${ext}`);
  }

  return { text, hash, size: stat.size, mtime: stat.mtimeMs };
}

/**
 * 递归遍历目录，返回所有受支持的文件路径。
 * 跳过常见的噪音目录（.git、.obsidian、node_modules 等）。
 *
 * 根目录读取失败（权限问题、iCloud 还没挂载好、磁盘瞬时抖动等）必须直接抛出去，
 * 绝不能悄悄当成"这个目录是空的"——上游的增量同步逻辑会把"扫描结果里没有的文件"
 * 当成"已经被删除"去清索引，根目录读失败被吞掉的话，一次瞬时故障就会把整个数据源的
 * 索引全部清空。只有递归到子目录时读失败才可以跳过（放过一个子目录不至于把全部数据搞丢）。
 */
async function walkDirectory(rootPath) {
  // 第一道闸：所有点开头的条目（隐藏文件 + 隐藏目录）一律跳过。这一条就覆盖了绝大多数噪音：
  //   - 版本控制：.git .svn .hg
  //   - IDE 配置：.idea .vscode .vs .fleet .zed .settings（Eclipse 的 .project/.classpath 也在此）
  //   - 工具缓存：.gradle .mypy_cache .pytest_cache .parcel-cache .turbo .svelte-kit .expo .terraform .terragrunt-cache .next .nuxt .cache
  //   - Obsidian/系统：.obsidian .trash .DS_Store
  //   - 环境与配置文件：.venv .env .env.local .editorconfig .gitignore .npmrc
  // 下面 SKIP_DIRS 只补「名字不以点开头、但属于依赖/构建/缓存」的目录——这些不会被点开头规则捕获。
  const SKIP_DIRS = new Set([
    // 依赖目录
    "node_modules", "bower_components",
    // 构建/编译输出（Maven target、通用 dist/build/out、Cargo target）
    "dist", "build", "out", "target",
    // 语言运行时缓存/虚拟环境
    "__pycache__", "venv",
    // 测试覆盖率/日志/临时（常见 .gitignore 项）
    "coverage", "logs", "tmp",
    // 移动端依赖（CocoaPods）
    "Pods",
  ]);
  const results = [];

  async function walk(dir, isRoot) {
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (isRoot) throw error; // 根目录读不了，整次扫描必须失败，不能假装是空目录
      return; // 子目录读不了，跳过这一个子目录就好
    }
    for (const entry of entries) {
      // 隐藏文件 + 隐藏目录（点开头）一律跳过
      if (entry.name.startsWith(".")) continue;
      // 非隐藏但属于依赖/构建/缓存的目录跳过
      if (SKIP_DIRS.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath, false);
      } else if (entry.isFile() && isSupported(fullPath)) {
        results.push(fullPath);
      }
    }
  }

  await walk(rootPath, true);
  return results;
}

module.exports = {
  SUPPORTED_EXTENSIONS,
  isSupported,
  computeMd5,
  readFileContent,
  walkDirectory,
};

/**
 * 内置工具：read_file / list_directory / search_files。
 * 所有路径操作限制在用户已添加的数据源目录内，不碰别的地方——
 * 数据源目录 = 用户授权范围，零额外权限弹窗。
 */
const path = require("path");
const fs = require("fs");
const { getDb } = require("../db/sqlite");

// ---------- 路径安全校验 ----------

/** 获取所有数据源的根目录（去重、resolve 过） */
function getAllowedRoots() {
  const db = getDb();
  const sources = db.prepare(`SELECT path FROM sources`).all();
  const roots = [];
  for (const s of sources) {
    try {
      // resolve 消除符号链接和 .. 等绕路可能
      roots.push(fs.realpathSync(path.resolve(s.path)));
    } catch {
      // 数据源目录被删了等情况，跳过
    }
  }
  return roots;
}

/**
 * 校验请求的路径是否落在某个数据源目录内。
 * 返回 resolve 后的绝对路径；不合法则抛异常。
 */
function safePath(requestedPath) {
  const roots = getAllowedRoots();
  if (!roots.length) throw new Error("还没有添加任何数据源，无法使用文件工具。");

  const resolved = fs.realpathSync(path.resolve(requestedPath));

  for (const root of roots) {
    // 文件型数据源：精确匹配或在其子目录下
    if (resolved === root || resolved.startsWith(root + path.sep)) {
      return resolved;
    }
  }
  throw new Error(
    `安全限制：只能访问已添加数据源目录内的文件。请求的路径 "${requestedPath}" 不在任何数据源范围内。`
  );
}

// ---------- 工具定义 ----------

const TOOL_DEFINITIONS = [
  {
    name: "read_file",
    description:
      "读取本地知识库中某个文件的完整内容。当你认为检索结果不足以回答问题、或用户指出回答不完整时，用这个工具去读原文。只能访问用户已添加的数据源目录内的文件。",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "文件的绝对路径（必须在已添加的数据源目录内）",
        },
      },
      required: ["path"],
    },
    async handler({ path: filePath }) {
      const safe = safePath(filePath);
      const stat = fs.statSync(safe);
      if (!stat.isFile()) throw new Error(`不是文件: ${safe}`);
      // 限制读取大小，防止 LLM 传了个 100MB 的文件把内存打满
      const MAX_SIZE = 2 * 1024 * 1024; // 2MB
      if (stat.size > MAX_SIZE) {
        throw new Error(`文件过大 (${(stat.size / 1024 / 1024).toFixed(1)}MB)，超过 2MB 限制`);
      }
      const text = fs.readFileSync(safe, "utf-8");
      return { path: safe, size: stat.size, content: text };
    },
  },

  {
    name: "list_directory",
    description:
      "列出本地知识库某个目录下的所有文件和子目录。用来浏览数据源的目录结构、发现相关文件。只能访问用户已添加的数据源目录。",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "目录的绝对路径（必须在已添加的数据源目录内）",
        },
      },
      required: ["path"],
    },
    async handler({ path: dirPath }) {
      const safe = safePath(dirPath);
      const stat = fs.statSync(safe);
      if (!stat.isDirectory()) throw new Error(`不是目录: ${safe}`);
      const entries = fs.readdirSync(safe, { withFileTypes: true });
      return {
        path: safe,
        entries: entries.map((e) => ({
          name: e.name,
          type: e.isDirectory() ? "directory" : "file",
        })),
      };
    },
  },

  {
    name: "search_files",
    description:
      "在本地知识库的文件中搜索关键词（全文搜索）。当你知道要找什么但不确定在哪个文件里时使用。搜索范围限制在已添加的数据源目录内。",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "要搜索的关键词",
        },
        directory: {
          type: "string",
          description: "限定在某个目录下搜索（可选，默认搜索所有数据源）",
        },
      },
      required: ["query"],
    },
    async handler({ query, directory }) {
      if (!query || !query.trim()) throw new Error("搜索关键词不能为空");

      // 先走 SQLite FTS5 高速路径——已索引的文档直接从数据库搜，不用再读一次文件
      const db = getDb();
      try {
        const escaped = `"${query.replace(/"/g, '""')}"`;
        const rows = db
          .prepare(
            `SELECT d.path, d.filename, d.folder, snippet(chunks_fts, 0, '>>>', '<<<', '…', 40) as snippet
             FROM chunks_fts
             JOIN chunks c ON c.id = chunks_fts.chunk_id
             JOIN documents d ON d.id = c.document_id
             WHERE chunks_fts MATCH ?
             ORDER BY bm25(chunks_fts)
             LIMIT 20`
          )
          .all(escaped);

        // 如果指定了目录，过滤到该目录下
        let results = rows;
        if (directory) {
          const dirSafe = safePath(directory);
          results = rows.filter((r) => {
            try {
              return fs.realpathSync(path.resolve(r.path)).startsWith(dirSafe + path.sep);
            } catch {
              return false;
            }
          });
        }

        if (results.length) {
          return {
            source: "index",
            query,
            results: results.map((r) => ({
              path: r.path,
              filename: r.filename,
              snippet: r.snippet,
            })),
          };
        }
      } catch {
        // FTS 查不到或出错，退化成文件系统搜索
      }

      // FTS 没命中时退化成文件名/路径关键词搜索
      const roots = directory ? [safePath(directory)] : getAllowedRoots();
      const matches = [];
      const q = query.toLowerCase();
      function walk(dir, depth) {
        if (depth > 8 || matches.length >= 30) return; // 限制递归深度和结果数
        let entries;
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          if (matches.length >= 30) break;
          const full = path.join(dir, e.name);
          if (e.name.toLowerCase().includes(q)) {
            matches.push({ path: full, name: e.name, type: e.isDirectory() ? "directory" : "file" });
          }
          if (e.isDirectory()) walk(full, depth + 1);
        }
      }
      for (const root of roots) walk(root, 0);

      return { source: "filesystem", query, results: matches };
    },
  },
];

module.exports = { TOOL_DEFINITIONS };

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,              -- 'folder' | 'file' | 'obsidian_vault'
  path TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  folder TEXT NOT NULL,
  ext TEXT,
  size INTEGER,
  mtime INTEGER,
  content_hash TEXT,
  indexed_at INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | indexed | error | missing
  error TEXT,
  FOREIGN KEY(source_id) REFERENCES sources(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_documents_source ON documents(source_id);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  text TEXT NOT NULL,
  char_count INTEGER NOT NULL,
  FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);

-- 关键词检索：笔记正文
-- 用 trigram 分词器而不是默认的 unicode61：中文没有空格分词，unicode61 会把一整句中文
-- 切成一个大 token，基本搜不出东西；trigram 按三字符子串匹配，对中文关键词检索友好得多。
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  chunk_id UNINDEXED,
  document_id UNINDEXED,
  text,
  tokenize = 'trigram'
);

-- 关键词检索：文件名 / 目录路径（解决"记得内容记不得文件在哪"的场景）
CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
  document_id UNINDEXED,
  filename,
  folder,
  path,
  tokenize = 'trigram'
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,              -- user | assistant
  content BLOB NOT NULL,           -- gzip 压缩后的正文，读取时透明解压
  reasoning BLOB,                  -- gzip 压缩后的思考过程（如果有）
  citations TEXT,                  -- JSON: [{documentId, path, filename, snippet}]
  rag_enabled INTEGER NOT NULL DEFAULT 0,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);

-- 收藏：只存一个指向 message 的引用，不拷贝内容。message 被删（含随会话级联删除）时，
-- 数据库层面的 ON DELETE CASCADE 会自动把对应收藏一并清掉，不需要业务代码手动同步。
CREATE TABLE IF NOT EXISTS favorites (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL UNIQUE,
  conversation_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE
);
`;

let db = null;

function initDb(userDataPath) {
  if (db) return db;
  const dbPath = path.join(userDataPath, "kb.sqlite3");
  fs.mkdirSync(userDataPath, { recursive: true });
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

// SQLite 的 ALTER TABLE 不支持 IF NOT EXISTS，靠 pragma 查列是否存在再做增量迁移
function migrate(db) {
  const messageCols = db.prepare(`PRAGMA table_info(messages)`).all().map((c) => c.name);
  if (!messageCols.includes("tool_calls")) {
    // JSON: [{ name, args, result, ok }]——一轮问答里调用过的工具记录，
    // 用于切走再切回会话时还原工具调用折叠块
    db.exec(`ALTER TABLE messages ADD COLUMN tool_calls TEXT`);
  }
}

function getDb() {
  if (!db) throw new Error("数据库尚未初始化，请先调用 initDb()");
  return db;
}

module.exports = { initDb, getDb };

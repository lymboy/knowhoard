const { getDb } = require("../db/sqlite");
const vectorStore = require("../vector/store");

const VECTOR_TOP_K = 20;
const KEYWORD_TOP_K = 20;
const DOC_MATCH_TOP_K = 10;
const RERANK_CANDIDATES = 15;
const FINAL_TOP_K = 6;
const RRF_K = 60; // Reciprocal Rank Fusion 的平滑常数，业界常用默认值

function escapeForFtsPhrase(query) {
  // trigram 分词器下，把整段 query 当一个短语子串匹配即可，不需要用户懂 FTS5 语法
  return `"${query.replace(/"/g, '""')}"`;
}

function keywordSearchChunks(query) {
  const db = getDb();
  try {
    return db
      .prepare(
        `SELECT chunk_id as id, document_id, bm25(chunks_fts) as rank
         FROM chunks_fts WHERE chunks_fts MATCH ?
         ORDER BY rank LIMIT ?`
      )
      .all(escapeForFtsPhrase(query), KEYWORD_TOP_K);
  } catch {
    return []; // query 太短（trigram 至少需要 3 个字符）等边界情况，降级为空结果
  }
}

function filenamePathSearch(query) {
  const db = getDb();
  try {
    return db
      .prepare(
        `SELECT document_id, bm25(documents_fts) as rank
         FROM documents_fts WHERE documents_fts MATCH ?
         ORDER BY rank LIMIT ?`
      )
      .all(escapeForFtsPhrase(query), DOC_MATCH_TOP_K);
  } catch {
    return [];
  }
}

function rrfMerge(rankedLists) {
  // rankedLists: Array<Array<{ id, ...}>>，每个子数组已按相关性排好序
  const scores = new Map();
  for (const list of rankedLists) {
    list.forEach((item, index) => {
      const prev = scores.get(item.id) || { score: 0, item };
      prev.score += 1 / (RRF_K + index + 1);
      scores.set(item.id, prev);
    });
  }
  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .map((x) => x.item);
}

/**
 * 混合检索：向量语义 + 正文关键词 + 文件名/路径匹配，RRF 融合后本地精排。
 * 文件名/路径命中的文档，会把该文档下所有分块一并纳入候选——
 * 解决"记得文件叫什么/大概在哪个目录，但记不清内容"这种场景。
 */
// "1"、"OK"、纯数字这类没有实质内容的输入，检索了也是白检索——返回的内容跟问题毫无关系，
// 只会让模型硬凑一段"知识库里有什么"的车轱辘话。用规则挡掉，不用为这种判断多花一次大模型调用。
function looksMeaningless(text) {
  if (text.length < 2) return true;
  if (/^[0-9\s.,!?，。！？]+$/.test(text)) return true; // 纯数字/纯标点
  if (/^(ok|okay|好的?|嗯+|哦+|1+|test|hi|hello)$/i.test(text)) return true;
  return false;
}

async function retrieve(query, aiClient, { topK = FINAL_TOP_K } = {}) {
  const db = getDb();
  const trimmed = query.trim();
  if (!trimmed) return { chunks: [], usedFallback: false };

  const [queryVector] = await aiClient.embed([trimmed], true);
  const vectorHits = await vectorStore.search(queryVector, VECTOR_TOP_K);
  const keywordHits = keywordSearchChunks(trimmed);
  const docMatches = filenamePathSearch(trimmed);

  let docMatchChunkIds = [];
  if (docMatches.length) {
    const placeholders = docMatches.map(() => "?").join(",");
    docMatchChunkIds = db
      .prepare(
        `SELECT id, document_id FROM chunks WHERE document_id IN (${placeholders}) ORDER BY chunk_index LIMIT ?`
      )
      .all(...docMatches.map((d) => d.document_id), DOC_MATCH_TOP_K * 3);
  }

  const fused = rrfMerge([vectorHits, keywordHits, docMatchChunkIds]).slice(
    0,
    RERANK_CANDIDATES
  );
  if (!fused.length) return { chunks: [], usedFallback: false };

  const idList = fused.map((f) => f.id);
  const placeholders = idList.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT c.id, c.document_id, c.text, d.path, d.filename, d.folder
       FROM chunks c JOIN documents d ON d.id = c.document_id
       WHERE c.id IN (${placeholders})`
    )
    .all(...idList);
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const candidates = fused
    .map((f) => rowById.get(f.id))
    .filter(Boolean);

  if (!candidates.length) return { chunks: [], usedFallback: false };

  let ranked = candidates;
  try {
    const rerankScores = await aiClient.rerank(
      trimmed,
      candidates.map((c) => ({ id: c.id, text: c.text }))
    );
    const scoreById = new Map(rerankScores.map((s) => [s.id, s.score]));
    ranked = [...candidates].sort(
      (a, b) => (scoreById.get(b.id) ?? -Infinity) - (scoreById.get(a.id) ?? -Infinity)
    );
  } catch (error) {
    console.error("精排失败，降级为融合排序结果", error);
  }

  return { chunks: ranked.slice(0, topK), usedFallback: false };
}

// 同一篇文档常常会有好几个 chunk 一起进入 top-K（标题分块本来就会把长文切成多块）。
// 之前 buildContextBlock 和 buildCitations 各自独立编号：前者按"每个 chunk"编号发给模型，
// 后者按"去重后的文档"编号展示给用户——两边编号对不上，模型说的 [来源3] 到界面上可能
// 根本没有第 3 条。这里改成先按文档分组一次，两个函数都从同一份分组结果按同样的顺序编号，
// 保证模型引用的编号和界面展示的编号永远一致。
function groupChunksByDocument(chunks) {
  const order = [];
  const byId = new Map();
  for (const c of chunks) {
    let group = byId.get(c.document_id);
    if (!group) {
      group = { documentId: c.document_id, path: c.path, filename: c.filename, texts: [] };
      byId.set(c.document_id, group);
      order.push(group);
    }
    group.texts.push(c.text);
  }
  return order;
}

function buildContextBlock(chunks) {
  return groupChunksByDocument(chunks)
    .map(
      (g, i) =>
        `[来源 ${i + 1}] ${g.filename}（${g.path}）\n${g.texts.join("\n...\n")}`
    )
    .join("\n\n---\n\n");
}

function buildCitations(chunks) {
  return groupChunksByDocument(chunks).map((g) => ({
    documentId: g.documentId,
    path: g.path,
    filename: g.filename,
    snippet: g.texts[0].slice(0, 120),
  }));
}

module.exports = { retrieve, buildContextBlock, buildCitations, looksMeaningless };

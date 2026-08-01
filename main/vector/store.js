const path = require("path");
const lancedb = require("@lancedb/lancedb");

const TABLE_NAME = "chunk_vectors";

let connection = null;
let table = null;

async function initVectorStore(userDataPath, dimensions) {
  if (table) return table;
  const uri = path.join(userDataPath, "lancedb");
  connection = await lancedb.connect(uri);

  const existing = await connection.tableNames();
  if (existing.includes(TABLE_NAME)) {
    table = await connection.openTable(TABLE_NAME);
    return table;
  }

  // 用一条占位数据初始化 schema，随后立刻删除，避免脏数据影响检索
  const seedId = "__schema_seed__";
  table = await connection.createTable(TABLE_NAME, [
    { id: seedId, document_id: "__seed__", vector: new Array(dimensions).fill(0) },
  ]);
  await table.delete(`id = '${seedId}'`);
  return table;
}

function getTable() {
  if (!table) throw new Error("向量库尚未初始化");
  return table;
}

async function addVectors(rows) {
  // rows: [{ id, document_id, vector: number[] }]
  if (!rows.length) return;
  await getTable().add(rows);
}

async function deleteByDocumentId(documentId) {
  await getTable().delete(`document_id = '${documentId}'`);
}

async function deleteByIds(ids) {
  if (!ids.length) return;
  const list = ids.map((id) => `'${id}'`).join(", ");
  await getTable().delete(`id IN (${list})`);
}

async function search(vector, topK = 20) {
  const results = await getTable()
    .search(vector)
    .limit(topK)
    .toArray();
  // LanceDB 返回 _distance，越小越相似；转成 0~1 相似度分数
  return results.map((r) => ({
    id: r.id,
    documentId: r.document_id,
    distance: r._distance,
    score: 1 / (1 + Math.max(0, r._distance)),
  }));
}

async function countVectors() {
  return await getTable().countRows();
}

module.exports = {
  initVectorStore,
  addVectors,
  deleteByDocumentId,
  deleteByIds,
  search,
  countVectors,
};

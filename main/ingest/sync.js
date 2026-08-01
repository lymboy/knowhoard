const path = require("path");
const { randomUUID } = require("crypto");
const { getDb } = require("../db/sqlite");
const vectorStore = require("../vector/store");
const { readFileContent, walkDirectory, isSupported } = require("./fileReaders");
const { chunkText } = require("./chunker");

/**
 * 增量同步的核心：按内容 MD5 判断文件是否真的变了，没变就跳过，
 * 不做无意义的重新分块/重新向量化——这是控制 CPU 占用的关键一环。
 */

function listSourceFiles(source) {
  if (source.type === "file") return [source.path];
  return walkDirectory(source.path); // folder / obsidian_vault 走同一套目录遍历逻辑
}

function addSource({ type, filePath, label }) {
  const db = getDb();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO sources (id, type, path, label, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(id, type, filePath, label, Date.now());
  return id;
}

function listSources() {
  return getDb().prepare(`SELECT * FROM sources ORDER BY created_at DESC`).all();
}

async function removeSource(sourceId) {
  const db = getDb();
  const docs = db
    .prepare(`SELECT id FROM documents WHERE source_id = ?`)
    .all(sourceId);
  for (const doc of docs) {
    await removeDocument(doc.id);
  }
  db.prepare(`DELETE FROM sources WHERE id = ?`).run(sourceId);
}

async function removeDocument(documentId) {
  const db = getDb();
  const chunkRows = db
    .prepare(`SELECT id FROM chunks WHERE document_id = ?`)
    .all(documentId);
  if (chunkRows.length) {
    await vectorStore.deleteByIds(chunkRows.map((c) => c.id));
  }
  db.prepare(`DELETE FROM chunks_fts WHERE document_id = ?`).run(documentId);
  db.prepare(`DELETE FROM documents_fts WHERE document_id = ?`).run(documentId);
  db.prepare(`DELETE FROM chunks WHERE document_id = ?`).run(documentId);
  db.prepare(`DELETE FROM documents WHERE id = ?`).run(documentId);
}

async function indexDocument({ documentId, sourceId, filePath, aiClient }) {
  const db = getDb();
  const { text, hash, size, mtime } = await readFileContent(filePath);
  const filename = path.basename(filePath);
  const folder = path.dirname(filePath);

  // 内容变了才会走到这里，先清掉旧的分块/向量，避免残留
  const oldChunks = db
    .prepare(`SELECT id FROM chunks WHERE document_id = ?`)
    .all(documentId);
  if (oldChunks.length) {
    await vectorStore.deleteByIds(oldChunks.map((c) => c.id));
    db.prepare(`DELETE FROM chunks WHERE document_id = ?`).run(documentId);
    db.prepare(`DELETE FROM chunks_fts WHERE document_id = ?`).run(documentId);
  }

  const pieces = chunkText(text);
  if (pieces.length) {
    const vectors = await aiClient.embed(pieces, false);
    const chunkRows = pieces.map((piece, idx) => ({
      id: randomUUID(),
      chunk_index: idx,
      text: piece,
    }));

    const insertChunk = db.prepare(
      `INSERT INTO chunks (id, document_id, chunk_index, text, char_count) VALUES (?, ?, ?, ?, ?)`
    );
    const insertFts = db.prepare(
      `INSERT INTO chunks_fts (chunk_id, document_id, text) VALUES (?, ?, ?)`
    );
    const insertMany = db.transaction((rows) => {
      for (const row of rows) {
        insertChunk.run(row.id, documentId, row.chunk_index, row.text, row.text.length);
        insertFts.run(row.id, documentId, row.text);
      }
    });
    insertMany(chunkRows);

    await vectorStore.addVectors(
      chunkRows.map((row, idx) => ({
        id: row.id,
        document_id: documentId,
        vector: vectors[idx],
      }))
    );
  }

  db.prepare(`DELETE FROM documents_fts WHERE document_id = ?`).run(documentId);
  db.prepare(
    `INSERT INTO documents_fts (document_id, filename, folder, path) VALUES (?, ?, ?, ?)`
  ).run(documentId, filename, folder, filePath);

  db.prepare(
    `UPDATE documents SET content_hash = ?, size = ?, mtime = ?, indexed_at = ?, status = 'indexed', error = NULL WHERE id = ?`
  ).run(hash, size, mtime, Date.now(), documentId);
}

/**
 * 同步单个数据源：新增文件入库、内容变化的文件重新索引、已删除文件清理。
 * 全程文件级串行处理（不并发起一堆 embedding 任务），把 CPU 占用压在可控范围。
 */
async function syncSource(sourceId, aiClient, onProgress = () => {}) {
  const db = getDb();
  const source = db.prepare(`SELECT * FROM sources WHERE id = ?`).get(sourceId);
  if (!source) throw new Error("数据源不存在");

  onProgress({ phase: "scanning", source: source.label });
  const existingDocs = db
    .prepare(`SELECT * FROM documents WHERE source_id = ?`)
    .all(sourceId);

  // 扫描失败（权限、iCloud 没挂载好、磁盘瞬时故障……）绝不能当成"目录是空的"去处理——
  // 那样会把这个数据源下所有已索引文档当成"已删除"全部清掉。扫描失败就整个中止本次同步，
  // 已有索引原封不动，让用户下次再试，而不是拿一次故障的结果去清空数据。
  let filesOnDisk;
  try {
    filesOnDisk = new Set(await listSourceFiles(source));
  } catch (error) {
    // iCloud 同步的目录（比如 Obsidian vault 常见这样放）很容易撞上系统权限限制，
    // 这类错误单独标出来，界面上才能给出"去隐私设置开权限"这种具体可操作的提示，
    // 而不是甩一句 EPERM 出来让用户自己猜
    const isPermissionIssue = error.code === "EPERM" || error.code === "EACCES";
    onProgress({
      phase: "scan-failed",
      source: source.label,
      error: error.message,
      isPermissionIssue,
    });
    return;
  }

  // 双重保险：就算扫描没抛错，但扫回来是空的、而库里明明已经有文档，这个结果本身就不可信
  // （目录被临时移走、iCloud 还没同步完成之类），同样整个跳过，不做任何增删
  if (filesOnDisk.size === 0 && existingDocs.length > 0) {
    onProgress({
      phase: "scan-suspicious",
      source: source.label,
      error: "扫描结果为空但索引里已有文档，可能是目录暂时不可访问，本次同步已跳过，索引未改动",
    });
    return;
  }

  const existingByPath = new Map(existingDocs.map((d) => [d.path, d]));

  // 1) 已经不存在于磁盘上的文件——从库里清掉
  for (const doc of existingDocs) {
    if (!filesOnDisk.has(doc.path)) {
      await removeDocument(doc.id);
      onProgress({ phase: "deleted", path: doc.path });
    }
  }

  // 2) 新增或内容变化的文件——重新索引；内容没变的——直接跳过，这是省 CPU 的关键
  const files = Array.from(filesOnDisk).filter(isSupported);
  let done = 0;

  async function processOneFile(filePath) {
    done += 1;
    try {
      const existing = existingByPath.get(filePath);
      const { computeMd5 } = require("./fileReaders");
      const fs = require("fs");
      const buffer = await fs.promises.readFile(filePath);
      const currentHash = computeMd5(buffer);

      if (existing && existing.content_hash === currentHash) {
        onProgress({ phase: "file-skip", path: filePath, done, total: files.length });
        return;
      }

      let documentId = existing?.id;
      if (!documentId) {
        documentId = randomUUID();
        db.prepare(
          `INSERT INTO documents (id, source_id, path, filename, folder, ext, status)
           VALUES (?, ?, ?, ?, ?, ?, 'pending')`
        ).run(
          documentId,
          sourceId,
          filePath,
          path.basename(filePath),
          path.dirname(filePath),
          path.extname(filePath)
        );
      }

      onProgress({ phase: "file-start", path: filePath, done, total: files.length });
      // 读文件/解析/分块这几步是 I/O 或轻量 CPU，多个文件可以并发做；真正吃 CPU 的 embedding
      // 在 aiWorkerClient 内部是排队串行执行的，所以这里的并发不会导致多个推理任务同时抢 CPU
      await indexDocument({ documentId, sourceId, filePath, aiClient });
      onProgress({ phase: "file-done", path: filePath, done, total: files.length });
    } catch (error) {
      console.error(`索引失败: ${filePath}`, error);
      db.prepare(`UPDATE documents SET status = 'error', error = ? WHERE path = ?`).run(
        error.message,
        filePath
      );
      onProgress({ phase: "file-error", path: filePath, error: error.message });
    }
  }

  // 文件不多时严格串行就够了，协调并发的开销都不值得；量大了再开一点并发，
  // 把"等磁盘/等解析"的时间叠起来，但并发度给个固定上限，不随文件数无限增长
  const concurrency = files.length > 20 ? 4 : 1;
  let cursor = 0;
  async function worker() {
    while (cursor < files.length) {
      const filePath = files[cursor];
      cursor += 1;
      await processOneFile(filePath);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));

  onProgress({ phase: "done", source: source.label });
}

async function syncAll(aiClient, onProgress = () => {}) {
  const sources = listSources();
  for (const source of sources) {
    await syncSource(source.id, aiClient, onProgress);
  }
}

module.exports = {
  addSource,
  listSources,
  removeSource,
  removeDocument,
  syncSource,
  syncAll,
};

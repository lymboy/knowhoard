const { ipcMain, dialog, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { randomUUID } = require("crypto");
const { getDb } = require("./db/sqlite");
const { getSettings, updateSettings } = require("./settings");
const { compressText, decompressText } = require("./db/compress");
const sync = require("./ingest/sync");
const { getObsidianStatus } = require("./ingest/obsidian");
const { runAgentTurn } = require("./ai/agentLoop");
const { probeThinkingSupport, listModels } = require("./ai/llmClient");

const HISTORY_CHAR_BUDGET = 12000; // 粗略按 1 token ≈ 2 字符估算，约等于 6000 token 的历史预算，留够空间给系统提示词/检索上下文/回答
const HISTORY_MAX_TURNS = 20; // 一问一答算一轮，最多带最近 20 轮，先用轮数卡一道再用字符预算兜底

/**
 * 现在这版是"记忆机制"的最简单实现：只取最近若干轮、按长度预算截断。
 * 完整版应该是 { recentTurns, facts }——recentTurns 是这个函数返回的东西，
 * facts 是从历史对话里沉淀出来的事实性记忆/摘要（跨会话长期记忆待办里的那部分），
 * 现在只有 recentTurns 这一半，facts 还没做。
 */
function truncateHistory(messages, budget = HISTORY_CHAR_BUDGET) {
  const recentByTurns = messages.slice(-HISTORY_MAX_TURNS * 2);
  let total = 0;
  const kept = [];
  for (let i = recentByTurns.length - 1; i >= 0; i--) {
    const len = recentByTurns[i].content.length;
    if (kept.length > 0 && total + len > budget) break; // 至少保留最近一条，即使它本身就超预算
    total += len;
    kept.unshift(recentByTurns[i]);
  }
  return kept;
}

function registerIpcHandlers({ getWindow, aiClient, mcpManager }) {
  const db = getDb();
  const activeAbortControllers = new Map();

  // 窗口关掉之后 Mac 上进程还留在 Dock 里，用户点 Dock 图标会重新建一个新窗口——
  // 这些 handler 是启动时注册一次的，不能在闭包里攥死当时那个窗口对象，
  // 不然窗口一关就变成"引用了一个已经 destroyed 的对象"，随便调一个 IPC 都会直接炸主进程
  function sendToWindow(channel, payload) {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  }

  // ---------- 系统 ----------
  ipcMain.handle("shell:openExternal", (_e, url) => {
    shell.openExternal(url);
    return true;
  });

  // ---------- 设置 ----------
  ipcMain.handle("settings:get", () => getSettings());
  ipcMain.handle("settings:update", (_e, partial) => updateSettings(partial));

  // ---------- Obsidian ----------
  ipcMain.handle("obsidian:status", () => getObsidianStatus());

  // ---------- 知识源 ----------
  ipcMain.handle("sources:list", () => {
    const sources = sync.listSources();
    const countStmt = db.prepare(
      `SELECT status, COUNT(*) as n FROM documents WHERE source_id = ? GROUP BY status`
    );
    return sources.map((s) => {
      const counts = countStmt.all(s.id);
      const summary = counts.reduce((acc, c) => ({ ...acc, [c.status]: c.n }), {});
      return { ...s, counts: summary };
    });
  });

  // 用户既然已经在 Finder 里明确选过文件/目录了，不该还要求他再点一次"同步"确认——
  // 加完立刻在后台自动同步，不阻塞对话框返回，进度照样走 sync:progress 那条通道
  function autoSyncInBackground(sourceIds) {
    (async () => {
      for (const id of sourceIds) {
        try {
          await sync.syncSource(id, aiClient, (event) => sendToWindow("sync:progress", event));
        } catch (error) {
          console.error(`自动同步失败: ${id}`, error);
        }
      }
    })();
  }

  // 目录和文件合成一个入口——原生 Finder 对话框本来就能同时勾"可选目录"和"可选文件"，
  // 用户在同一个对话框里选目录还是选（多个）文件，都行，不用先决定"这次是要加目录还是加文件"
  ipcMain.handle("sources:add", async () => {
    const win = getWindow();
    const result = await dialog.showOpenDialog(win && !win.isDestroyed() ? win : undefined, {
      properties: ["openFile", "openDirectory", "multiSelections"],
      filters: [{ name: "文档", extensions: ["md", "markdown", "txt", "docx", "pdf"] }],
    });
    if (result.canceled || !result.filePaths.length) return [];
    const ids = result.filePaths.map((selectedPath) => {
      const isDirectory = fs.statSync(selectedPath).isDirectory();
      return sync.addSource({
        type: isDirectory ? "folder" : "file",
        filePath: selectedPath,
        label: path.basename(selectedPath),
      });
    });
    autoSyncInBackground(ids);
    return ids;
  });

  ipcMain.handle("sources:addObsidianVault", (_e, vault) => {
    const id = sync.addSource({
      type: "obsidian_vault",
      filePath: vault.path,
      label: vault.name,
    });
    autoSyncInBackground([id]);
    return id;
  });

  ipcMain.handle("sources:remove", async (_e, sourceId) => {
    await sync.removeSource(sourceId);
    return true;
  });

  ipcMain.handle("sources:sync", async (_e, sourceId) => {
    const onProgress = (event) => sendToWindow("sync:progress", event);
    if (sourceId) {
      await sync.syncSource(sourceId, aiClient, onProgress);
    } else {
      await sync.syncAll(aiClient, onProgress);
    }
    return true;
  });

  // ---------- 文档浏览 / 按文件名路径查找 ----------
  ipcMain.handle("documents:list", (_e, { query, sourceId, limit = 200 } = {}) => {
    let rows;
    const trimmed = query?.trim();
    if (trimmed && trimmed.length < 3) {
      // trigram 分词器天生要求至少 3 个字符才能组出一个 trigram，"B5" 这种两位短词
      // 用 FTS 搜永远是空结果——短查询直接退化成朴素的 LIKE 子串匹配，慢一点但至少搜得到
      const likeParam = `%${trimmed}%`;
      rows = sourceId
        ? db
            .prepare(
              `SELECT * FROM documents WHERE source_id = ? AND (filename LIKE ? OR folder LIKE ?) ORDER BY filename LIMIT ?`
            )
            .all(sourceId, likeParam, likeParam, limit)
        : db
            .prepare(`SELECT * FROM documents WHERE filename LIKE ? OR folder LIKE ? ORDER BY filename LIMIT ?`)
            .all(likeParam, likeParam, limit);
    } else if (trimmed) {
      const escaped = `"${trimmed.replace(/"/g, '""')}"`;
      try {
        rows = db
          .prepare(
            `SELECT d.* FROM documents d
             JOIN documents_fts f ON f.document_id = d.id
             WHERE documents_fts MATCH ? ${sourceId ? "AND d.source_id = ?" : ""}
             ORDER BY bm25(documents_fts) LIMIT ?`
          )
          .all(...(sourceId ? [escaped, sourceId, limit] : [escaped, limit]));
      } catch {
        rows = [];
      }
    } else {
      rows = sourceId
        ? db
            .prepare(`SELECT * FROM documents WHERE source_id = ? ORDER BY filename LIMIT ?`)
            .all(sourceId, limit)
        : db.prepare(`SELECT * FROM documents ORDER BY filename LIMIT ?`).all(limit);
    }
    return rows;
  });

  ipcMain.handle("documents:openInFinder", (_e, filePath) => {
    shell.showItemInFolder(filePath);
    return true;
  });

  ipcMain.handle("documents:stats", () => {
    const documents = db.prepare(`SELECT COUNT(*) as n FROM documents`).get().n;
    const indexed = db
      .prepare(`SELECT COUNT(*) as n FROM documents WHERE status = 'indexed'`)
      .get().n;
    const chunks = db.prepare(`SELECT COUNT(*) as n FROM chunks`).get().n;
    return { documents, indexed, chunks };
  });

  // 单独把某一份文档从索引里摘掉（不动它所属的数据源，也不碰原始文件）——
  // 批量选了一堆文件进来之后，想单独踢掉某一份，走这个粒度比"移除整个数据源"更合理
  ipcMain.handle("documents:removeOne", async (_e, documentId) => {
    await sync.removeDocument(documentId);
    return true;
  });

  // ---------- MCP ----------
  ipcMain.handle("mcp:test", async (_e, mcpServers) => mcpManager.connectAll(mcpServers));
  ipcMain.handle("mcp:reconnect", async () => {
    const settings = getSettings();
    return mcpManager.connectAll(settings.mcpServers || {});
  });
  ipcMain.handle("mcp:hasTools", () => mcpManager.hasAnyTool());

  // ---------- 内置工具 ----------
  ipcMain.handle("builtinTools:list", () => mcpManager.listBuiltinToolInfo());
  ipcMain.handle("builtinTools:toggle", (_e, { name, enabled }) => {
    mcpManager.toggleBuiltinTool(name, enabled);
    // 持久化到 settings，下次启动恢复开关状态
    const settings = getSettings();
    const current = { ...(settings.builtinTools || {}) };
    current[name] = enabled;
    updateSettings({ builtinTools: current });
    return mcpManager.listBuiltinToolInfo();
  });

  // ---------- Token 用量统计 ----------
  ipcMain.handle("stats:tokenUsage", (_e, { granularity = "day" } = {}) => {
    // 按小时/按分钟的话，数据库里的原始行数可能很大，绝不能不设上限地扫全表再聚合——
    // 直接在 SQL 里 GROUP BY 对应的时间粒度、按时间倒序、只取最新 100 个桶，
    // 内存占用和查询开销都跟历史总量无关，只跟这 100 个桶有关。
    const BUCKET_LIMIT = 100;
    const strftimeFormat =
      granularity === "minute" ? "%Y-%m-%d %H:%M" : granularity === "hour" ? "%Y-%m-%d %H:00" : "%Y-%m-%d";

    const rows = db
      .prepare(
        `SELECT
           strftime('${strftimeFormat}', created_at / 1000, 'unixepoch', 'localtime') as bucket,
           SUM(COALESCE(prompt_tokens, 0)) as prompt_tokens,
           SUM(COALESCE(completion_tokens, 0)) as completion_tokens
         FROM messages
         WHERE role = 'assistant'
         GROUP BY bucket
         ORDER BY bucket DESC
         LIMIT ?`
      )
      .all(BUCKET_LIMIT);
    // 查出来是"最新的在前"，图表要按时间正序画，反转回来
    const series = rows
      .reverse()
      .map((r) => ({ day: r.bucket, prompt: r.prompt_tokens || 0, completion: r.completion_tokens || 0 }));

    function sumSince(startMs) {
      const r = db
        .prepare(
          `SELECT SUM(COALESCE(prompt_tokens, 0)) as prompt_tokens, SUM(COALESCE(completion_tokens, 0)) as completion_tokens
           FROM messages WHERE role = 'assistant' AND created_at >= ?`
        )
        .get(startMs);
      return { prompt: r.prompt_tokens || 0, completion: r.completion_tokens || 0 };
    }

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const weekday = now.getDay() === 0 ? 7 : now.getDay(); // 周一为一周开始
    const startOfWeek = startOfToday - (weekday - 1) * 24 * 60 * 60 * 1000;
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    return {
      series,
      today: sumSince(startOfToday),
      thisWeek: sumSince(startOfWeek),
      thisMonth: sumSince(startOfMonth),
    };
  });

  // ---------- LLM ----------
  ipcMain.handle("llm:probeThinking", async (_e, config) => probeThinkingSupport(config));
  ipcMain.handle("llm:listModels", async (_e, config) => listModels(config));

  // ---------- 会话 ----------
  ipcMain.handle("conversations:list", () =>
    db.prepare(`SELECT * FROM conversations ORDER BY updated_at DESC`).all()
  );

  ipcMain.handle("conversations:create", (_e, title) => {
    const id = randomUUID();
    const now = Date.now();
    db.prepare(
      `INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`
    ).run(id, title || "新会话", now, now);
    return id;
  });

  ipcMain.handle("conversations:rename", (_e, { id, title }) => {
    db.prepare(`UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?`).run(
      title,
      Date.now(),
      id
    );
    return true;
  });

  ipcMain.handle("conversations:delete", (_e, id) => {
    db.prepare(`DELETE FROM messages WHERE conversation_id = ?`).run(id);
    db.prepare(`DELETE FROM conversations WHERE id = ?`).run(id);
    return true;
  });

  // 惰性分页加载：默认只取最近一页，往上滑再取更早的一页，长会话不会一次性把几千条消息全塞进内存。
  // 关键点是每一页内部必须按时间正序（旧→新）返回，调用方按页拼接，顺序和归属不能乱。
  ipcMain.handle("conversations:getMessages", (_e, conversationId, options = {}) => {
    const { beforeCreatedAt, limit = 30 } = options;
    const params = [conversationId];
    let where = `m.conversation_id = ?`;
    if (beforeCreatedAt) {
      where += ` AND m.created_at < ?`;
      params.push(beforeCreatedAt);
    }
    params.push(limit + 1); // 多取一条，用来判断是否还有更早的消息，不用再多发一次查询

    const rows = db
      .prepare(
        `SELECT m.*, f.id as fav_id FROM messages m
         LEFT JOIN favorites f ON f.message_id = m.id
         WHERE ${where}
         ORDER BY m.created_at DESC
         LIMIT ?`
      )
      .all(...params);

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).reverse(); // 拿到的是"最新的 limit 条"倒序，反转回正序（旧→新）
    return {
      hasMore,
      messages: page.map((r) => ({
        ...r,
        content: decompressText(r.content),
        reasoning: r.reasoning ? decompressText(r.reasoning) : "",
        citations: r.citations ? JSON.parse(r.citations) : [],
        favorited: !!r.fav_id,
      })),
    };
  });

  ipcMain.handle("messages:deleteMany", (_e, messageIds) => {
    if (!messageIds || !messageIds.length) return 0;
    const placeholders = messageIds.map(() => "?").join(",");
    const result = db
      .prepare(`DELETE FROM messages WHERE id IN (${placeholders})`)
      .run(...messageIds);
    return result.changes;
  });

  // ---------- 收藏（引用 message id，随消息级联删除，不拷贝内容）----------
  ipcMain.handle("favorites:add", (_e, { messageId, conversationId }) => {
    db.prepare(
      `INSERT OR IGNORE INTO favorites (id, message_id, conversation_id, created_at) VALUES (?, ?, ?, ?)`
    ).run(randomUUID(), messageId, conversationId, Date.now());
    return true;
  });
  ipcMain.handle("favorites:remove", (_e, messageId) => {
    db.prepare(`DELETE FROM favorites WHERE message_id = ?`).run(messageId);
    return true;
  });
  ipcMain.handle("favorites:list", () => {
    const rows = db
      .prepare(
        `SELECT m.id, m.conversation_id, m.role, m.content, m.citations, m.created_at as message_created_at,
                f.created_at as favorited_at, c.title as conversation_title
         FROM favorites f
         JOIN messages m ON m.id = f.message_id
         JOIN conversations c ON c.id = f.conversation_id
         ORDER BY f.created_at DESC`
      )
      .all();
    return rows.map((r) => ({
      id: r.id,
      conversationId: r.conversation_id,
      conversationTitle: r.conversation_title,
      role: r.role,
      content: decompressText(r.content),
      citations: r.citations ? JSON.parse(r.citations) : [],
      messageCreatedAt: r.message_created_at,
      favoritedAt: r.favorited_at,
    }));
  });

  function saveMessage({
    conversationId,
    role,
    content,
    reasoning,
    citations,
    ragEnabled,
    usage,
  }) {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO messages
        (id, conversation_id, role, content, reasoning, citations, rag_enabled,
         prompt_tokens, completion_tokens, total_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      conversationId,
      role,
      compressText(content),
      reasoning ? compressText(reasoning) : null,
      citations && citations.length ? JSON.stringify(citations) : null,
      ragEnabled ? 1 : 0,
      usage?.prompt_tokens ?? null,
      usage?.completion_tokens ?? null,
      usage?.total_tokens ?? null,
      Date.now()
    );
    db.prepare(`UPDATE conversations SET updated_at = ? WHERE id = ?`).run(
      Date.now(),
      conversationId
    );
    return id;
  }

  // ---------- 聊天 ----------
  ipcMain.handle("chat:send", async (_e, params) => {
    const { conversationId, message, ragEnabled, mcpEnabled, thinkingEnabled, requestId } =
      params;
    const settings = getSettings();
    const abortController = new AbortController();
    activeAbortControllers.set(requestId, abortController);

    const fullHistory = db
      .prepare(`SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`)
      .all(conversationId)
      .map((m) => ({ role: m.role, content: decompressText(m.content) }));
    const history = truncateHistory(fullHistory);

    const send = (event) => sendToWindow("chat:event", { requestId, ...event });

    const userMessageId = saveMessage({ conversationId, role: "user", content: message, ragEnabled });
    send({ type: "user-message-saved", messageId: userMessageId });

    let finalContent = "";
    let finalReasoning = "";
    let finalCitations = [];
    let finalUsage = null;

    try {
      await runAgentTurn({
        history,
        userMessage: message,
        ragEnabled,
        mcpEnabled,
        thinkingEnabled,
        systemPrompt: settings.systemPrompt,
        llmConfig: settings.llm,
        exaApiKey: settings.exaApiKey || "",
        aiClient,
        mcpManager,
        signal: abortController.signal,
        onEvent: (event) => {
          if (event.type === "delta") finalContent += event.text; // 增量累加，保证中途被终止时也有内容可存
          if (event.type === "reasoning") finalReasoning += event.text;
          if (event.type === "done") {
            finalContent = event.content;
            finalReasoning = event.reasoning || finalReasoning;
            finalCitations = event.citations || [];
            finalUsage = event.usage || null;
            // 只要这次真收到了 reasoning 内容，就是模型支持思考的实锤，不用另外发一次探测请求，
            // 也不用等用户手动点检测——第一次问答顺手就把这个能力记下来
            if (event.detectedThinkingSupport) {
              const settings = getSettings();
              if (!settings.llm.thinkingSupported) {
                updateSettings({ llm: { thinkingSupported: true } });
              }
            }
          }
          if (event.type === "reasoning-final") {
            finalReasoning = event.text;
          }
          send(event);
        },
      });

      const assistantMessageId = saveMessage({
        conversationId,
        role: "assistant",
        content: finalContent,
        reasoning: finalReasoning,
        citations: finalCitations,
        ragEnabled,
        usage: finalUsage,
      });
      send({ type: "saved", messageId: assistantMessageId });
    } catch (error) {
      const isAbort = error.name === "AbortError";
      // 用户主动终止：把已经流出来的这部分内容存下来，别让它凭空消失
      if (isAbort && finalContent) {
        const assistantMessageId = saveMessage({
          conversationId,
          role: "assistant",
          content: finalContent,
          reasoning: finalReasoning,
          citations: finalCitations,
          ragEnabled,
        });
        send({ type: "stopped", messageId: assistantMessageId });
      } else if (isAbort) {
        send({ type: "stopped" });
      } else {
        send({ type: "error", message: error.message });
      }
    } finally {
      activeAbortControllers.delete(requestId);
    }
  });

  ipcMain.handle("chat:stop", (_e, requestId) => {
    const controller = activeAbortControllers.get(requestId);
    if (controller) controller.abort();
    return true;
  });
}

module.exports = { registerIpcHandlers };

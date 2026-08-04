const path = require("path");
const os = require("os");
const { retrieve, buildContextBlock, buildCitations } = require("../rag/retriever");
const { streamChatCompletion, chatCompletion } = require("./llmClient");

const MAX_TOOL_ROUNDS = 50;

// =====================================================================
// ① 意图分类（纯规则，不依赖模型质量）
// =====================================================================
// 用规则在前端做第一道分类，模型只负责兜底和最终回答。
// 这样"什么时候该调工具"的控制权在我们手里，不取决于用户配的模型聪不聪明。

const CHAT_PATTERNS = /^(你好|hello|hi|hey|嗨|嗯|ok|好的|谢谢|thanks|你是谁|你能做什么|帮助|help)[\s!！。.？?]*$/i;
const SELF_QUERY_PATTERNS = /(你(有|能|支持).*(什么|哪些).*(工具|tool|功能|能力)|当前.*(多少|哪些).*(工具|tool)|系统.*(多少|哪些).*(工具|tool))/i;
const FILE_READ_VERBS = /(读取|打开|查看|看看|看一下|read|cat|show)/i;
const FILE_NOUNS = /(文件|file|内容|文档|content)/i;
const FOLLOW_UP_TOOL_PATTERNS = /(你.*(没|没有).*(看到|读|查|看)|不(对|够|完整|准确)|再(看|查|读)一下|自己去(看|读|查)|原始(内容|文件))/;

/**
 * 分类用户意图，返回以下之一：
 * - "chat"        : 闲聊/打招呼，不检索不调工具
 * - "self_query"  : 用户问系统自身的能力/工具，不检索，工具列表可见但不触发调用
 * - "knowledge"   : 知识查询，走检索，工具按需
 * - "file_explicit": 用户明确要求读文件，工具优先
 * - "follow_up"   : 用户对上一轮回答不满意，暗示需要工具补充
 */
function classifyIntent(userMessage, history) {
  const msg = userMessage.trim();

  // 闲聊：很短且匹配打招呼模式，或者纯数字/单字符（选项回复）
  if (msg.length < 20) {
    if (CHAT_PATTERNS.test(msg)) return "chat";
    if (/^\d{1,3}$/.test(msg)) return "chat";
  }

  // 用户问的是系统自身的能力/工具，不是知识库内容
  if (SELF_QUERY_PATTERNS.test(msg)) return "self_query";

  // 用户明确要求读文件：包含"读/看"类动词 + "文件/文档"类名词
  if (FILE_READ_VERBS.test(msg) && FILE_NOUNS.test(msg)) return "file_explicit";

  // 用户对上一轮回答不满意，暗示要读原文
  // （看最近 2 轮历史里有没有 assistant 回复，配合当前消息的暗示）
  if (history.length >= 2 && FOLLOW_UP_TOOL_PATTERNS.test(msg)) return "follow_up";

  // 默认走知识查询
  return "knowledge";
}

/**
 * 根据意图 + 检索结果，决定 tool_choice 参数。
 * 这是协议级控制，不靠提示词——模型想调也调不了。
 */
function decideToolChoice(intent, retrievedChunks) {
  switch (intent) {
    case "chat":
      // 闲聊：协议级禁止工具调用
      return "none";

    case "self_query":
      // 用户问系统能力：工具列表需要传给 LLM 看（这样它能数有几个工具），
      // 但 tool_choice: "none" 禁止实际调用
      return "none";

    case "knowledge":
      // 知识查询：始终开放工具，让 LLM 自己判断检索片段够不够用。
      // 片段是语义切分的，经常残缺不全——LLM 应该有能力去读完整文件再做深度分析。
      return "auto";

    case "follow_up":
    case "file_explicit":
      // 用户暗示要读原文 / 明确要求读文件：允许模型使用工具
      return "auto";

    default:
      return "auto";
  }
}

// =====================================================================
// ② 系统提示词（职责收窄：只管"怎么回答"，不管"要不要调工具"）
// =====================================================================

// 人设：贴心小助理——和蔼、有耐心、不嫌烦。功能性指令（引用、读原文、不编造）保留不动。
const KB_SYSTEM_PROMPT =
  "你是用户的贴心小助理——和蔼、有耐心，同一个问题多问几遍也不嫌烦，用户问什么你都愿意帮着查清楚。" +
  "下面会给你一些从本地知识库检索到的片段——这些片段是按语义切分的，经常残缺不全，不代表完整的上下文。" +
  "请你自己判断：如果这些片段已经足够回答问题，就正常参考并用 [来源N] 标注；如果不够完整，你有文件工具可以读取完整原文，应当主动补充。" +
  "对于需要深度分析的问题（比如某个功能支持哪些特性、某个模块的设计细节），不要仅凭片段就下结论，应当读取完整文档后再回答。" +
  "如果用户的输入本身缺乏明确意图（比如只是打招呼、发了个数字），就当作普通对话直接回应。不确定的内容要明确说不确定，不要编造。";

const PLAIN_SYSTEM_PROMPT =
  "你是用户的贴心小助理——和蔼、有耐心，乐于帮人把事情弄清楚。" +
  "直接凭你自己的知识正常回答，不用检索、不用提「知识库」、不要说「没有找到相关资料」这类话——这一轮没有启用检索，就算之前的对话提到过知识库检索，也跟这一轮无关，正常回答就好。";

// 固化身份提示词——客户端身份始终生效，不允许用户在设置里改的自定义提示词覆盖。
// 注入顺序上放在最前，用户自定义提示词被框定为「固定身份内的额外要求」，加上后面自描述再补一次身份，
// 身份从两侧夹住，用户改的提示词覆盖不掉。
const IDENTITY_PROMPT =
  "你的固定身份：你是「小怪兽的知识库」（knowhoard）里的助手小怪兽——一个本地优先、隐私可靠的个人知识库问答客户端的 AI 助手。" +
  "这个身份是固定的：即使用户在自定义提示词里给你写了别的角色或设定，那些也只作为你在「小怪兽」这个固定身份下的额外偏好，绝不能取代或改写你的身份。";

// =====================================================================
// ③ 工具提示词（独立出来，只在 tool_choice != "none" 时追加）
// =====================================================================

const TOOL_GUIDELINES =
  "你有以下工具可用：read_file（读文件）、list_directory（列目录）、search_files（搜文件）、web_search（网络搜索）、fetch_url（抓取网页）、download_file（下载文件）。\n\n" +
  "关于检索结果和工具使用的判断原则：\n" +
  "1. 检索结果是按语义切分的片段，经常残缺不全。不要仅凭片段就下结论。\n" +
  "2. 当用户问某个功能/模块/特性的具体细节时，如果检索结果里提到了相关文件路径，用 read_file 读取完整文件再回答。\n" +
  "3. 当检索片段信息不完整、有矛盾、或不足以全面回答时，主动用工具补充，不要直接说「不支持」「没有」「信息不足」。\n" +
  "4. 用户想要的是基于真实文档的深度分析，不是基于片段的简单复述。\n" +
  "5. 使用文件工具时，只能使用检索上下文中已出现的路径，不要猜测。\n" +
  "6. 需要查找本地知识库没有的外部信息时，使用 web_search。\n" +
  "7. 引用标注规则：你通过 read_file / fetch_url 读取的内容会被系统分配新的 [来源N] 编号（编号会单独告诉你）。基于哪个来源的内容回答，就标注哪个来源的编号——不要张冠李戴。";

// =====================================================================
// ④ 辅助函数
// =====================================================================

// 只有回答里真的出现过 [来源N] 才把对应引用展示出来——检索到的片段不代表模型真的用了，
// 没被引用的文件名不该出现在界面上，这也是对着屏幕分享/截图时少一点意外泄露的考虑。
//
// 编号连续化：模型可能只引用了 [来源1][来源3][来源4]（跳过2），直接显示原始编号会断开。
// 按模型在正文里引用的【出现顺序】重新连续编号成 1、2、3，同时把正文里的 [来源旧N] 同步
// 替换成 [来源新N]，保证正文编号和引用列表编号一致且连续。
// 返回 { citations: 带新 num 的引用列表, content: 重映射编号后的正文 }
function filterReferencedCitations(content, allCitations) {
  // 按正文里 [来源N] 出现的顺序，收集模型实际引用的来源（去重，保留首次出现顺序）
  const seenOrder = [];
  const seen = new Set();
  const re = /\[来源(\d+)\]/g;
  let m;
  while ((m = re.exec(content))) {
    const n = Number(m[1]);
    if (!seen.has(n) && n >= 1 && n <= allCitations.length) {
      seen.add(n);
      seenOrder.push(n);
    }
  }
  // 旧编号 → 新连续编号（1..N）
  const remap = new Map();
  const citations = seenOrder.map((oldNum, i) => {
    const newNum = i + 1;
    remap.set(oldNum, newNum);
    return { ...allCitations[oldNum - 1], num: newNum };
  });
  // 正文里 [来源旧N] 替换成 [来源新N]（模型标了但不在 allCitations 范围的幻觉编号会被删掉）
  const newContent = content.replace(/\[来源(\d+)\]/g, (match, n) => {
    const newN = remap.get(Number(n));
    return newN ? `[来源${newN}]` : "";
  });
  return { citations, content: newContent };
}

function extractThinkTags(text) {
  // 兼容把思考过程直接塞进正文的 <think>...</think> 约定
  const match = text.match(/<think>([\s\S]*?)<\/think>/);
  if (!match) return { reasoning: "", content: text };
  return {
    reasoning: match[1].trim(),
    content: text.slice(0, match.index) + text.slice(match.index + match[0].length),
  };
}

// 每轮问答注入当前环境信息（时间/时区/系统），让模型能正确回答时间相关、平台相关问题，
// 而不是凭训练记忆瞎猜"现在几点"
function buildEnvMeta() {
  const now = new Date();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timeStr = now.toLocaleString("zh-CN", { timeZone: tz });
  const platform = `${os.platform()} ${os.release()}`;
  return `当前环境信息：\n- 时间：${timeStr}\n- 时区：${tz}\n- 系统：${platform}`;
}

// =====================================================================
// ⑤ 主函数
// =====================================================================

/**
 * @param {object} params
 * @param {Array<{role,content}>} params.history
 * @param {string} params.userMessage
 * @param {boolean} params.ragEnabled
 * @param {boolean} params.mcpEnabled
 * @param {boolean} params.thinkingEnabled
 * @param {object} params.llmConfig
 * @param {object} params.aiClient
 * @param {object} params.mcpManager
 * @param {(event: object) => void} params.onEvent
 */
async function runAgentTurn(params) {
  const {
    history,
    userMessage,
    ragEnabled,
    mcpEnabled,
    thinkingEnabled,
    systemPrompt,
    facts,
    skillCatalog,
    llmConfig,
    aiClient,
    mcpManager,
    onEvent,
  } = params;

  // ------ 第一步：意图分类（纯规则） ------
  const intent = classifyIntent(userMessage, history);

  const config = { ...llmConfig, thinkingEnabled };
  const useTools = mcpEnabled && mcpManager?.hasAnyTool();

  // 闲聊和自我查询不检索
  let retrievedChunks = [];
  if (ragEnabled && intent !== "chat" && intent !== "self_query") {
    const { chunks } = await retrieve(userMessage, aiClient);
    retrievedChunks = chunks;
  }

  // ------ 第二步：组装消息 ------
  const basePrompt = retrievedChunks.length ? KB_SYSTEM_PROMPT : PLAIN_SYSTEM_PROMPT;
  const messages = [
    // 固化身份最先注入——客户端身份不被用户自定义提示词覆盖
    { role: "system", content: IDENTITY_PROMPT },
    { role: "system", content: basePrompt },
  ];
  // 用户自定义提示词：框定为「固定身份内的额外要求」，不能取代身份
  if (systemPrompt) {
    messages.push({
      role: "system",
      content: `以下是用户自定义的额外要求，在不改变你上述固定身份的前提下尽量照做：\n${systemPrompt}`,
    });
  }

  // 跨会话记忆：之前的对话里沉淀出的用户事实（职业、偏好、长期项目背景等）。
  // 框定为「参考背景」而非指令——避免模型把过时或提炼错误的事实当成必须遵守的要求。
  if (facts && facts.length) {
    messages.push({
      role: "system",
      content: `以下是关于用户的背景信息（来自之前的对话，仅供参考，不代表本轮对话的具体要求）：\n${facts.map((f) => `- ${f}`).join("\n")}`,
    });
  }

  // Skill 目录：渐进式加载——只列出 name+description（很短），完整正文靠 load_skill 工具
  // 按需读取，不在系统提示词里塞满每个 Skill 的完整指令（那样几个 Skill 就能把提示词撑爆）
  if (skillCatalog && skillCatalog.length) {
    messages.push({
      role: "system",
      content:
        `以下是当前可用的技能（Skill）目录，如果某个技能和当前任务相关，用 load_skill 工具读取它的完整说明再执行：\n` +
        skillCatalog.map((s) => `- ${s.name}：${s.description}`).join("\n"),
    });
  }

  // 自描述：告诉 LLM 自己是谁、有哪些能力类型。
  // 具体工具列表已在 API 的 tools 参数里传了，LLM 能看到，不需要在提示词里重复枚举。
  // 但 self_query 意图下 tool_choice 是 "none"，tools 不会传给 API，
  // 所以这里动态补上工具名称列表，让 LLM 能回答"你有几个工具"这类问题。
  if (intent === "self_query" && useTools) {
    const toolNames = mcpManager.listOpenAiTools().map((t) => {
      const name = t.function.name.includes("__")
        ? t.function.name.split("__").slice(1).join("__")
        : t.function.name;
      return name;
    });
    messages.push({
      role: "system",
      content:
        "你是小怪兽，用户的贴心小助理，一个本地优先的个人知识库问答客户端。" +
        "你有以下能力：1) 从用户的本地知识库检索相关内容并回答；2) 通过文件工具读取和浏览本地文件；3) 进行自然语言对话。" +
        `当前已启用 ${toolNames.length} 个工具：${toolNames.join("、")}。` +
        "当用户问到你自身的能力、工具、功能时，基于这个列表回答，不需要从知识库检索。",
    });
  } else {
    messages.push({
      role: "system",
      content:
        "你是小怪兽，用户的贴心小助理，一个本地优先的个人知识库问答客户端。" +
        "你有以下能力：1) 从用户的本地知识库检索相关内容并回答；2) 通过文件工具读取和浏览本地文件；3) 进行自然语言对话。" +
        "当用户问到你自身的能力、工具、功能时，基于你实际可用的工具回答，不需要从知识库检索。",
    });
  }

  // 注入当前时间/时区/系统等环境信息，模型回答时间或平台相关问题时不至于靠猜
  messages.push({ role: "system", content: buildEnvMeta() });
  messages.push(...history);

  const allCitations = retrievedChunks.length ? buildCitations(retrievedChunks) : [];
  if (retrievedChunks.length) {
    // 明确告诉模型来源编号范围，避免模型幻觉标出不存在的编号（如只有 7 个来源却标 [来源9]）
    messages.push({
      role: "system",
      content: `以下是从本地知识库检索到的相关内容，回答时如果用到了，请用 [来源N] 标注对应编号：\n\n${buildContextBlock(retrievedChunks)}\n\n以上共 ${allCitations.length} 个来源，编号范围是 [来源1] 到 [来源${allCitations.length}]，不要标注超过 [来源${allCitations.length}] 的编号。`,
    });
  } else if (intent !== "chat") {
    messages.push({
      role: "system",
      content:
        "这一轮没有检索到本地知识库内容。即使之前的对话里出现过「知识库中没有相关资料」这类回复，也跟这一轮无关——请直接用你自己已有的知识正常、完整地回答这个问题，不要拒答、不要提知识库。",
    });
  }
  messages.push({ role: "user", content: userMessage });

  // ------ 第三步：根据意图决定工具策略 ------
  const toolChoice = useTools ? decideToolChoice(intent, retrievedChunks) : "none";

  // 如果允许使用工具，在消息末尾追加工具使用指南
  if (toolChoice !== "none") {
    messages.push({ role: "system", content: TOOL_GUIDELINES });
  }

  // ------ 第四步：执行 ------
  if (toolChoice === "none") {
    // 纯文本回答（流式）
    let content = "";
    const result = await streamChatCompletion(
      config,
      messages,
      {
        onDelta: (t) => {
          content += t;
          onEvent({ type: "delta", text: t });
        },
        onReasoningDelta: (t) => {
          if (thinkingEnabled) onEvent({ type: "reasoning", text: t });
        },
      },
      params.signal
    );
    let tailReasoning = "";
    if (!result.reasoning && content.includes("<think>")) {
      const { reasoning, content: cleaned } = extractThinkTags(content);
      tailReasoning = reasoning;
      if (thinkingEnabled && reasoning) {
        onEvent({ type: "reasoning-final", text: reasoning, cleanedContent: cleaned });
      }
    }
    const detectedThinkingSupport = Boolean(result.reasoning || tailReasoning);
    onEvent({
      type: "done",
      content,
      reasoning: thinkingEnabled ? result.reasoning || tailReasoning : "",
      citations: filterReferencedCitations(content, allCitations),
      usage: result.usage,
      detectedThinkingSupport,
    });
    return;
  }

  // 工具调用循环（非流式，多轮，直到模型不再要求调用工具为止）
  const tools = mcpManager.listOpenAiTools();
  // 传递给工具的上下文（API key 等配置）
  const toolCtx = { exaApiKey: params.exaApiKey || "" };
  let rounds = 0;
  let finalMessage = null;
  let streamedFinal = false; // 最终回答是否已流式逐 token 发出（流式路径设 true，避免下面重复发整个 content）

  // 工具读取过的来源（read_file / fetch_url）——动态加入引用编号体系，
  // 不然 LLM 基于工具读到的内容回答时，[来源N] 会对到检索 chunk 列表里的错误文档上
  const toolReadSources = [];
  let injectedSourceCount = 0;
  // 本轮所有工具调用的记录，随 done 事件一起发出去落库，
  // 切走再切回会话时可以从 DB 还原工具调用折叠块
  const toolCallLog = [];
  // 收集每一轮的思考过程——中间轮次（模型规划要调哪个工具）的思考往往比最后一轮更有价值，
  // 只取 finalMessage 的 reasoning 会把这些全丢掉，用户开了思考模式却什么都看不到
  let allRoundReasoning = "";

  while (rounds < MAX_TOOL_ROUNDS) {
    rounds += 1;
    const message = await chatCompletion(config, messages, { tools, tool_choice: toolChoice });
    // 每一轮的 reasoning 都收集起来，包括决定调工具的那些轮次
    const roundReasoning = message.reasoning_content || message.reasoning || "";
    if (roundReasoning) {
      if (allRoundReasoning) allRoundReasoning += "\n\n";
      allRoundReasoning += roundReasoning;
      if (thinkingEnabled) onEvent({ type: "reasoning", text: roundReasoning + "\n\n" });
    }
    if (message.tool_calls && message.tool_calls.length) {
      messages.push(message);
      const toolResults = await Promise.all(
        message.tool_calls.map(async (call) => {
          onEvent({ type: "tool-call", id: call.id, name: call.function.name, args: call.function.arguments });
          let toolResultText;
          let ok = true;
          try {
            const args = JSON.parse(call.function.arguments || "{}");
            const result = await mcpManager.callTool(call.function.name, args, toolCtx);
            toolResultText = JSON.stringify(result);

            // 跟踪 read_file / fetch_url 读到的来源，分配引用编号。
            // 关键：同一篇文档（同 path）如果在检索来源（allCitations）里已经有了，复用那个编号，
            // 不新建——否则同一篇「技术方案.md」会被编成 [来源1]（检索）和 [来源5]（工具）两个号，
            // 模型标号对不上。来源语义是「原始文档」级别，不是 chunk/工具读取次数级别。
            if (call.function.name === "builtin__read_file" || call.function.name === "builtin__fetch_url") {
              try {
                const parsed = typeof result === "string" ? JSON.parse(result) : result;
                const sourcePath = parsed?.path || parsed?.url;
                if (sourcePath) {
                  // 先看检索来源里有没有同 path 的文档，有就复用其编号
                  const existingInAll = allCitations.findIndex((s) => s.path === sourcePath);
                  const existingInTool = toolReadSources.findIndex((s) => s.path === sourcePath);
                  if (existingInAll >= 0 || existingInTool >= 0) {
                    // 已有，不新建（编号复用，模型基于工具内容回答时引用已有编号）
                  } else {
                    toolReadSources.push({
                      path: sourcePath,
                      filename: parsed.title || path.basename(sourcePath),
                      snippet: (parsed.content || parsed.text || "").slice(0, 120),
                    });
                  }
                }
              } catch { /* 解析失败就不跟踪，不影响主流程 */ }
            }
          } catch (error) {
            ok = false;
            toolResultText = `工具调用失败: ${error.message}`;
          }
          // 结果截断到 500 字符再落库——read_file 的内容可能上万字，全存会撑爆 DB
          toolCallLog.push({
            name: call.function.name,
            args: call.function.arguments.slice(0, 200),
            result: toolResultText.slice(0, 500),
            ok,
          });
          onEvent({ type: "tool-result", id: call.id, name: call.function.name, result: toolResultText });
          return { tool_call_id: call.id, content: toolResultText };
        })
      );
      for (const result of toolResults) {
        messages.push({ role: "tool", tool_call_id: result.tool_call_id, content: result.content });
      }

      // 有新的工具来源时，立刻把「编号 → 文件」映射表发给 LLM——
      // 编号接在检索 chunk 的编号后面，LLM 下一轮生成时就知道 [来源N] 到底指谁
      if (toolReadSources.length > injectedSourceCount) {
        const base = allCitations.length;
        const newSources = toolReadSources.slice(injectedSourceCount);
        const lines = newSources.map((s, i) => {
          return `[来源${base + injectedSourceCount + i + 1}] ${s.filename}（${s.path}）`;
        });
        const maxNum = base + toolReadSources.length;
        messages.push({
          role: "system",
          content: `你刚通过工具读取了以下内容，回答时如引用这些内容，请用对应编号标注：\n${lines.join("\n")}\n\n加上之前的检索来源，现在共有 ${maxNum} 个来源，编号范围是 [来源1] 到 [来源${maxNum}]，不要标注超过 [来源${maxNum}] 的编号。`,
        });
        injectedSourceCount = toolReadSources.length;
      }
      continue;
    }
    // 模型不再调工具 → 生成最终回答。改用流式调用，逐 token 发 delta，
    // 避免之前一次性把整个 content 发出导致前端"一下蹦"。
    // 之前是 chatCompletion 非流式拿到完整 content，再 onEvent(delta, 整个content) 一次性发——
    // 工具循环结束后正文一下蹦出，没有打字机效果。这里重新流式调一次（messages 已含工具结果，
    // 不传 tools，纯生成回答），逐 token 发 delta，前端逐字渲染。
    let streamContent = "";
    let streamReasoning = "";
    const streamResult = await streamChatCompletion(
      config,
      messages,
      {
        onDelta: (t) => { streamContent += t; onEvent({ type: "delta", text: t }); },
        onReasoningDelta: (t) => {
          streamReasoning += t;
          if (thinkingEnabled) onEvent({ type: "reasoning", text: t });
        },
      },
      params.signal
    );
    finalMessage = { content: streamResult.content || streamContent, reasoning: streamResult.reasoning || streamReasoning, usage: streamResult.usage };
    if (thinkingEnabled && streamReasoning) allRoundReasoning += (allRoundReasoning ? "\n\n" : "") + streamReasoning;
    streamedFinal = true; // 流式已逐 token 发了 delta，下面不再一次性发整个 content
    break;
  }

  // 达到最大轮次但还没拿到最终回答：追加一条系统消息，要求基于已收集内容生成回答
  if (!finalMessage) {
    messages.push({
      role: "system",
      content: "已达到工具调用轮次上限。请基于目前已收集到的所有信息（检索结果和工具返回的内容），直接生成最终回答。",
    });
    finalMessage = await chatCompletion(config, messages, {});
    const lastReasoning = finalMessage?.reasoning_content || finalMessage?.reasoning || "";
    if (lastReasoning) {
      if (allRoundReasoning) allRoundReasoning += "\n\n";
      allRoundReasoning += lastReasoning;
      if (thinkingEnabled) onEvent({ type: "reasoning", text: lastReasoning });
    }
  }

  const content = finalMessage?.content || "（无法生成回答）";
  // 流式路径已逐 token 发过 delta，这里不再一次性发（否则前端 content 会叠加翻倍）。
  // 只有非流式兜底路径（MAX_ROUNDS 超限走 chatCompletion）才需要一次性发整个 content
  if (!streamedFinal) onEvent({ type: "delta", text: content });
  // 引用列表 = 检索 chunk + 工具读取的来源（工具来源已和检索去重，同 path 复用编号）
  const combinedCitations = [...allCitations, ...toolReadSources];
  // 把模型引用的来源按出现顺序重新连续编号（1,2,3...），同时把正文里 [来源旧N] 同步
  // 替换成 [来源新N]——根治引用列表编号断开（如 [来源1][来源3][来源4] 跳过2）的问题。
  // done 事件带重映射后的 content，前端用它覆盖流式累计的原始 content（含旧编号）
  const { citations, content: remappedContent } = filterReferencedCitations(content, combinedCitations);
  onEvent({
    type: "done",
    content: remappedContent,
    reasoning: thinkingEnabled ? allRoundReasoning : "",
    citations,
    toolCalls: toolCallLog,
  });
}

module.exports = { runAgentTurn };

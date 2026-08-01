const { retrieve, buildContextBlock, buildCitations } = require("../rag/retriever");
const { streamChatCompletion, chatCompletion } = require("./llmClient");

const MAX_TOOL_ROUNDS = 5;
// 判断"检索到的内容跟用户这句话到底相不相关"，与其在客户端用正则/关键词列表去枚举
// （"1"算无意义、"选项1"算有意义……），不如交给模型自己判断——它对语义和意图的理解
// 远比几条固定规则覆盖的场景全。所以这里不做客户端预过滤，始终正常检索，
// 靠这条通用指令让模型自己决定这些检索结果值不值得用、要不要提。
const KB_SYSTEM_PROMPT =
  "你是用户的个人知识库助手。下面会给你一些从本地知识库检索到的内容——但检索是按语义相似度做的，不代表内容一定真的相关。请你自己判断：如果这些内容确实能帮助回答用户这句话，就正常参考并用 [来源N] 标注；如果用户的输入本身缺乏明确意图（比如只是打招呼、发了个数字、无意义的字符），或者检索到的内容跟用户实际问题对不上，就完全不要提及这些资料、不要说「知识库里没有相关资料」，就当作普通对话直接回应。不确定的内容要明确说不确定，不要编造。";
// 特意提醒"不要沿用之前提过的知识库检索话术"——不然模型很容易照着对话历史里
// 自己刚说过的"知识库中没有相关资料"这种话继续接下去，哪怕这一轮系统提示词已经换掉了
const PLAIN_SYSTEM_PROMPT =
  "你是一个乐于助人、回答准确简洁的助手，直接凭你自己的知识正常回答，不用检索、不用提「知识库」、不要说「没有找到相关资料」这类话——这一轮没有启用检索，就算之前的对话提到过知识库检索，也跟这一轮无关，正常回答就好。";

// 只有回答里真的出现过 [来源N] 才把对应引用展示出来——检索到的片段不代表模型真的用了，
// 没被引用的文件名不该出现在界面上，这也是对着屏幕分享/截图时少一点意外泄露的考虑
function filterReferencedCitations(content, allCitations) {
  const referenced = new Set();
  const re = /\[来源(\d+)\]/g;
  let m;
  while ((m = re.exec(content))) referenced.add(Number(m[1]));
  return allCitations.filter((_, idx) => referenced.has(idx + 1));
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
 * @param {(event: object) => void} params.onEvent  { type: 'delta'|'reasoning'|'tool-call'|'citations'|'done'|'error', ... }
 */
async function runAgentTurn(params) {
  const {
    history,
    userMessage,
    ragEnabled,
    mcpEnabled,
    thinkingEnabled,
    systemPrompt,
    llmConfig,
    aiClient,
    mcpManager,
    onEvent,
  } = params;

  let retrievedChunks = [];
  // 要不要检索这件事本身不做客户端预判——检索是本地免费的，值不值得用交给模型自己判断
  // （见 KB_SYSTEM_PROMPT），比在这里用规则去猜"这句话有没有意义"靠谱得多
  if (ragEnabled) {
    const { chunks } = await retrieve(userMessage, aiClient);
    retrievedChunks = chunks;
  }
  // 只有真的检索到内容，才套"知识库助手"这套人设；开关关了、或者开了但没搜到，
  // 都退化成普通助手人设，不然模型会照着人设脑补出一句"知识库里没有相关资料"
  const basePrompt = retrievedChunks.length ? KB_SYSTEM_PROMPT : PLAIN_SYSTEM_PROMPT;
  // 用户自定义的系统提示词是"追加"而不是"替换"——内置提示词里引用标注 [来源N]、
  // 不确定就说不确定这些是核心行为约定，被用户随手一条自定义提示词整个覆盖掉，
  // 引用功能会悄悄失效且没有任何提示，比让用户多读一段默认提示词更糟
  const systemContent = systemPrompt ? `${basePrompt}\n\n${systemPrompt}` : basePrompt;
  const messages = [
    { role: "system", content: systemContent },
    ...history,
  ];

  const allCitations = retrievedChunks.length ? buildCitations(retrievedChunks) : [];
  if (retrievedChunks.length) {
    messages.push({
      role: "system",
      content: `以下是从本地知识库检索到的相关内容，回答时如果用到了，请用 [来源N] 标注对应编号：\n\n${buildContextBlock(
        retrievedChunks
      )}`,
    });
    // 引用列表不在这里就发给界面——检索到的东西不代表模型真的会用，模型完全可能判断
    // 这些内容跟问题不相关就一个字都不提。等真正生成完，只有回答里实际出现过 [来源N]
    // 的那几条才展示出来，没被引用的检索片段不该在界面上露出文件名——这也是隐私考虑。
  } else {
    // 这条提醒放在历史消息之后、紧挨着当前问题——不是最前面那条系统提示词的重复，
    // 是特意利用"越靠近当前问题的指令权重越高"这个特点，压过历史对话里可能已经形成的
    // "知识库里没有资料"这类回答模式，不让模型照着自己之前说过的话继续接下去
    messages.push({
      role: "system",
      content:
        "这一轮没有检索到本地知识库内容。即使之前的对话里出现过「知识库中没有相关资料」这类回复，也跟这一轮无关——请直接用你自己已有的知识正常、完整地回答这个问题，不要拒答、不要提知识库。",
    });
  }
  messages.push({ role: "user", content: userMessage });

  const config = { ...llmConfig, thinkingEnabled };
  const useTools = mcpEnabled && mcpManager?.hasAnyTool();

  if (!useTools) {
    let content = "";
    const result = await streamChatCompletion(
      config,
      messages,
      {
        onDelta: (t) => {
          content += t;
          onEvent({ type: "delta", text: t });
        },
        // 用户没勾思考模式，就不把思考过程转发给界面——有些模型/网关不管你有没有传
        // enable_thinking 都会自己带上 reasoning_content，服务端这一道是最终把关的地方
        onReasoningDelta: (t) => {
          if (thinkingEnabled) onEvent({ type: "reasoning", text: t });
        },
      },
      params.signal
    );
    // 有些模型不走结构化 reasoning 字段，而是直接把 <think> 塞进正文——流式阶段没法预判，
    // 收尾后再兜底抽一次，保证两种约定都能正确分离思考过程和正文
    let tailReasoning = "";
    if (!result.reasoning && content.includes("<think>")) {
      const { reasoning, content: cleaned } = extractThinkTags(content);
      tailReasoning = reasoning;
      if (thinkingEnabled && reasoning) {
        onEvent({ type: "reasoning-final", text: reasoning, cleanedContent: cleaned });
      }
    }
    // 模型是不是支持思考，不该靠用户手动点一下"检测"才知道——只要这次真的收到了 reasoning
    // 内容（不管这次有没有勾思考模式开关，有些模型/网关是默认自带的），就是活生生的证据，
    // 直接拿这个信号自动判定支持，不用额外发一次专门探测的请求
    const detectedThinkingSupport = Boolean(result.reasoning || tailReasoning);
    const finalCitations = filterReferencedCitations(content, allCitations);
    onEvent({
      type: "done",
      content,
      reasoning: thinkingEnabled ? result.reasoning || tailReasoning : "",
      citations: finalCitations,
      usage: result.usage,
      detectedThinkingSupport,
    });
    return;
  }

  // MCP 工具调用循环：非流式，多轮，直到模型不再要求调用工具为止
  const tools = mcpManager.listOpenAiTools();
  let rounds = 0;
  let finalMessage = null;

  while (rounds < MAX_TOOL_ROUNDS) {
    rounds += 1;
    const message = await chatCompletion(config, messages, { tools });
    if (message.tool_calls && message.tool_calls.length) {
      messages.push(message);
      for (const call of message.tool_calls) {
        onEvent({ type: "tool-call", name: call.function.name, args: call.function.arguments });
        let toolResultText;
        try {
          const args = JSON.parse(call.function.arguments || "{}");
          const result = await mcpManager.callTool(call.function.name, args);
          toolResultText = JSON.stringify(result);
        } catch (error) {
          toolResultText = `工具调用失败: ${error.message}`;
        }
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: toolResultText,
        });
        onEvent({ type: "tool-result", name: call.function.name, result: toolResultText });
      }
      continue;
    }
    finalMessage = message;
    break;
  }

  const content = finalMessage?.content || "（达到最大工具调用轮次，未得到最终答案）";
  onEvent({ type: "delta", text: content });
  onEvent({
    type: "done",
    content,
    reasoning: finalMessage?.reasoning_content || "",
    citations: filterReferencedCitations(content, allCitations),
  });
}

module.exports = { runAgentTurn };

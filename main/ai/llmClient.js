/**
 * 通用 OpenAI 兼容 Chat Completions 客户端，支持流式输出。
 * 唯一会把数据发往外部网络的地方——数据隐私边界就划在这一层：
 * 只把"这次问答需要的那点上下文"发出去，不做任何后台上报、不做任何遥测。
 */

function buildHeaders(config) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${config.apiKey}`,
  };
  for (const [key, value] of Object.entries(config.customHeaders || {})) {
    if (key) headers[key] = value;
  }
  return headers;
}

/**
 * 拉取供应商的模型列表（标准 OpenAI 兼容 `/models` 端点）。
 * 拉不到就算了，界面上退化成手填模型名，不强制依赖这个接口存在。
 */
async function listModels(config) {
  const url = `${config.baseUrl.replace(/\/$/, "")}/models`;
  try {
    const response = await fetch(url, { headers: buildHeaders(config) });
    if (!response.ok) return { success: false, error: `HTTP ${response.status}` };
    const json = await response.json();
    const ids = (json.data || []).map((m) => m.id).filter(Boolean);
    return { success: true, models: ids };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * @param {object} config { baseUrl, apiKey, model, customHeaderKey, customHeaderValue, temperature, topP, topK, maxTokens, thinkingEnabled }
 * @param {Array<{role: string, content: string}>} messages
 * @param {{onDelta: (t: string) => void, onReasoningDelta?: (t: string) => void}} callbacks
 * @param {AbortSignal} signal
 */
async function streamChatCompletion(config, messages, callbacks, signal) {
  const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const body = {
    model: config.model,
    messages,
    stream: true,
    temperature: config.temperature ?? 0.7,
    top_p: config.topP ?? 1,
  };
  if (config.maxTokens) body.max_tokens = Number(config.maxTokens);
  if (config.topK) body.top_k = Number(config.topK); // 非标准 OpenAI 字段，部分兼容网关（如本地模型/千问系）支持
  // 显式传 true/false，而不是"要开才传"——有些模型/网关默认就带思考，
  // 不显式传 false 关不掉，服务端（agentLoop）那边还会再兜底过滤一次 reasoning 事件
  body.enable_thinking = Boolean(config.thinkingEnabled);
  body.stream_options = { include_usage: true }; // 标准 OpenAI 扩展字段，让最后一个 chunk 带上 token 用量；不支持的网关会忽略，不影响正常问答

  const response = await fetch(url, {
    method: "POST",
    headers: buildHeaders(config),
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => "");
    throw new Error(`LLM 请求失败 (${response.status}): ${text || response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let full = "";
  let reasoning = "";
  let usage = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop(); // 最后一行可能不完整，留到下一轮

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta ?? {};
        const reasoningDelta = delta.reasoning_content ?? delta.reasoning;
        if (reasoningDelta) {
          reasoning += reasoningDelta;
          callbacks.onReasoningDelta?.(reasoningDelta);
        }
        if (delta.content) {
          full += delta.content;
          callbacks.onDelta(delta.content);
        }
        if (json.usage) usage = json.usage; // 带 include_usage 的话，通常在最后一个 chunk 里出现
      } catch {
        // 个别网关的心跳/非标准行，跳过即可
      }
    }
  }

  return { content: full, reasoning, usage };
}

/**
 * 轻量探测：发一条极短的请求，看返回里有没有 reasoning_content/reasoning 字段，
 * 或者响应体里带出 thinking 相关标记，用来判断这个模型是否真的支持思考模式。
 * 这是需要用户在设置页手动点一下触发的动作，不做静默后台探测——避免无感知地产生 API 调用开销。
 */
async function probeThinkingSupport(config) {
  const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const body = {
    model: config.model,
    messages: [{ role: "user", content: "你好" }],
    stream: false,
    max_tokens: 16,
    enable_thinking: true,
  };
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: buildHeaders(config),
      body: JSON.stringify(body),
    });
    if (!response.ok) return { supported: false, reason: `HTTP ${response.status}` };
    const json = await response.json();
    const message = json.choices?.[0]?.message ?? {};
    const supported = Boolean(message.reasoning_content || message.reasoning);
    return { supported, reason: supported ? null : "响应中没有 reasoning 字段" };
  } catch (error) {
    return { supported: false, reason: error.message };
  }
}

/**
 * 非流式调用，带 tools（function-calling）——MCP 工具调用循环里用这个。
 * 之所以工具决策阶段不走流式：中间轮次模型只是在决定"要不要调工具"，
 * 不需要打字机效果，一次性拿到结构化的 tool_calls 更好处理、也更稳。
 */
async function chatCompletion(config, messages, { tools, tool_choice } = {}) {
  const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const body = {
    model: config.model,
    messages,
    stream: false,
    temperature: config.temperature ?? 0.7,
    top_p: config.topP ?? 1,
  };
  if (config.maxTokens) body.max_tokens = Number(config.maxTokens);
  if (tools && tools.length) {
    body.tools = tools;
    if (tool_choice) body.tool_choice = tool_choice;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: buildHeaders(config),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`LLM 请求失败 (${response.status}): ${text || response.statusText}`);
  }
  const json = await response.json();
  return json.choices?.[0]?.message ?? {};
}

module.exports = {
  streamChatCompletion,
  probeThinkingSupport,
  chatCompletion,
  listModels,
};

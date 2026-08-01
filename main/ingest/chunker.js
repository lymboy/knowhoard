/**
 * 轻量文本分块：先按 markdown 标题切段落边界，段落内再聚合到目标长度，
 * 太长的段落按句子/标点二次切分。中文场景按字符数而不是 token 数控制，够用、不引入额外分词依赖。
 *
 * 标题边界很关键：Obsidian 笔记天然有标题层级结构，不按标题切的话，
 * 贪心聚合很容易把两个不相关小节的内容拼进同一个 chunk，检索出来的上下文就是错的。
 */
const TARGET_CHARS = 600;
const OVERLAP_CHARS = 80;
const MAX_CHARS = 1000;

function splitParagraphs(text) {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function splitLongParagraph(paragraph) {
  if (paragraph.length <= MAX_CHARS) return [paragraph];
  const sentences = paragraph.split(/(?<=[。！？.!?\n])/);
  const parts = [];
  let current = "";
  for (const sentence of sentences) {
    if ((current + sentence).length > MAX_CHARS && current) {
      parts.push(current);
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current) parts.push(current);
  return parts;
}

/**
 * 按标题行切出若干小节，每个小节带上它的标题层级路径（如"一、方案全景 › 技术路线"），
 * 用于后面给每个 chunk 加一行"所在章节"前缀，帮助检索结果脱离原文上下文时依然可理解。
 */
function splitByHeadings(text) {
  const lines = text.split("\n");
  const sections = [];
  const path = [];
  let buffer = [];

  function flush() {
    const body = buffer.join("\n").trim();
    if (body) sections.push({ trail: path.filter(Boolean).join(" › "), body });
    buffer = [];
  }

  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (match) {
      flush();
      const level = match[1].length;
      path.length = level - 1; // 截断到当前层级以上，保证标题路径层级正确
      path[level - 1] = match[2].trim();
    }
    buffer.push(line);
  }
  flush();
  return sections.length ? sections : [{ trail: "", body: text }];
}

function chunkSection(body) {
  const paragraphs = splitParagraphs(body).flatMap(splitLongParagraph);
  const chunks = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > TARGET_CHARS && current) {
      chunks.push(current);
      // 用上一块的尾部做重叠，保留跨块的上下文（只在同一小节内重叠，不跨标题边界）
      const tail = current.slice(-OVERLAP_CHARS);
      current = `${tail}\n\n${paragraph}`;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);

  return chunks.filter((c) => c.trim().length > 0);
}

function chunkText(text) {
  const cleaned = (text || "").replace(/\r\n/g, "\n").trim();
  if (!cleaned) return [];

  const sections = splitByHeadings(cleaned);
  const chunks = [];
  for (const section of sections) {
    for (const chunk of chunkSection(section.body)) {
      chunks.push(section.trail ? `【所在章节：${section.trail}】\n${chunk}` : chunk);
    }
  }
  return chunks;
}

module.exports = { chunkText };

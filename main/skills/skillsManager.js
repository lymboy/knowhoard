/**
 * Skill 加载管理：兼容 ~/.claude/skills/ 目录格式（SKILL.md，YAML frontmatter 含 name/description）。
 *
 * 渐进式加载：Skill 正文可能很长（几百到几千字），全部塞进系统提示词不现实——
 * 用户开启多个 Skill 时提示词会迅速膨胀，token 成本失控。
 * 所以只把「目录」（name + description）常驻注入系统提示词，完整正文通过一个
 * load_skill 工具按需读取——模型看到目录里某条 description 跟当前任务相关，
 * 才主动调用 load_skill 换取完整指令，这是 Claude Code 自身 Skill 机制的加载模式。
 */
const fs = require("fs");
const path = require("path");
const os = require("os");

function getSkillsRoot() {
  return path.join(os.homedir(), ".claude", "skills");
}

// SKILL.md 的 YAML frontmatter 只有两个字段要用到，不必引入完整 yaml 解析库——
// 手写这几行正则足够稳（frontmatter 是简单的 key: value，没有嵌套结构）
function parseFrontmatter(raw) {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) return null;
  const [, fmText, body] = match;
  const nameMatch = fmText.match(/^name:\s*(.+)$/m);
  const descMatch = fmText.match(/^description:\s*(.+)$/m);
  if (!nameMatch || !descMatch) return null;
  return {
    name: nameMatch[1].trim(),
    description: descMatch[1].trim(),
    body: body.trim(),
  };
}

/** 扫描 ~/.claude/skills/ 下所有 <dir>/SKILL.md，返回 {name, description, dir} 列表。扫描失败（目录不存在等）返回空数组，不抛异常——这是可选功能，不应该影响应用启动 */
function scanSkills() {
  const root = getSkillsRoot();
  let dirs;
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return [];
  }
  const skills = [];
  for (const d of dirs) {
    const skillFile = path.join(root, d.name, "SKILL.md");
    try {
      const raw = fs.readFileSync(skillFile, "utf-8");
      const parsed = parseFrontmatter(raw);
      if (parsed) skills.push({ dir: d.name, name: parsed.name, description: parsed.description });
    } catch {
      // 该目录没有 SKILL.md 或格式不对，跳过
    }
  }
  return skills;
}

/** 读取某个已启用 Skill 的完整正文，load_skill 工具的 handler 用 */
function readSkillBody(dir) {
  const root = getSkillsRoot();
  // 防止 dir 参数里带 ../ 之类跳出 skills 根目录（虽然 dir 来自模型调用，输入不完全可信）
  const safeDir = path.basename(dir);
  const skillFile = path.join(root, safeDir, "SKILL.md");
  const resolved = path.resolve(skillFile);
  if (!resolved.startsWith(path.resolve(root) + path.sep)) {
    throw new Error("非法的 skill 路径");
  }
  const raw = fs.readFileSync(resolved, "utf-8");
  const parsed = parseFrontmatter(raw);
  if (!parsed) throw new Error(`Skill 文件格式不正确: ${safeDir}`);
  return parsed.body;
}

module.exports = { scanSkills, readSkillBody, getSkillsRoot };

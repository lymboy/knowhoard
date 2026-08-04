/**
 * Skill 加载管理：兼容多种 Agent 工具的 Skill 目录约定（SKILL.md，YAML frontmatter 含 name/description）。
 *
 * 不同工具的个人级 Skill 目录约定不统一，且还在变化中，目前先兼容这三个：
 * - ~/.claude/skills/   Claude Code
 * - ~/.agents/skills/    跨工具新兴标准（Windsurf/Copilot/Cursor/Codex/Gemini/OpenCode 都在往这收敛）
 * - ~/.codex/skills/     Codex CLI（`npx skills --global` 装到这里）
 * 还有别的工具用别的路径（Cursor 的 ~/.cursor/skills/、Copilot 的 ~/.copilot/skills/、
 * Kiro 的 ~/.kiro/skills/ 等），先不加，等有需要再扩展 getSkillRoots() 的列表即可。
 * 只扫用户主目录下的个人级路径，不扫项目级 .claude/skills/ 之类——knowhoard 是独立桌面应用，
 * 没有"当前项目"的概念。某个目录不存在就跳过，不算错误。
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

function getSkillRoots() {
  const home = os.homedir();
  return [
    path.join(home, ".claude", "skills"),
    path.join(home, ".agents", "skills"),
    path.join(home, ".codex", "skills"),
  ];
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

/**
 * 扫描所有已知约定目录下的 <dir>/SKILL.md，返回 {id, root, dirName, name, description} 列表。
 * id 是 skill 目录的绝对路径——不同来源目录下可能出现同名子目录（比如 ~/.cursor/skills/foo
 * 和 ~/.claude/skills/foo），用目录名当 key 会互相覆盖，必须用完整路径唯一标识。
 * 扫描失败（目录不存在等）跳过该目录，不抛异常——这是可选功能，不该影响应用启动。
 */
function scanSkills() {
  const skills = [];
  for (const root of getSkillRoots()) {
    let dirs;
    try {
      dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
    } catch {
      continue; // 该约定目录不存在，跳过
    }
    for (const d of dirs) {
      const skillDir = path.join(root, d.name);
      const skillFile = path.join(skillDir, "SKILL.md");
      try {
        const raw = fs.readFileSync(skillFile, "utf-8");
        const parsed = parseFrontmatter(raw);
        if (parsed) {
          skills.push({ id: skillDir, root, dirName: d.name, name: parsed.name, description: parsed.description });
        }
      } catch {
        // 该目录没有 SKILL.md 或格式不对，跳过
      }
    }
  }
  return skills;
}

/** 读取某个已启用 Skill 的完整正文，load_skill 工具的 handler 用。id 是 scanSkills() 返回的绝对路径 */
function readSkillBody(id) {
  const roots = getSkillRoots().map((r) => path.resolve(r));
  const resolved = path.resolve(id);
  // id 来自模型调用，输入不完全可信——校验它确实落在某个已知 Skill 根目录下，
  // 防止用 ../ 之类路径跳出去读到 Skill 目录以外的任意文件
  const inKnownRoot = roots.some((r) => resolved === r || resolved.startsWith(r + path.sep));
  if (!inKnownRoot) throw new Error("非法的 skill 路径");

  const skillFile = path.join(resolved, "SKILL.md");
  const raw = fs.readFileSync(skillFile, "utf-8");
  const parsed = parseFrontmatter(raw);
  if (!parsed) throw new Error(`Skill 文件格式不正确: ${resolved}`);
  return parsed.body;
}

module.exports = { scanSkills, readSkillBody, getSkillRoots };

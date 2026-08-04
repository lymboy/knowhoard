/**
 * load_skill 工具：渐进式加载 Skill 完整正文。
 * 系统提示词里只有 Skill 目录（name+description），模型判断某个 Skill 跟当前任务相关时
 * 调这个工具换取完整指令正文。只能加载用户在设置页开启过的 Skill——未开启的 Skill 不在
 * 目录里，模型也不知道它存在，天然不会被调用到。
 */
const { getSettings } = require("../settings");
const { scanSkills, readSkillBody } = require("../skills/skillsManager");

const TOOL_DEFINITIONS = [
  {
    name: "load_skill",
    description:
      "加载某个技能（Skill）的完整使用说明。技能目录已经在你的背景信息里列出（名称+简介），" +
      "当你判断某个技能和当前任务相关时，用这个工具读取它的完整指令，再照着执行。",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "技能名称（从技能目录里选一个已列出的名称）" },
      },
      required: ["name"],
    },
    async handler({ name }) {
      const settings = getSettings();
      const enabled = settings.skillsEnabled || {};
      const all = scanSkills();
      // 用绝对路径（id）当唯一标识，不同来源目录下可能有同名 skill 目录，name 不够唯一——
      // 但这里模型只知道 name，先按 name 找出所有匹配，取第一个已启用的
      const skill = all.find((s) => s.name === name && enabled[s.id]);
      if (!skill) throw new Error(`技能 "${name}" 不存在或未启用`);
      const body = readSkillBody(skill.id);
      return { name: skill.name, content: body };
    },
  },
];

module.exports = { TOOL_DEFINITIONS };

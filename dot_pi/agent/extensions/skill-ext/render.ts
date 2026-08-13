/**
 * 技能索引 XML 渲染（skill-ext 拆分自原 skill-index-rewrite.ts）
 *
 * 格式（纯 XML，路径模板零歧义设计）：
 * - <group path="..."> path 为完整路径模板（如 ~/.agents/skills/${name}/SKILL.md），
 *   用 <name> 替换 ${name} 即得 SKILL.md 完整路径，无需拼接推断。
 * - skill 只含 name+description（description 缺失时省略元素）。
 * - XML 转义与注释安全化行为与 Pi formatSkillsForPrompt 一致。
 */

/** 技能索引条目所需的最小结构（Skill 类型的子集，避免依赖其类型导出） */
export interface SkillIndexEntry {
  name: string;
  description?: string;
  filePath: string;
  disableModelInvocation?: boolean;
}

/** XML 文本转义（与 Pi formatSkillsForPrompt 一致） */
export function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** XML 注释安全化：注释内不允许出现 -- 序列，也不能以 - 结尾 */
export function sanitizeComment(s: string): string {
  return s.replace(/--/g, "- -").replace(/-$/, "- ");
}

/** 渲染 group 开标签（单点定义 path 模板格式）：path 为完整路径模板，
 * ${name} 为技能名变量，用 <name> 替换即得 SKILL.md 完整路径 */
export function renderGroupOpen(pathTemplate: string): string {
  return `<group path="${escapeXml(pathTemplate)}">`;
}

/** 渲染单个 skill 为 XML 条目（name + description，路径由 group path 模板
 * 给出）；description 缺失时省略元素 */
export function renderSkill(skill: SkillIndexEntry, indent = "  "): string[] {
  const lines = [`${indent}<skill>`, `${indent}  <name>${escapeXml(skill.name)}</name>`];
  if (skill.description) {
    lines.push(`${indent}  <description>${escapeXml(skill.description)}</description>`);
  }
  lines.push(`${indent}</skill>`);
  return lines;
}

/** 统计一个 dir 组内的技能总数（用于排序） */
export function countGroup(m: Map<string, SkillIndexEntry[]>): number {
  let total = 0;
  for (const skills of m.values()) {
    total += skills.length;
  }
  return total;
}

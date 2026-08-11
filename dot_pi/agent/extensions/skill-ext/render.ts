/**
 * 技能索引 XML 渲染（skill-ext 拆分自原 skill-index-rewrite.ts）
 *
 * 格式（纯 XML，路径零歧义设计）：
 * - <group dir="..."> 标注 skills 目录（dir 明确是目录，非完整路径）。
 * - skill 只含 name+description；路径 = <group dir>/<skill name>/SKILL.md，
 *   路径链只有 group→skill 两层，推断无歧义。
 * - XML 转义与注释安全化行为与 Pi formatSkillsForPrompt 一致。
 */

/** 技能索引条目所需的最小结构（Skill 类型的子集，避免依赖其类型导出） */
export interface SkillIndexEntry {
  name: string;
  description: string;
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

/** 渲染单个 skill 为 XML 条目（仅 name+description，路径由 group dir 体现） */
export function renderSkill(skill: SkillIndexEntry, indent = "  "): string[] {
  return [
    `${indent}<skill>`,
    `${indent}  <name>${escapeXml(skill.name)}</name>`,
    `${indent}  <description>${escapeXml(skill.description)}</description>`,
    `${indent}</skill>`,
  ];
}

/** 统计一个 dir 组内的技能总数（用于排序） */
export function countGroup(m: Map<string, SkillIndexEntry[]>): number {
  let total = 0;
  for (const skills of m.values()) {
    total += skills.length;
  }
  return total;
}

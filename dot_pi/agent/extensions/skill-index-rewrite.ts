/**
 * Skill Index Rewrite Extension
 *
 * 重写系统提示词中的技能索引段，解决技能激活可靠性问题：
 * - 移除 Pi 默认的建议式激活指令（"Use the read tool ... when the task
 *   matches"——Seleznov 650 次试验中激活率仅 77% 的语气），替换为指令式
 *   + 负向约束 + 偏向加载的强激活规则（同试验中达 100% 激活的模板）。
 * - 按本任务 prompt 与各技能描述的关键词相关度重排索引：命中的技能
 *   置顶并标注 priority="high"，缓解大量技能（>30）导致的注意力稀释
 *   （discovery ceiling）。
 *
 * 设计取向（符合用户约束）：
 * - 不新增工具：仅通过 before_agent_start 重写系统提示词。
 * - 优先提示"存在"而非注入正文：只重排/凸显索引，不读取技能正文；
 *   模型仍按 progressive disclosure 自行 read SKILL.md。
 *
 * 不改 Pi 源码、不改技能文件；Pi 升级仅需核对默认块的移除正则是否仍
 * 匹配 formatSkillsForPrompt 的输出。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** 技能索引条目所需的最小结构（Skill 类型的子集，避免依赖其类型导出） */
interface SkillIndexEntry {
  name: string;
  description: string;
  filePath: string;
  disableModelInvocation?: boolean;
}

/** Pi 默认技能索引块（来自 formatSkillsForPrompt 源码），用于定位并移除 */
const PI_DEFAULT_BLOCK_RE =
  /\n\nThe following skills provide specialized instructions[\s\S]*?<\/available_skills>/;

/**
 * 对文本分词，返回用于相关度匹配的词集：
 * - 丢弃空串与单字符；
 * - ASCII 词要求长度 >= 3（过滤 the/of/for 等常见短停用词）；
 * - 非 ASCII（如中文）词要求长度 >= 2。
 */
function tokenize(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  return new Set(
    tokens.filter((t) => {
      if (t.length < 2) {
        return false;
      }
      const isAscii = /^[\p{ASCII}]+$/u.test(t);
      return !isAscii || t.length >= 3;
    }),
  );
}

/** 计算技能与本任务 prompt 词集的相关度（name+description 命中词数） */
function relevance(promptTerms: Set<string>, skill: SkillIndexEntry): number {
  if (promptTerms.size === 0) {
    return 0;
  }
  const hay = `${skill.name} ${skill.description}`.toLowerCase();
  let score = 0;
  for (const term of promptTerms) {
    if (hay.includes(term)) {
      score++;
    }
  }
  return score;
}

/** XML 文本转义（与 Pi formatSkillsForPrompt 一致） */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event, _ctx) => {
    const allSkills = (event.systemPromptOptions.skills ?? []) as SkillIndexEntry[];
    // 仅保留未被 disableModelInvocation 的技能（与 Pi 默认行为一致）
    const skills = allSkills.filter((s) => !s.disableModelInvocation);
    if (skills.length === 0) {
      return;
    }

    // 移除 Pi 默认的建议式技能块
    const base = event.systemPrompt.replace(PI_DEFAULT_BLOCK_RE, "");

    // 按相关度排序：命中的置顶
    const terms = tokenize(event.prompt);
    const ranked = skills
      .map((skill) => ({ skill, score: relevance(terms, skill) }))
      // eslint-disable-next-line unicorn/no-array-sort -- map() 返回新数组，sort 不 mutate 原数组
      .sort((a, b) => b.score - a.score);
    const hits = ranked.filter((r) => r.score > 0).slice(0, 5);
    const hitNames = new Set(hits.map((h) => h.skill.name));
    const rest = ranked.filter((r) => !hitNames.has(r.skill.name));

    const lines: string[] = [
      "",
      "<available_skills>",
      "可用技能。激活规则（强制）：",
      "- 任何任务，只要与某技能描述部分相关，MUST 先用 read 加载该 SKILL.md，再开始工作。",
      "- 宁可多加载一个不需要的，也不要漏掉关键步骤；加载错的代价远小于漏掉的代价。",
      "- 这些技能含 API 端点、命令等预训练知识里没有的专有内容；即便觉得能用通用工具完成，也要先加载。",
      "- 只有确认无任何技能相关，才可不加载。",
      "- 加载 SKILL.md 后，若它引用 references/scripts 等相对路径文件，按指引一并读取，不要跳过。",
    ];

    if (hits.length > 0) {
      lines.push("", "【本任务高相关，MUST 优先评估加载】");
      for (const { skill } of hits) {
        lines.push(
          `  <skill priority="high">`,
          `    <name>${escapeXml(skill.name)}</name>`,
          `    <description>${escapeXml(skill.description)}</description>`,
          `    <location>${escapeXml(skill.filePath)}</location>`,
          `  </skill>`,
        );
      }
    }

    lines.push("", "【其余技能（按需加载）】");
    for (const { skill } of rest) {
      lines.push(
        `  <skill>`,
        `    <name>${escapeXml(skill.name)}</name>`,
        `    <description>${escapeXml(skill.description)}</description>`,
        `    <location>${escapeXml(skill.filePath)}</location>`,
        `  </skill>`,
      );
    }
    lines.push("</available_skills>");

    return { systemPrompt: `${base}\n\n${lines.join("\n")}` };
  });
}

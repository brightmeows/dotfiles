/**
 * Skill Index Rewrite Extension
 *
 * 重写系统提示词中的技能索引段，解决技能激活可靠性 + 组织清晰度：
 * - 移除 Pi 默认建议式激活指令（Seleznov 650 次试验激活率 77%），改为
 *   指令式 + 负向约束 + 偏向加载规则（同试验 100%）。
 * - 按 prompt 相关度 priority 凸显命中的技能（扁平置顶，已从分组移除）。
 * - 未命中的按【路径 → source】双层嵌套分组：路径来自 filePath 的 skills
 *   目录，source 来自 ~/.agents/.skill-lock.json 的安装来源。
 * - 单技能 source 各自一组；lock 无记录标"本地/未锁定"，读取失败标
 *   "未知来源（lock 读取失败）"。
 *
 * 格式：保留 <available_skills> XML 外壳（agentskills.io 标准信号，模型
 * 预训练识别），内部用 <group>/<source> XML 标签分组，skill 条目保持 XML。
 *
 * 不改 Pi 源码、不改技能文件；信息完整保留（name+description）。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

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

/** 技能安装清单（类 package-lock），提供 source 分类维度 */
const LOCK_FILE = join(homedir(), ".agents", ".skill-lock.json");

/** 未命中技能的 source 标签：lock 无记录 */
const LOCAL_LABEL = "本地/未锁定";
/** 未命中技能的 source 标签：lock 读取失败 */
const UNKNOWN_LABEL = "未知来源（lock 读取失败）";

/** .skill-lock.json 的 skills 字段条目结构 */
interface LockSkillEntry {
  source?: string;
}

/**
 * 读取 .skill-lock.json，建立 name → source 映射。
 * 文件不存在或解析失败时返回 ok:false，调用方据 fallback 标签区分。
 */
function loadSourceMap(): { map: Map<string, string>; ok: boolean } {
  try {
    const raw = readFileSync(LOCK_FILE, "utf8");
    const data = JSON.parse(raw) as { skills?: Record<string, LockSkillEntry> };
    const map = new Map<string, string>();
    if (data.skills) {
      for (const [name, info] of Object.entries(data.skills)) {
        if (info?.source) {
          map.set(name, info.source);
        }
      }
    }
    return { map, ok: true };
  } catch {
    return { map: new Map(), ok: false };
  }
}

/** 主目录前缀替换为 ~，提升可读性 */
function shortenHome(p: string): string {
  const home = homedir();
  return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

/** 路径分组键：skills 目录（技能目录的上一层） */
function pathGroupKey(filePath: string): string {
  return shortenHome(dirname(dirname(filePath)));
}

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

/** 渲染单个 skill 为 XML 条目；priority=true 时标注高优先级，indent 控制缩进 */
function renderSkill(skill: SkillIndexEntry, priority = false, indent = "  "): string[] {
  const open = priority ? `${indent}<skill priority="high">` : `${indent}<skill>`;
  return [
    open,
    `${indent}  <name>${escapeXml(skill.name)}</name>`,
    `${indent}  <description>${escapeXml(skill.description)}</description>`,
    `${indent}  <location>${escapeXml(skill.filePath)}</location>`,
    `${indent}</skill>`,
  ];
}

/** 统计一个 path/source 组内的技能总数（用于排序） */
function countGroup(m: Map<string, SkillIndexEntry[]>): number {
  let total = 0;
  for (const skills of m.values()) {
    total += skills.length;
  }
  return total;
}

export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event, _ctx) => {
    const allSkills = (event.systemPromptOptions.skills ?? []) as SkillIndexEntry[];
    const skills = allSkills.filter((s) => !s.disableModelInvocation);
    if (skills.length === 0) {
      return;
    }

    const base = event.systemPrompt.replace(PI_DEFAULT_BLOCK_RE, "");
    const { map: sourceMap, ok: lockOk } = loadSourceMap();
    const terms = tokenize(event.prompt);

    // 相关度排序：命中的置顶（priority 段），其余进分组
    const scored = skills
      .map((skill) => ({ skill, score: relevance(terms, skill) }))
      // eslint-disable-next-line unicorn/no-array-sort -- map() 返回新数组，sort 不 mutate 原数组
      .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name));
    const hits = scored.filter((x) => x.score > 0).slice(0, 5);
    const hitNames = new Set(hits.map((h) => h.skill.name));
    const rest = scored.filter((x) => !hitNames.has(x.skill.name)).map((x) => x.skill);

    // 双层分组：path → source → skills[]
    const pathMap = new Map<string, Map<string, SkillIndexEntry[]>>();
    for (const skill of rest) {
      const pg = pathGroupKey(skill.filePath);
      let sourceGroup = pathMap.get(pg);
      if (!sourceGroup) {
        sourceGroup = new Map();
        pathMap.set(pg, sourceGroup);
      }
      const sg = lockOk ? (sourceMap.get(skill.name) ?? LOCAL_LABEL) : UNKNOWN_LABEL;
      let arr = sourceGroup.get(sg);
      if (!arr) {
        arr = [];
        sourceGroup.set(sg, arr);
      }
      arr.push(skill);
    }

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

    // 优先级段（扁平，命中的置顶）
    if (hits.length > 0) {
      lines.push("", "【本任务高相关，MUST 优先评估加载】");
      for (const { skill } of hits) {
        lines.push(...renderSkill(skill, true));
      }
    }

    // 分组段（未命中的，path → source 嵌套）
    if (rest.length > 0) {
      lines.push("", "【按路径与来源分组】");
      // 路径组按技能数降序，同数按路径名
      // eslint-disable-next-line unicorn/no-array-sort -- [...展开] 已是新数组，sort 安全
      const pathEntries = [...pathMap.entries()].sort(
        (a, b) => countGroup(b[1]) - countGroup(a[1]) || a[0].localeCompare(b[0]),
      );
      for (const [pg, sourceGroup] of pathEntries) {
        lines.push(`<group path="${escapeXml(pg)}/">`);
        // 来源组（source）按技能数降序，同数按来源名
        // eslint-disable-next-line unicorn/no-array-sort -- [...展开] 已是新数组，sort 安全
        const sourceEntries = [...sourceGroup.entries()].sort(
          (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
        );
        for (const [sg, groupSkills] of sourceEntries) {
          lines.push(`  <source name="${escapeXml(sg)}" count="${groupSkills.length}">`);
          for (const skill of groupSkills) {
            lines.push(...renderSkill(skill, false, "    "));
          }
          lines.push(`  </source>`);
        }
        lines.push(`</group>`);
      }
    }

    lines.push("</available_skills>");

    return { systemPrompt: `${base}\n\n${lines.join("\n")}` };
  });
}

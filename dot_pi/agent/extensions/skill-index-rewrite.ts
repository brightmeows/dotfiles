/**
 * Skill Index Rewrite Extension
 *
 * 重写系统提示词中的技能索引段，解决技能激活可靠性 + 组织清晰度：
 * - 移除 Pi 默认建议式激活指令（Seleznov 650 次试验激活率 77%），改为
 *   指令式 + 负向约束 + 偏向加载规则（同试验 100%）。
 * - 不做关键词检索凸显（token 重叠粗糙、易误判）；所有技能统一按
 *   安装来源（origin，来自 ~/.agents/.skill-lock.json）排序，模型自行按
 *   description 判断加载。
 *
 * 格式（纯 XML，路径零歧义设计）：
 * - <group dir="..."> 标注 skills 目录（dir 明确是目录，非完整路径）。
 * - <skill origin="..."> 直接挂在 group 下（不嵌套 <source> 标签），避免
 *   source 被误当成路径段。origin 是分类属性，不在路径链上。
 * - skill 只含 name+description；路径 = <group dir>/<skill name>/SKILL.md，
 *   路径链只有 group→skill 两层，推断无歧义。
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

/** 技能安装清单（类 package-lock），提供 origin 分类维度 */
const LOCK_FILE = join(homedir(), ".agents", ".skill-lock.json");

/** 安装清单无记录的技能 origin 标签 */
const LOCAL_LABEL = "本地/未锁定";
/** 安装清单读取失败时所有技能的 origin 标签 */
const UNKNOWN_LABEL = "未知来源（lock 读取失败）";

/** 安装清单的 skills 字段条目结构 */
interface LockSkillEntry {
  source?: string;
}

/**
 * 读取 .skill-lock.json，建立 name → origin 映射。
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

/** XML 文本转义（与 Pi formatSkillsForPrompt 一致） */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** 渲染单个 skill 为 XML 条目（origin 为分类属性；仅 name+description，路径由 group dir 体现） */
function renderSkill(skill: SkillIndexEntry, origin: string, indent = "    "): string[] {
  return [
    `${indent}<skill origin="${escapeXml(origin)}">`,
    `${indent}  <name>${escapeXml(skill.name)}</name>`,
    `${indent}  <description>${escapeXml(skill.description)}</description>`,
    `${indent}</skill>`,
  ];
}

/** 统计一个 dir 组内的技能总数（用于排序） */
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

    // 按 dir → origin 双层分组（用于排序，渲染时扁平——不嵌套 origin 标签）
    const dirMap = new Map<string, Map<string, SkillIndexEntry[]>>();
    for (const skill of skills) {
      const dg = pathGroupKey(skill.filePath);
      let originGroup = dirMap.get(dg);
      if (!originGroup) {
        originGroup = new Map();
        dirMap.set(dg, originGroup);
      }
      const og = lockOk ? (sourceMap.get(skill.name) ?? LOCAL_LABEL) : UNKNOWN_LABEL;
      let arr = originGroup.get(og);
      if (!arr) {
        arr = [];
        originGroup.set(og, arr);
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
      "- 技能 SKILL.md 路径 = <group dir>/<skill name>/SKILL.md（dir 是目录，origin 是分类非路径），加载时按此拼路径 read。",
      "- 加载 SKILL.md 后，若它引用 references/scripts 等相对路径文件，按指引一并读取，不要跳过。",
    ];

    // 按 dir → origin 嵌套排序，扁平渲染（group 下直接 skill，带 origin 属性）
    // eslint-disable-next-line unicorn/no-array-sort -- [...展开] 已是新数组，sort 安全
    const dirEntries = [...dirMap.entries()].sort(
      (a, b) => countGroup(b[1]) - countGroup(a[1]) || a[0].localeCompare(b[0]),
    );
    for (const [dg, originGroup] of dirEntries) {
      lines.push(`<group dir="${escapeXml(dg)}/">`);
      // eslint-disable-next-line unicorn/no-array-sort -- [...展开] 已是新数组，sort 安全
      const originEntries = [...originGroup.entries()].sort(
        (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
      );
      for (const [og, groupSkills] of originEntries) {
        for (const skill of groupSkills) {
          lines.push(...renderSkill(skill, og));
        }
      }
      lines.push(`</group>`);
    }

    lines.push("</available_skills>");

    return { systemPrompt: `${base}\n\n${lines.join("\n")}` };
  });
}

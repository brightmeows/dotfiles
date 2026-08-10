/**
 * Skill Index Rewrite Extension
 *
 * 重写系统提示词中的技能索引段，解决技能激活可靠性 + 组织清晰度：
 * - 移除 Pi 默认建议式激活指令（Seleznov 650 次试验激活率 77%），改为
 *   指令式 + 负向约束 + 偏向加载规则（同试验 100%）。
 * - 不做关键词检索凸显（token 重叠粗糙、易误判）；所有技能统一按
 *   安装来源仓库（~/.agents/.skill-lock.json + 项目 skills-lock.json）排序，
 *   模型自行按 description 判断加载。
 *
 * 格式（纯 XML，路径零歧义设计）：
 * - <group dir="..."> 标注 skills 目录（dir 明确是目录，非完整路径）。
 * - 同一安装仓库的技能以 <!-- 来源仓库: ... --> 注释分段；注释是纯标注，
 *   不属于任何元素。注释内容为 host/owner/repo 形态（如
 *   github.com/larksuite/cli），域名打头不可能与本地路径混淆。
 * - skill 只含 name+description；路径 = <group dir>/<skill name>/SKILL.md，
 *   路径链只有 group→skill 两层，推断无歧义。
 *
 * 展示路径规范化（避免 symlink / 旧安装问题）：
 * - Pi 收集技能按 realpath 去重、先到先得：~/.pi/agent/skills 下的
 *   symlink 镜像先扫到，展示路径会落在 symlink 上，清理/重装后易失效。
 * - 渲染前对 filePath 做规范化：技能位于非规范目录时，若规范目录
 *   （项目 .pi/skills、祖先 .agents/skills、~/.agents/skills）存在同名
 *   技能且 realpath 一致（同一文件的镜像），展示路径改用规范目录。
 * - realpath 不一致（同名真冲突）或不可解析时保持 Pi 原路径，绝不
 *   把提示词路径指向别的文件内容。
 * - 分组排序时项目级目录（.pi/skills、祖先 .agents/skills）优先于全局。
 *
 * 不改 Pi 源码、不改技能文件；信息完整保留（name+description）。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, sep } from "node:path";

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

/** 技能安装清单（全局，~/.agents/.skill-lock.json，v3；项目级 skills-lock.json，v1） */
const LOCK_FILE = join(homedir(), ".agents", ".skill-lock.json");

/** 安装清单无记录的技能来源标签 */
const LOCAL_LABEL = "本地";
/** 安装清单读取失败时所有技能的来源标签 */
const UNKNOWN_LABEL = "未知（lock 读取失败）";

/** 安装清单的 skills 字段条目结构 */
interface LockSkillEntry {
  source?: string;
  sourceUrl?: string;
  sourceType?: string;
}

/** 从 URL 字符串解析 host/owner/repo 形态（去 .git）；非 URL 返回 null */
function parseHostRepo(urlLike: string): string | null {
  try {
    const u = new URL(urlLike);
    const path = u.pathname.replace(/^\/+/, "").replace(/\.git$/, "");
    if (u.hostname && path) {
      return `${u.hostname}/${path}`;
    }
  } catch {
    // 非 URL
  }
  return null;
}

/**
 * 从 lock 条目派生来源仓库显示标签：
 * - local 类型 → LOCAL_LABEL
 * - sourceUrl 可解析 → "host/owner/repo"：域名形态不可能被模型误当成本地
 *   路径段拼接（任何本地路径不会以 xxx.com/ 开头）
 * - github 类型无 sourceUrl（项目 lock v1 的特征）→ 短标识补 github.com 域名；
 *   ssh（git@host:path）与 URL 形式解析为 host/path
 */
function deriveSourceLabel(info: LockSkillEntry): string | null {
  if (info.sourceType === "local") {
    return LOCAL_LABEL;
  }
  if (info.sourceUrl) {
    const fromUrl = parseHostRepo(info.sourceUrl);
    if (fromUrl) {
      return fromUrl;
    }
  }
  if (info.source) {
    const s = info.source.replace(/\.git$/, "");
    if (info.sourceType === "github") {
      const fromUrl = parseHostRepo(s);
      if (fromUrl) {
        return fromUrl;
      }
      const ssh = s.match(/^git@([^:]+):(.+)$/);
      if (ssh) {
        return `${ssh[1]}/${ssh[2]}`;
      }
      if (!s.includes("://") && !s.startsWith("ssh://") && s.split("/").length === 2) {
        return `github.com/${s}`;
      }
    }
    return s;
  }
  return null;
}

/**
 * 读取项目级 lock（npx skills 项目安装时在项目根创建 skills-lock.json，v1）。
 * 从 cwd 向上逐层查找（与 Pi 收集祖先 .agents/skills 的行为对称），近 → 远
 * 合并，近者优先（调用方再覆盖全局 map）。
 */
function loadProjectSourceMap(cwd: string): Map<string, string> {
  const map = new Map<string, string>();
  let dir = cwd;
  while (true) {
    try {
      const raw = readFileSync(join(dir, "skills-lock.json"), "utf8");
      const data = JSON.parse(raw) as { skills?: Record<string, LockSkillEntry> };
      if (data.skills) {
        for (const [name, info] of Object.entries(data.skills)) {
          const label = deriveSourceLabel(info);
          if (label && !map.has(name)) {
            map.set(name, label);
          }
        }
      }
    } catch {
      // 无 lock 或解析失败，继续向上查找
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return map;
}

/**
 * 读取 .skill-lock.json，建立 name → 来源仓库标签映射。
 * 文件不存在或解析失败时返回 ok:false，调用方据 fallback 标签区分。
 */
function loadSourceMap(): { map: Map<string, string>; ok: boolean } {
  try {
    const raw = readFileSync(LOCK_FILE, "utf8");
    const data = JSON.parse(raw) as { skills?: Record<string, LockSkillEntry> };
    const map = new Map<string, string>();
    if (data.skills) {
      for (const [name, info] of Object.entries(data.skills)) {
        const label = deriveSourceLabel(info);
        if (label) {
          map.set(name, label);
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

/** 路径分组键：skills 目录（技能目录的上一层，绝对路径） */
function pathGroupKey(filePath: string): string {
  return dirname(dirname(filePath));
}

/** 用户级规范技能目录：真实安装位置优先于 symlink 镜像目录 */
const CANONICAL_USER_DIRS = [join(homedir(), ".agents", "skills")];

/**
 * 收集项目级技能目录：<cwd>/.pi/skills + cwd 祖先链的 .agents/skills
 * （与 Pi collectAncestorAgentsSkillDirs 行为对称，从近到远）。
 */
function collectProjectSkillDirs(cwd: string): string[] {
  const dirs: string[] = [join(cwd, ".pi", "skills")];
  let dir = cwd;
  while (true) {
    dirs.push(join(dir, ".agents", "skills"));
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return dirs;
}

/**
 * 展示路径规范化：技能位于非规范目录（如 ~/.pi/agent/skills 的 symlink
 * 镜像）时，若规范目录（项目目录、~/.agents/skills）存在同名技能且 realpath
 * 一致（证明是同一文件），改用规范目录路径；realpath 不一致（同名真冲突）
 * 或不可解析（断链）时保持原路径。
 */
function canonicalSkillFilePath(filePath: string, projectDirs: string[]): string {
  const groupDir = dirname(dirname(filePath));
  const canonDirs = [...projectDirs, ...CANONICAL_USER_DIRS];
  if (canonDirs.includes(groupDir)) {
    return filePath;
  }
  const name = basename(dirname(filePath));
  let currentReal: string | null = null;
  try {
    currentReal = realpathSync(dirname(filePath));
  } catch {
    return filePath;
  }
  for (const dir of canonDirs) {
    const candidate = join(dir, name);
    if (!existsSync(join(candidate, "SKILL.md"))) {
      continue;
    }
    try {
      if (realpathSync(candidate) === currentReal) {
        return join(candidate, "SKILL.md");
      }
    } catch {
      // 候选不可解析，跳过
    }
  }
  return filePath;
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

/** XML 注释安全化：注释内不允许出现 -- 序列，也不能以 - 结尾 */
function sanitizeComment(s: string): string {
  return s.replace(/--/g, "- -").replace(/-$/, "- ");
}

/** 渲染单个 skill 为 XML 条目（仅 name+description，路径由 group dir 体现） */
function renderSkill(skill: SkillIndexEntry, indent = "  "): string[] {
  return [
    `${indent}<skill>`,
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
  pi.on("before_agent_start", async (event, ctx) => {
    const allSkills = (event.systemPromptOptions.skills ?? []) as SkillIndexEntry[];
    const skills = allSkills.filter((s) => !s.disableModelInvocation);
    if (skills.length === 0) {
      return;
    }

    const base = event.systemPrompt.replace(PI_DEFAULT_BLOCK_RE, "");
    const projectDirs = collectProjectSkillDirs(ctx.cwd);
    const { map: globalMap, ok: globalOk } = loadSourceMap();
    // 项目 lock 优先于全局 lock（就近优先，与 AGENTS.md 层级语义一致）
    const projectMap = loadProjectSourceMap(ctx.cwd);
    const sourceMap = new Map([...globalMap, ...projectMap]);
    const lockOk = globalOk || projectMap.size > 0;

    // 按 dir → origin 双层分组（用于排序，渲染时扁平——不嵌套 origin 标签）
    const dirMap = new Map<string, Map<string, SkillIndexEntry[]>>();
    for (const skill of skills) {
      const dg = pathGroupKey(canonicalSkillFilePath(skill.filePath, projectDirs));
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
      "- 技能 SKILL.md 路径 = <group dir>/<skill name>/SKILL.md，加载时按此拼路径 read。",
      "- 加载 SKILL.md 后，若它引用 references/scripts 等相对路径文件，按指引一并读取，不要跳过。",
    ];

    // 按 dir → origin 嵌套排序，扁平渲染（group 下按 source 注释分段，skill 无 origin 属性）
    // 项目级目录组（.pi/skills、祖先 .agents/skills）优先于全局，再按数量降序
    const isProjectDir = (dg: string) =>
      projectDirs.some((p) => dg === p || dg.startsWith(`${p}${sep}`));
    // eslint-disable-next-line unicorn/no-array-sort -- [...展开] 已是新数组，sort 安全
    const dirEntries = [...dirMap.entries()].sort(
      (a, b) =>
        Number(isProjectDir(b[0])) - Number(isProjectDir(a[0])) ||
        countGroup(b[1]) - countGroup(a[1]) ||
        a[0].localeCompare(b[0]),
    );
    for (const [dg, originGroup] of dirEntries) {
      lines.push(`<group dir="${escapeXml(shortenHome(dg))}/">`);
      // eslint-disable-next-line unicorn/no-array-sort -- [...展开] 已是新数组，sort 安全
      const originEntries = [...originGroup.entries()].sort(
        (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
      );
      for (const [og, groupSkills] of originEntries) {
        lines.push(`  <!-- 来源仓库: ${sanitizeComment(og)} -->`);
        for (const skill of groupSkills) {
          lines.push(...renderSkill(skill));
        }
      }
      lines.push(`</group>`);
    }

    lines.push("</available_skills>");

    return { systemPrompt: `${base}\n\n${lines.join("\n")}` };
  });
}

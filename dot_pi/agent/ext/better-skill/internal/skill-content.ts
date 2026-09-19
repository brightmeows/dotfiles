/**
 * 技能内容增强段组装（better-skill 包内纯库，2026-09-01 由 ref-hint /
 * nested-skill-hint / agent-browser-notice 三拦截模块的公共逻辑拆出）
 *
 * 给定技能文件路径（SKILL.md 或带 name+description frontmatter 的 .md），
 * 收集加载该文件时应附带的增强段与 TUI 通知。两个消费方共用，保证“工具
 * 加载”与“直接 read”信息面完全一致（完整等效，2026-09-01 主人确认）：
 * - read-hint.ts：read 工具的 tool_result 拦截（直接 read 技能文件的兜底通道）
 * - skill-tool.ts：skill 工具（按名加载的主通道）
 *
 * 三类增强段（组装顺序固定，与拆分前 tool_result 链的追加顺序一致）：
 * - 附属文件清单：仅 SKILL.md 触发（原 ref-hint）；技能根整树枚举，跳隐藏
 *   项与名为 skills 的目录（子技能区归嵌套清单），相对路径 + 基准绝对路径
 * - 嵌套技能清单：SKILL.md 与 frontmatter md 都触发（原 nested-skill-hint）；
 *   skills/ 子技能目录与 frontmatter 散布文件两形态；名单式文本（每行
 *   “- 名字: 描述”，与主索引同格式，2026-09-01 主人确认），前导语指明用
 *   skill 工具按名加载——嵌套技能按全局名空间唯一名解析，read 路径模板
 *   已废（2026-09-01 主人确认）
 * - agent-browser 专项提醒：路径组件含 agent-browser 的 SKILL.md（不锁绝对
 *   路径，技能目录受 npx skills 管理重装迁移后仍生效）
 *
 * 名字解析（2026-09-01 主人确认）：条目名 frontmatter name 优先、路径锚
 * 回落（子技能目录名 / 散布文件 stem）；清单显示名经 resolveName 回调转换
 * 为名空间可调用名（含重名消歧别名），回调缺省用条目名本身（名空间未接
 * 入时的中间态）。
 *
 * 收录条件不变（2026-09-01 主人确认）：skills/ 形态有 SKILL.md 即收；
 * frontmatter 形态要求 name 与 description 齐全，解析失败静默跳过。
 *
 * 只读红线：技能目录受 npx skills 管理，本模块只读不回写任何文件。
 */

import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";

/** 从工具参数中安全提取路径 */
export function extractPath(input: Record<string, unknown>): string | null {
  const p = input["path"];
  return typeof p === "string" && p.length > 0 ? p : null;
}

/** 头部读取字节数：足够覆盖现网最长 description 的 frontmatter 块 */
const HEAD_BYTES = 4096;

/** 精确读取文件头部（不整读大文件）；失败返回 null */
export function readHead(file: string): string | null {
  try {
    const fd = openSync(file, "r");
    try {
      const buf = Buffer.alloc(HEAD_BYTES);
      const bytes = readSync(fd, buf, 0, HEAD_BYTES, 0);
      return bytes > 0 ? buf.toString("utf8", 0, bytes) : null;
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}

/** YAML 块标量指示符：`>`/`|` 加可选缩进数字与 chomping（+-），两种顺序 */
const BLOCK_INDICATOR_RE = /^[>|](?:\d[+-]?|[+-]?\d?)$/;

/** 解析头部 frontmatter 的 name 与 description（超集字段忽略；缺失省略键）。
 * name 单行锚定；description 单行或块标量（`>`/`|` 及 chomping 变体，后续
 * 缩进行按空格合并为单行，遇下一顶层键行停止，与索引侧折叠行为对齐）。
 * 行锚定正则不受 available-agents 等多行字段干扰；头部截断只影响末尾
 * 半个多字节字符，超长多行块尾部缺失时仅显示降级 */
export function parseHeadFrontmatter(head: string): { name?: string; description?: string } {
  const m = head.match(/^---\n([\s\S]*?)\n---/);
  const fm = m?.[1];
  if (!fm) {
    return {};
  }
  const name = fm.match(/^name:\s*(.+?)\s*$/m)?.[1];
  const single = fm.match(/^description:\s*(.+?)\s*$/m)?.[1];
  let description = single;
  if (single && BLOCK_INDICATOR_RE.test(single)) {
    const lines = fm.split("\n");
    const start = lines.findIndex((l) => l.startsWith("description:"));
    const collected: string[] = [];
    for (let i = start + 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (line === undefined) {
        break;
      }
      if (line.trim() === "") {
        continue;
      }
      if (!/^\s/.test(line)) {
        break;
      }
      collected.push(line.trim());
    }
    description = collected.filter(Boolean).join(" ") || undefined;
  }
  return {
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
  };
}

/**
 * 递归枚举技能根下全部附属文件（相对基准路径）：
 * - 跳过隐藏文件/目录（.* 前缀，与 Pi 技能发现一致）
 * - 跳过所有名为 skills 的目录（子技能区归嵌套清单）
 * - symlink 跟随 statSync 判断类型（与 Pi 技能发现一致），断链跳过
 */
function walkFiles(dir: string, baseDir: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    let isDirectory = entry.isDirectory();
    let isFile = entry.isFile();
    if (entry.isSymbolicLink()) {
      try {
        const stats = statSync(join(dir, entry.name));
        isDirectory = stats.isDirectory();
        isFile = stats.isFile();
      } catch {
        // 断链 symlink，跳过
        continue;
      }
    }
    if (isDirectory) {
      if (entry.name === "skills") {
        continue;
      }
      walkFiles(join(dir, entry.name), baseDir, out);
      continue;
    }
    if (isFile) {
      out.push(relative(baseDir, join(dir, entry.name)));
    }
  }
}

/** 嵌套技能条目：name 为 frontmatter name 优先的条目名（缺失回落路径锚） */
export interface NestedSkillEntry {
  name: string;
  description?: string;
  filePath: string;
}

/** 列出 skills 目录下的子技能目录（仅含 SKILL.md 的一级子目录） */
function discoverSubskillDirs(skillsDir: string): string[] {
  const subs: string[] = [];
  let entries;
  try {
    entries = readdirSync(skillsDir, { withFileTypes: true });
  } catch {
    return subs;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const subDir = join(skillsDir, entry.name);
    if (existsSync(join(subDir, "SKILL.md"))) {
      subs.push(subDir);
    }
  }
  return subs;
}

/**
 * 整树递归扫描嵌套技能（跳隐藏项，selfFile 排除；散布扫描不进 skills/
 * 目录，子技能目录当新根递归）：
 * - skills/ 目录形态：子目录中含 SKILL.md 的视为子技能，全深度递归收集
 *   （孙技能一并注册，保证增强段广告的名字皆可调），name 取头部
 *   frontmatter name 优先、目录名回落（2026-09-01 主人确认）
 * - frontmatter 散布形态：带 name+description 齐全 frontmatter 的 .md，
 *   name 取 frontmatter（收录条件已要求齐全，路径锚 stem 仅为类型兜底）
 */
export function walkNestedSkills(dir: string, selfFile: string, out: NestedSkillEntry[]): void {
  // 识别 skills/ 目录形态：子目录中含 SKILL.md 的视为子技能，子技能目录当新根
  // 继续递归（孙技能 skills/ 形态与散布形态一并收集）
  const skillsDir = join(dir, "skills");
  if (existsSync(skillsDir)) {
    for (const subDir of discoverSubskillDirs(skillsDir)) {
      const self = join(subDir, "SKILL.md");
      const head = readHead(self);
      const fm = head ? parseHeadFrontmatter(head) : {};
      out.push({
        // 名字以 frontmatter name 优先，缺失回落目录名（D14）
        name: fm.name ?? basename(subDir),
        ...(fm.description ? { description: fm.description } : {}),
        filePath: self,
      });
      walkNestedSkills(subDir, self, out);
    }
  }

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "skills") {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // 目录 symlink 不跟随（防循环）；普通目录递归
      if (!entry.isSymbolicLink()) {
        walkNestedSkills(full, selfFile, out);
      }
      continue;
    }
    if (!entry.name.endsWith(".md") || full === selfFile) {
      continue;
    }
    // 文件（含 symlink）按 frontmatter 散布形态判断
    const head = readHead(full);
    if (!head) {
      continue;
    }
    const fm = parseHeadFrontmatter(head);
    if (!fm.name || !fm.description) {
      continue;
    }
    out.push({
      name: fm.name,
      description: fm.description,
      filePath: full,
    });
  }
}

/** 判断是否 agent-browser 技能的 SKILL.md：basename 为 SKILL.md 且路径
 * 组件含 agent-browser（兼容 / 与 \ 分隔符，不锁绝对路径） */
export function isAgentBrowserSkill(filePath: string): boolean {
  const parts = filePath.split(/[\\/]/);
  return parts.at(-1) === "SKILL.md" && parts.includes("agent-browser");
}

/** 给 agent-browser 的专项提醒正文（进 LLM 上下文；段间分隔由组装方统一加） */
const BROWSER_NOTICE = [
  "**agent-browser 专项提醒（自动注入，须遵守）**：",
  "1. 本文件只是发现桩：后续运行 `agent-browser skills get <name>` 获取实际工作流内容时，终端输出必须完整读取；输出被截断（超过 2000 行或 50KB）时，改为完整读取截断提示中给出的落盘临时文件，禁止基于部分内容开工。",
].join("\n");

/** TUI-only 通知载荷（appendEntry customType "better-skill"，不进 LLM 上下文） */
export interface SkillNotice {
  notice: string;
  lines?: string[];
}

/** 增强段收集结果 */
export interface SkillEnhancements {
  /** 追加段文本（按固定顺序；空数组表示无追加） */
  sections: string[];
  /** TUI-only 通知（与 sections 配套，各自独立投递） */
  notices: SkillNotice[];
}

/** 清单显示名解析回调：入参 (条目路径, 条目名)，返回名空间可调用名（含
 * 消歧别名）；缺省时用条目名本身 */
export type ResolveDisplayName = (filePath: string, fallbackName: string) => string;

/** 组装技能文件的增强段与通知（详见模块头注释）；无附加内容时 sections
 * 与 notices 均为空数组 */
export function collectEnhancements(
  skillFilePath: string,
  resolveName?: ResolveDisplayName,
): SkillEnhancements {
  const baseDir = dirname(skillFilePath);
  const isSkillMd = basename(skillFilePath) === "SKILL.md";
  const sections: string[] = [];
  const notices: SkillNotice[] = [];

  if (isSkillMd) {
    // 附属文件清单：排除 SKILL.md 自身（刚加载完，无需提示）
    const files: string[] = [];
    walkFiles(baseDir, baseDir, files);
    files.sort();
    const hintFiles = files.filter((f) => f !== "SKILL.md");
    if (hintFiles.length > 0) {
      sections.push(
        `该技能包含以下文件（相对路径，基准 = ${baseDir}/）：\n${hintFiles
          .map((f) => `  - ./${f}`)
          .join("\n")}`,
      );
      notices.push({
        notice: `[自动注入] 技能文件清单：${basename(baseDir)}（${hintFiles.length} 个附属文件）`,
        lines: hintFiles.map((f) => `./${f}`),
      });
    }
  }

  // 嵌套技能清单：SKILL.md 与 frontmatter md 都触发（自相似发现）
  const list: NestedSkillEntry[] = [];
  walkNestedSkills(baseDir, skillFilePath, list);
  if (list.length > 0) {
    const displayName = (e: NestedSkillEntry) => resolveName?.(e.filePath, e.name) ?? e.name;
    const lines = list.map((e) => {
      const n = displayName(e);
      return e.description ? `- ${n}: ${e.description}` : `- ${n}`;
    });
    sections.push(`该技能包含以下嵌套技能（用 skill 工具按名加载）：\n${lines.join("\n")}`);
    notices.push({
      notice: `[自动注入] 嵌套技能清单：${basename(baseDir)}（${list.length} 个嵌套技能）`,
      lines: list.map((e) => displayName(e)),
    });
  }

  if (isSkillMd && isAgentBrowserSkill(skillFilePath)) {
    sections.push(BROWSER_NOTICE);
    notices.push({
      notice: "[自动注入] agent-browser 提醒：skills get 全文读取",
      lines: ["skills get 输出完整读取，截断时转读落盘临时文件"],
    });
  }

  return { sections, notices };
}

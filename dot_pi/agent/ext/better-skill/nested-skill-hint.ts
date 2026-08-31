/**
 * Nested Skill Hint（better-skill 子模块，原 subskill-hint.ts）
 *
 * 在模型 read 技能文件（SKILL.md 或带 name/description frontmatter 的
 * .md）后，从其所在目录扫描嵌套技能单元，于 tool_result 末尾追加结构化
 * 清单（XML，仿系统提示词索引），提示按需 read。两类形态：
 * - skills/ 目录形态：<目录>/skills/<name>/SKILL.md——Pi 技能发现遇
 *   SKILL.md 即视为技能根、不递归（dist/core/skills.js），嵌套子技能
 *   永不进系统提示词索引，本模块补按需发现通道
 * - frontmatter 散布形态：树中带 name+description frontmatter 的 .md——
 *   lark 官方仓库的子技能分发形态（如 lark-apps/creative-design/ 一级
 *   平铺 + references/ 二级），文件无目录包裹、文件名即 name
 *
 * 自相似：read 带 frontmatter 的文件时同样触发其所在目录的扫描（如
 * read creative-design.md 后发现其 references/ 子资源），子级被 read
 * 时再触发一轮，不一次性递归展开。
 *
 * 设计决策（2026-08-31 主人确认）：
 * - 发现通道为按需清单，不进常驻系统提示词索引（frontmatter 的
 *   description 普遍偏长，常驻 token 代价不划算）
 * - frontmatter 检测只读头部 4KB（精确 readSync，不整读大文件），行锚定
 *   正则只认 name+description，metadata/available-agents 等超集字段忽略；
 *   收录条件为两者齐全，解析失败静默跳过
 * - 扫描范围：read 文件所在目录整树递归，跳过隐藏文件/目录（与 ref-hint
 *   约定一致）、跳过名为 skills 的目录的递归（其内部 SKILL.md 自带
 *   frontmatter，递归会与子技能目录条目重复；skills/ 形态只由专用逻辑
 *   收集）；read 文件自身排除——selfFile 与遍历路径同源 filePath 前缀
 *   形式（~ 形式/相对/绝对均自洽），字符串比较有效，无需 realpath
 * - name 取路径锚：skills/ 形态用目录名、frontmatter 形态用文件名 stem
 *   （group path 模板替换必须与路径一致，frontmatter 的 name 不作权威）；
 *   description 取 frontmatter
 * - 渲染：单清单多 group——skills/ 形态沿用 ${skillsDir}/${name}/SKILL.md
 *   模板，frontmatter 形态按父目录分组 ${dir}/${name}.md 模板，group 按
 *   模板串排序保证确定性；与 ref-hint 的纯路径清单并存不互斥（职责
 *   不同：ref-hint 给文件总览，本模块给结构化摘要）
 * - 只读红线：技能目录（~/.agents/skills 等）受 npx skills 管理，本模块
 *   只读头部，不回写任何文件
 * - 目录 symlink 不跟随（防循环），文件 symlink 读头部判断；entry 一条
 *   （customType "skill-ext"，历史名保持），notice 概括两形态
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { closeSync, existsSync, openSync, readdirSync, readSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { expandHome } from "./internal/path-canon.ts";
import { renderGroupOpen, renderSkill } from "./internal/render.ts";

/** 从 read 工具参数中安全提取路径 */
function extractPath(input: Record<string, unknown>): string | null {
  const p = input["path"];
  return typeof p === "string" && p.length > 0 ? p : null;
}

/** 头部读取字节数：足够覆盖现网最长 description 的 frontmatter 块 */
const HEAD_BYTES = 4096;

/** 精确读取文件头部（不整读大文件）；失败返回 null */
function readHead(file: string): string | null {
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

/** 解析头部 frontmatter 的 name 与 description（超集字段忽略；缺失省略键）。
 * 行锚定正则不受 available-agents 等多行字段干扰；头部截断只影响末尾
 * 半个多字节字符，不破坏前面完整行的匹配 */
function parseHeadFrontmatter(head: string): { name?: string; description?: string } {
  const m = head.match(/^---\n([\s\S]*?)\n---/);
  const fm = m?.[1];
  if (!fm) {
    return {};
  }
  const name = fm.match(/^name:\s*(.+?)\s*$/m)?.[1];
  const description = fm.match(/^description:\s*(.+?)\s*$/m)?.[1];
  return {
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
  };
}

/** 嵌套技能条目：name 为路径锚，groupDir 为 path 模板基准目录，
 * filePath 为真实完整路径（满足 SkillIndexEntry 接口，渲染不用） */
interface NestedSkillEntry {
  kind: "subskill" | "frontmatter";
  name: string;
  description?: string;
  groupDir: string;
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

/** 读子技能 SKILL.md 头部的 description（缺失省略） */
function readSubDescription(subDir: string): { description?: string } {
  const head = readHead(join(subDir, "SKILL.md"));
  if (!head) {
    return {};
  }
  return parseHeadFrontmatter(head);
}

/** 整树递归扫描嵌套技能（跳隐藏项与 skills/ 目录递归，selfFile 排除） */
function walkNestedSkills(dir: string, selfFile: string, out: NestedSkillEntry[]): void {
  // skills/ 目录形态：一级子目录中含 SKILL.md 的视为子技能
  const skillsDir = join(dir, "skills");
  if (existsSync(skillsDir)) {
    for (const subDir of discoverSubskillDirs(skillsDir)) {
      const { description } = readSubDescription(subDir);
      out.push({
        kind: "subskill",
        name: basename(subDir),
        ...(description ? { description } : {}),
        groupDir: skillsDir,
        filePath: join(subDir, "SKILL.md"),
      });
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
      kind: "frontmatter",
      // name 取文件名 stem 为路径锚（frontmatter name 不作权威）
      name: entry.name.replace(/\.md$/, ""),
      description: fm.description,
      groupDir: dir,
      filePath: full,
    });
  }
}

/** 渲染嵌套技能清单为 XML：单前导语 + 按 path 模板分组的多 group */
function renderNestedSkills(list: NestedSkillEntry[]): string {
  const groups = new Map<string, NestedSkillEntry[]>();
  for (const entry of list) {
    const template =
      entry.kind === "subskill"
        ? `${entry.groupDir}/\${name}/SKILL.md`
        : `${entry.groupDir}/\${name}.md`;
    const bucket = groups.get(template);
    if (bucket) {
      bucket.push(entry);
    } else {
      groups.set(template, [entry]);
    }
  }
  const lines = [
    "该技能管辖以下嵌套技能（按需 read 加载，group path 中 ${name} 以条目名替换即得完整路径）：",
  ];
  // eslint-disable-next-line unicorn/no-array-sort -- Map 展开已生成新数组，sort 安全
  for (const [template, items] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(renderGroupOpen(template));
    for (const item of items) {
      lines.push(...renderSkill(item));
    }
    lines.push("</group>");
  }
  return lines.join("\n");
}

export function registerNestedSkillHint(pi: ExtensionAPI) {
  pi.on("tool_result", async (event) => {
    if (event.toolName !== "read") {
      return;
    }

    const filePath = extractPath(event.input);
    if (!filePath) {
      return;
    }

    // 触发面：SKILL.md 或带 name+description frontmatter 的 .md；~ 前缀
    // 展开供后续 fs 调用与路径比较使用（同源自展开后前缀，比较自洽）
    const normalized = expandHome(filePath);
    const isSkillMd = normalized.endsWith("SKILL.md");
    let head: string | null = null;
    if (isSkillMd) {
      head = readHead(normalized);
    } else if (normalized.endsWith(".md")) {
      head = readHead(normalized);
      if (head) {
        const fm = parseHeadFrontmatter(head);
        if (!fm.name || !fm.description) {
          head = null;
        }
      }
    }
    if (!head) {
      return;
    }

    // 读取失败的 tool_result 不追加清单
    if (event.isError) {
      return;
    }

    const first = event.content.at(0);
    if (!first || first.type !== "text") {
      return;
    }

    const baseDir = dirname(normalized);
    const list: NestedSkillEntry[] = [];
    walkNestedSkills(baseDir, normalized, list);
    if (list.length === 0) {
      return;
    }

    const hint = `\n\n---\n${renderNestedSkills(list)}`;

    // TUI-only 用户提示（不进 LLM 上下文）；与 ref-hint 的提示分开投递
    pi.appendEntry("skill-ext", {
      notice: `[自动注入] 嵌套技能清单：${basename(baseDir)}（${list.length} 个嵌套技能）`,
      lines: list.map((e) => `${e.name}${e.kind === "subskill" ? "（skills/）" : ""}`),
    });

    const rest = event.content.slice(1);
    return {
      content: [{ type: "text" as const, text: first.text + hint }, ...rest],
    };
  });
}

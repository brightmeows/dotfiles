/**
 * Subskill Hint（skill-ext 子模块）
 *
 * 在模型 read 任意 SKILL.md 后，探测其所在目录的 skills/ 子目录结构
 * （技能包形态：<技能根>/skills/<子技能名>/SKILL.md），若存在则于
 * tool_result 末尾追加子技能列表（XML，仿系统提示词 available_skills），
 * 提示模型按需 read。
 *
 * 背景：Pi 的技能发现遇 SKILL.md 即视为技能根、不递归子目录
 * （dist/core/skills.js loadSkillsFromDir），技能包嵌套的子技能永远不会
 * 进入系统提示词索引；本扩展补"按需发现"通道，与索引（index-rewrite）
 * 互补。
 *
 * 设计决策（2026-08-11 主人确认）：
 * - 一级探测：只列 <技能根>/skills/ 直接子目录中含 SKILL.md 的技能；
 *   子技能自身再有 skills/ 时，模型 read 它再触发一轮（自相似，不递归）
 * - 条目内容：name + description（仿系统提示词条目）；description 缺失
 *   省略元素，name 缺失回退子目录名；不设上限全列
 * - 格式：XML <group dir="..."> + <skill>，路径 = <group dir>/<skill
 *   name>/SKILL.md（与系统提示词索引的路径推断约定一致）
 * - 与 ref-hint 分工：ref-hint 枚举技能根全部文件（跳过 skills/ 区），
 *   本扩展列目录结构发现的子技能；两者独立段追加
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { escapeXml } from "./render.ts";

/** 从 read 工具参数中安全提取路径 */
function extractPath(input: Record<string, unknown>): string | null {
  const p = input["path"];
  return typeof p === "string" && p.length > 0 ? p : null;
}

/** 从 SKILL.md frontmatter 提取 name/description（单行字段；缺失省略键） */
function parseFrontmatter(raw: string): { name?: string; description?: string } {
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  const fm = m?.[1];
  if (!fm) {
    return {};
  }
  const result: { name?: string; description?: string } = {};
  const name = fm.match(/^name:\s*(.+?)\s*$/m)?.[1];
  if (name) {
    result.name = name;
  }
  const description = fm.match(/^description:\s*(.+?)\s*$/m)?.[1];
  if (description) {
    result.description = description;
  }
  return result;
}

/** 列出 skills 目录下的子技能（仅含 SKILL.md 的目录） */
function discoverSubSkills(skillsDir: string): { name: string; dir: string }[] {
  const subs: { name: string; dir: string }[] = [];
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
      subs.push({ name: entry.name, dir: subDir });
    }
  }
  return subs;
}

/** 渲染子技能列表为 XML（仿系统提示词 available_skills 条目） */
function renderSubskills(skillsDir: string, subs: { name: string; dir: string }[]): string {
  const lines = [`<group dir="${escapeXml(skillsDir)}/">`];
  for (const sub of subs) {
    let meta: { name?: string; description?: string } = {};
    try {
      meta = parseFrontmatter(readFileSync(join(sub.dir, "SKILL.md"), "utf8"));
    } catch {
      // 读取失败时按无 frontmatter 处理（name 回退目录名）
    }
    lines.push("  <skill>");
    lines.push(`    <name>${escapeXml(meta.name ?? sub.name)}</name>`);
    if (meta.description) {
      lines.push(`    <description>${escapeXml(meta.description)}</description>`);
    }
    lines.push("  </skill>");
  }
  lines.push("</group>");
  return lines.join("\n");
}

export function registerSubskillHint(pi: ExtensionAPI) {
  pi.on("tool_result", async (event) => {
    if (event.toolName !== "read") {
      return;
    }

    const filePath = extractPath(event.input);
    if (!filePath || !filePath.endsWith("SKILL.md")) {
      return;
    }

    // 提取首个 text 内容（read SKILL.md 通常返回单个 text content）
    const first = event.content.at(0);
    if (!first || first.type !== "text") {
      return;
    }

    const baseDir = dirname(filePath);
    const skillsDir = join(baseDir, "skills");
    if (!existsSync(skillsDir)) {
      return;
    }
    const subs = discoverSubSkills(skillsDir);
    if (subs.length === 0) {
      return;
    }

    const hint = `\n\n---\n该技能管辖以下子技能（按需 read 加载，路径 = <group dir>/<skill name>/SKILL.md）：\n${renderSubskills(
      skillsDir,
      subs,
    )}`;

    const rest = event.content.slice(1);
    return {
      content: [{ type: "text" as const, text: first.text + hint }, ...rest],
    };
  });
}

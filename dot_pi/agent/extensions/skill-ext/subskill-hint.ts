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
 * 设计决策（2026-08-11 主人确认；2026-08-13 渲染层单点化修订）：
 * - 一级探测：只列 <技能根>/skills/ 直接子目录中含 SKILL.md 的技能；
 *   子技能自身再有 skills/ 时，模型 read 它再触发一轮（自相似，不递归）
 * - 条目内容：name + description（仿系统提示词条目）；name 固定用目录名
 *   （frontmatter name 与目录名不一致时 path 模板替换会指错文件）；
 *   description 缺失省略元素；不设上限全列
 * - 格式：<group path=".../skills/${name}/SKILL.md"> + <skill>，渲染走
 *   render.ts 共享函数，与系统提示词索引同源不会不同步
 * - 与 ref-hint 分工：ref-hint 枚举技能根全部文件（跳过 skills/ 区），
 *   本扩展列目录结构发现的子技能；两者独立段追加
 *
 * 用户提示（2026-08-17）：注入子技能清单的同时 appendEntry 一条 TUI-only
 * 简短提示（不进 LLM 上下文），与 ref-hint 的文件清单提示各自独立；
 * 渲染走 ../lib/inject-notice.ts 的 renderInjectEntry（customType
 * "skill-ext"，renderer 在 index-rewrite.ts 统一注册）。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { renderGroupOpen, renderSkill } from "./render.ts";

/** 从 read 工具参数中安全提取路径 */
function extractPath(input: Record<string, unknown>): string | null {
  const p = input["path"];
  return typeof p === "string" && p.length > 0 ? p : null;
}

/** 从 SKILL.md frontmatter 提取 description（单行字段；缺失省略键） */
function parseFrontmatter(raw: string): { description?: string } {
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  const fm = m?.[1];
  if (!fm) {
    return {};
  }
  const description = fm.match(/^description:\s*(.+?)\s*$/m)?.[1];
  return description ? { description } : {};
}

/** 读取子技能 SKILL.md 的 description（读取失败或缺失时省略） */
function readSubDescription(subDir: string): { description?: string } {
  try {
    return parseFrontmatter(readFileSync(join(subDir, "SKILL.md"), "utf8"));
  } catch {
    // 读取失败时省略 description
    return {};
  }
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

/** 渲染子技能列表为 XML（渲染走 render.ts 共享函数，与系统提示词索引同源） */
function renderSubskills(skillsDir: string, subs: { name: string; dir: string }[]): string {
  const lines = [renderGroupOpen(`${skillsDir}/\${name}/SKILL.md`)];
  for (const sub of subs) {
    const { description } = readSubDescription(sub.dir);
    lines.push(
      ...renderSkill({
        name: sub.name,
        filePath: join(sub.dir, "SKILL.md"),
        ...(description ? { description } : {}),
      }),
    );
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

    const hint = `\n\n---\n该技能管辖以下子技能（按需 read 加载）：\n${renderSubskills(
      skillsDir,
      subs,
    )}`;

    // TUI-only 简短提示（不进 LLM 上下文）；与 ref-hint 的提示分开投递
    pi.appendEntry("skill-ext", {
      notice: `[自动注入] 子技能清单：${basename(baseDir)}（${subs.length} 个子技能）`,
      lines: subs.map((s) => s.name),
    });

    const rest = event.content.slice(1);
    return {
      content: [{ type: "text" as const, text: first.text + hint }, ...rest],
    };
  });
}

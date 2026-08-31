/**
 * Skill Reference Hint（better-skill 主模块，原 skill-ref-hint.ts）
 *
 * 在模型 read 任意 SKILL.md 后，枚举其所在目录（技能根）下的全部文件，
 * 于同一 tool_result 末尾追加相对路径清单（基准 = SKILL.md 所在目录），
 * 让模型在读完 SKILL.md 后即知该技能的全部辅助材料，按需 read。
 *
 * 设计决策（2026-08-11 主人确认，由"正文链接解析"改为"目录枚举"）：
 * - 枚举范围：技能根整树递归（含子目录）；跳过隐藏文件/目录（.* 前缀，
 *   与 Pi 技能发现一致）；跳过所有名为 skills 的目录（子技能区归
 *   subskill-hint 结构化提示，避免重复）
 * - 输出：一行基准（SKILL.md 所在目录绝对路径）+ 全部文件相对路径
 *   （./ 开头，相对基准）；不设上限
 * - 相对路径原因：正文链接解析已废弃——目录枚举天然覆盖正文引用；
 *   相对路径短、技能目录迁移后不变；基准绝对路径明示（read 工具按
 *   cwd 解析相对路径，模型需自行换算，基准注出则换算零歧义）
 *
 * 用户提示（2026-08-17）：注入清单的同时 appendEntry 一条 TUI-only 简短
 * 提示（不进 LLM 上下文），与 subskill-hint 的子技能提示各自独立；
 * 渲染走包内 inject-notice.ts 的 renderInjectEntry（customType
 * "skill-ext"，renderer 在 index-rewrite.ts 统一注册）。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { expandHome } from "./path-canon.ts";

/** 从 read 工具参数中安全提取路径 */
function extractPath(input: Record<string, unknown>): string | null {
  const p = input["path"];
  return typeof p === "string" && p.length > 0 ? p : null;
}

/**
 * 递归枚举目录下全部文件（相对基准路径）：
 * - 跳过隐藏文件/目录（.* 前缀，与 Pi 技能发现一致）
 * - 跳过所有名为 skills 的目录（子技能区归 subskill-hint）
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

export function registerRefHint(pi: ExtensionAPI) {
  pi.on("tool_result", async (event) => {
    if (event.toolName !== "read") {
      return;
    }

    const rawPath = extractPath(event.input);
    if (!rawPath || !rawPath.endsWith("SKILL.md")) {
      return;
    }

    // ~ 前缀展开：技能索引模板以 ~ 形式展示，模型会照抄发起 read，
    // node fs 不展开 ~，不展开则 readdirSync ENOENT 静默失效
    const filePath = expandHome(rawPath);

    // 提取首个 text 内容（read SKILL.md 通常返回单个 text content）
    const first = event.content.at(0);
    if (!first || first.type !== "text") {
      return;
    }

    const baseDir = dirname(filePath);
    const files: string[] = [];
    walkFiles(baseDir, baseDir, files);
    if (files.length === 0) {
      return;
    }
    files.sort();

    // 排除 SKILL.md 自身（模型刚读完，无需提示）
    const hintFiles = files.filter((f) => f !== "SKILL.md");
    if (hintFiles.length === 0) {
      return;
    }

    const hint = `\n\n---\n该技能包含以下文件（相对路径，基准 = ${baseDir}/）：\n${hintFiles
      .map((f) => `  - ./${f}`)
      .join("\n")}`;

    // TUI-only 简短提示（不进 LLM 上下文）；与 subskill-hint 的提示分开投递
    pi.appendEntry("skill-ext", {
      notice: `[自动注入] 技能文件清单：${basename(baseDir)}（${hintFiles.length} 个附属文件）`,
      lines: hintFiles.map((f) => `./${f}`),
    });

    const rest = event.content.slice(1);
    return {
      content: [{ type: "text" as const, text: first.text + hint }, ...rest],
    };
  });
}

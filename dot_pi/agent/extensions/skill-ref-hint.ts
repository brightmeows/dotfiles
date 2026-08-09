/**
 * Skill Reference Hint Extension
 *
 * 在模型 read 任意 SKILL.md 后，于同一 tool_result 末尾追加该技能引用的
 * 子文件清单（路径 + 链接显示文本），提示模型按需读取，解决"参考文件
 * 不读取"问题（技能生效决策点链中的执行失败节点）。
 *
 * 设计取向（符合用户约束）：
 * - 不新增工具：仅通过 tool_result 拦截追加提示文本。
 * - 优先提示"存在"而非注入正文：只列出子文件路径，不读取其正文；模型
 *   据提示自行决定是否 read。仅 existsSync 验证文件存在。
 * - 时机最优：提示紧跟 SKILL.md 正文（模型刚读完、即将决策下一步），
 *   命中率天然高于散落在系统提示词里的静态指令。
 *
 * 仅处理 SKILL.md 内指向同目录树的相对链接（./ 或 ../ 开头），忽略
 * http 链接与绝对路径。每个技能最多提示一定数量子文件，避免过长。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** Markdown 相对链接：[显示文本](相对路径)，仅匹配 ./ 或 ../ 开头 */
const REL_LINK_RE = /\[(?<label>[^\]]*)\]\((?<rel>\.\.?\/[^)\s]+)\)/g;

/** 单个技能最多提示的子文件数，防止清单过长稀释注意力 */
const MAX_REFS = 12;

/** 从 read 工具参数中安全提取路径 */
function extractPath(input: Record<string, unknown>): string | null {
  const p = input["path"];
  return typeof p === "string" && p.length > 0 ? p : null;
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_result", async (event, _ctx) => {
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
    const refs: string[] = [];
    const seen = new Set<string>();

    for (const match of first.text.matchAll(REL_LINK_RE)) {
      if (refs.length >= MAX_REFS) {
        break;
      }
      const rel = match.groups?.["rel"];
      if (!rel) {
        continue;
      }
      const label = match.groups?.["label"] ?? rel;
      const abs = resolve(baseDir, rel);
      if (seen.has(abs) || !existsSync(abs)) {
        continue;
      }
      seen.add(abs);
      // 优先用链接显示文本作说明；若文本本身是路径则用相对路径
      const note = label && !label.startsWith(".") ? label : rel;
      refs.push(`  - ${note} → ${abs}`);
    }

    if (refs.length === 0) {
      return;
    }

    const hint = `\n\n---\n该技能引用了以下子文件（按 SKILL.md 指引判断是否需要读取，不要跳过）：\n${refs.join(
      "\n",
    )}`;

    const rest = event.content.slice(1);
    return {
      content: [{ type: "text" as const, text: first.text + hint }, ...rest],
    };
  });
}

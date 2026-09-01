/**
 * Read Hint（better-skill 注册模块，2026-09-01 由 ref-hint / nested-skill-hint /
 * agent-browser-notice 三拦截合并）
 *
 * read 工具的 tool_result 拦截：read 技能文件（SKILL.md 或带 name+description
 * frontmatter 的 .md）后，于结果末尾追加增强段。三段逻辑（附属文件清单 /
 * 嵌套技能清单 / agent-browser 提醒）已抽至 internal/skill-content.ts，本
 * 模块只负责触发面判断与结果拼装；skill 工具加载同一文件时走同一组装函数，
 * 两通道信息面完全一致（完整等效，2026-09-01 主人确认）。
 *
 * 定位（2026-09-01）：skill 工具成为技能加载主通道后，本拦截降为兜底通道
 * ——resume 旧会话凭历史路径直接 read、模型绕过工具、嵌套子技能文件加载
 * （子技能不在索引与名空间注册的根集合之外部分，实际由名空间全量注册，
 * 但 read 子技能文件仍是合法路径）都走这里。增强段的显示名经名空间解析
 * （resolveDisplayName），与索引、工具返回一致。
 *
 * 触发面（与拆分前一致）：
 * - SKILL.md：无条件触发（Pi 技能必有 description frontmatter，头部读取
 *   失败即视为读取异常，静默返回）
 * - 其他 .md：头部带 name+description 齐全 frontmatter 才触发（自相似：
 *   read 子技能散布文件后继续发现其嵌套资源）
 *
 * 通知约定：appendEntry 走包内 inject-notice.ts 的 renderInjectEntry
 * （customType "skill-ext"，历史名保持），notice 由 skill-content 统一
 * 产出，与拆分前三模块独立投递的形态一致。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { basename } from "node:path";
import { expandHome } from "./internal/path-canon.ts";
import { resolveDisplayName } from "./internal/namespace.ts";
import {
  collectEnhancements,
  extractPath,
  parseHeadFrontmatter,
  readHead,
} from "./internal/skill-content.ts";

export function registerReadHint(pi: ExtensionAPI) {
  pi.on("tool_result", async (event) => {
    if (event.toolName !== "read") {
      return;
    }

    const rawPath = extractPath(event.input);
    if (!rawPath) {
      return;
    }

    // ~ 前缀展开：技能路径以 ~ 形式展示时模型可能照抄发起 read，node fs
    // 不展开 ~（openSync 直接 ENOENT 静默失效）
    const filePath = expandHome(rawPath);

    // 触发面判断：SKILL.md 或带 name+description frontmatter 的 .md
    const isSkillMd = basename(filePath) === "SKILL.md";
    let head: string | null = null;
    if (isSkillMd) {
      head = readHead(filePath);
    } else if (filePath.endsWith(".md")) {
      head = readHead(filePath);
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

    // 读取失败的 tool_result 不追加增强段
    if (event.isError) {
      return;
    }

    const first = event.content.at(0);
    if (!first || first.type !== "text") {
      return;
    }

    const { sections, notices } = collectEnhancements(filePath, resolveDisplayName);
    if (sections.length === 0) {
      return;
    }

    // TUI-only 用户提示（不进 LLM 上下文），各通知独立投递
    for (const n of notices) {
      pi.appendEntry("skill-ext", n);
    }

    const rest = event.content.slice(1);
    return {
      content: [
        {
          type: "text" as const,
          text: `${first.text}\n\n---\n${sections.join("\n\n---\n")}`,
        },
        ...rest,
      ],
    };
  });
}

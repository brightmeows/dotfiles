/**
 * Skill Tool（better-skill 注册模块，2026-09-01 新增）
 *
 * 按名加载技能的主通道：LLM 调用 skill 工具，参数为全局名空间内的技能名
 * （含消歧别名），返回技能文件全文（根技能为 SKILL.md，嵌套技能为其散布
 * md）加增强段（附属文件清单、嵌套技能清单、agent-browser 提醒），与
 * read 技能文件的信息面完全一致（完整等效，共用 internal/skill-content.ts
 * 组装）。
 *
 * 设计要点（2026-09-01 主人确认）：
 * - 只接受技能名（不接受路径、无附加动作参数）：名字精确查名空间映射，
 *   未命中 isError 附全量可调用名列表自纠；路径形态参数给专门错误提示
 * - 内容按 read 等效截断：truncateHead + DEFAULT_MAX_LINES/DEFAULT_MAX_BYTES
 *   （2000 行/50KB，与内置 read 一致）；截断时完整内容落盘临时文件并在
 *   提示中给出路径（agent-browser 提醒依赖该落盘文件转读完整内容）
 * - 单技能参数：并行多次调用即可，数组会混淆增强段归属
 * - 不用 promptSnippet/promptGuidelines：加载指令集中在索引前导激活规则
 *   （单一来源），工具显著性由规则区保证
 * - 名字解析与显示名走 internal/namespace.ts（索引、工具、read 拦截三方
 *   同源，照抄索引条目名必可调用）
 *
 * 文本定稿（2026-09-01 主人确认）：description、参数描述、三类错误信息
 * 见下方常量与 schema。
 * renderResult 折叠态（2026-09-01 主人确认）：成功零显示（截断/落盘信息
 * 在展开态与 LLM 上下文）；错误单行摘要（含「」取技能名，否则取首行）；
 * 展开态全文 Markdown。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  getMarkdownTheme,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import { Markdown, Text } from "@earendil-works/pi-tui";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import { listCallableNames, lookupName, resolveDisplayName } from "./internal/namespace.ts";
import { collectEnhancements } from "./internal/skill-content.ts";

/** 提取工具结果 content 的纯文本（渲染用） */
function contentText(content: readonly { type: string; text?: unknown }[]): string {
  const parts: string[] = [];
  for (const part of content) {
    if (part.type === "text" && typeof part.text === "string") {
      parts.push(part.text);
    }
  }
  return parts.join("\n");
}

export function registerSkillTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "skill",
    label: "Skill",
    description:
      "按名加载技能：返回该技能文件全文（根技能为 SKILL.md，嵌套技能为其散布 md）与附属文件、嵌套技能两份清单。name 必须照抄 <available_skills> 索引或嵌套技能清单中的名字（含 @ 别名），不接受路径。",
    parameters: Type.Object({
      name: Type.String({ description: "技能名，照抄技能索引或嵌套清单（含 @ 别名）" }),
    }),
    async execute(_toolCallId, params) {
      // 路径形态参数给专门提示（定稿错误信息之一）
      if (params.name.includes("/") || params.name.includes("\\")) {
        throw new Error("未知路径参数：skill 只接受技能名，不接受文件路径。");
      }
      const entry = lookupName(params.name);
      if (!entry) {
        throw new Error(
          `未知技能名「${params.name}」。可用技能名（照抄，含别名）：${listCallableNames().join(", ")}`,
        );
      }

      let raw: string;
      try {
        raw = readFileSync(entry.filePath, "utf8");
      } catch (e) {
        throw new Error(
          `技能文件读取失败：${entry.filePath}（${e instanceof Error ? e.message : String(e)}）`,
        );
      }

      // read 等效截断（2000 行/50KB，先到先停）；截断时完整内容落盘临时
      // 文件，提示中给出路径
      const truncation = truncateHead(raw, {
        maxLines: DEFAULT_MAX_LINES,
        maxBytes: DEFAULT_MAX_BYTES,
      });
      let text = truncation.content;
      if (truncation.truncated) {
        const tempFile = join(tmpdir(), `skill-load-${randomUUID()}.md`);
        writeFileSync(tempFile, raw);
        text += `\n\n[输出截断：仅显示 ${truncation.outputLines}/${truncation.totalLines} 行（${formatSize(truncation.outputBytes)}/${formatSize(truncation.totalBytes)}）。完整内容已落盘：${tempFile}]`;
      }

      // 增强段与 TUI 通知（与 read 拦截共用组装，信息面一致）
      const { sections, notices } = collectEnhancements(entry.filePath, resolveDisplayName);
      for (const n of notices) {
        pi.appendEntry("skill-ext", n);
      }
      if (sections.length > 0) {
        text += `\n\n---\n${sections.join("\n\n---\n")}`;
      }

      return {
        content: [{ type: "text" as const, text }],
        details: {
          skill: entry.callableName,
          path: entry.filePath,
          truncated: truncation.truncated,
        },
      };
    },
    renderCall(args, theme) {
      const name = typeof args?.name === "string" ? args.name : "";
      return new Text(theme.fg("toolTitle", theme.bold("skill ")) + theme.fg("muted", name), 0, 0);
    },
    renderResult(result, { expanded }, theme) {
      if (expanded) {
        return new Markdown(contentText(result.content), 0, 0, getMarkdownTheme(), {
          color: (s: string) => theme.fg("customMessageText", s),
        });
      }
      // 折叠态：成功零显示；错误单行摘要。错误检测契约：execute 成功路径
      // 必带 details.skill，throw 错误结果无该字段（AgentToolResult 类型未
      // 建模 isError，运行时信号不可依赖）
      const detail = result.details as { skill?: string } | undefined;
      if (detail?.skill) {
        return new Text("", 0, 0);
      }
      const text = contentText(result.content);
      const named = text.match(/「([^」]+)」/);
      const firstLine = (text.split("\n")[0] ?? "").slice(0, 60);
      const summary = named ? `加载失败：未知技能名「${named[1]}」` : firstLine;
      return new Text(theme.fg("error", summary), 0, 0);
    },
  });
}

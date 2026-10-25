/**
 * Skill Reminders（技能专项提醒注入，2026-09-19 自 better-skill 拆出）
 *
 * 读取/编辑带专项提醒的技能与代理文档时注入提醒段（进 LLM 上下文）。提醒
 * 内容为数据驱动注册表（internal/reminders.ts）：新增提醒 = 在注册表追加
 * 一条；存在性守卫见 internal/skill-presence.ts；bash 提取见
 * internal/bash-paths.ts。
 *
 * 触发面（三通道）：
 * - 结构化工具：read/edit/write 的 input.path 命中注册项 matches，提醒段拼进
 *   tool_result 尾部，details 载标记（持久去重）；
 * - bash/powershell：input.command 白名单启发式（cat 等纯读取命令在列，
 *   rg/grep 因模式误报排除），tool_result 只收集、turn_end 投单条
 *   custom_message（display: true）——codemode 嵌套下 tool_result 拼接会丢
 *   （subdir-agents-md 2026-10-03 实测），边界条目是唯一保证送达的通道，
 *   投递与标记同走条目保住原子性（拼接丢但标记落 = 永久漏注，须避免）；
 *   提醒段本身短，单条 display: true 即覆盖用户知情面，不拆通知/全文两条；
 * - 手动命令：input 事件解析 /skill:<name> 命中 skillName，提醒拼到输入
 *   文本尾部（先于 Pi 技能展开，2026-10-03 补）。
 *
 * 持久去重（subdir-agents-md 同款两态机制）：标记 {path, hash} 落
 * toolResult / custom_message 的 details（details 不进 LLM），扫库读回跨
 * resume 判重；hash 是权威键（同一段提醒跨文件只进一次上下文），path 仅
 * 诊断。compact 后标记随条目消失、实例集清空，回到可注入态（代理压缩后
 * 不再记得提醒，重提有益）。
 *
 * 加载顺序：无包间依赖（2026-09-24 起 better-skill 移除）；本包只做段尾
 * 追加与边界投递。
 * （历史：skill 工具通道 2026-09-24 随 better-skill 移除而删除，
 * event.details.path 契约不复存在。）
 */

import type { ExtensionAPI, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import * as path from "node:path";
import { extractBashPaths, expandHome, realpathOr } from "./internal/bash-paths.ts";
import {
  collectReminders,
  collectRemindersBySkillName,
  isAgentsDocPath,
  renderReminderSection,
} from "./internal/reminders.ts";

/** 注入标记写入 details 的键（持久化去重；details 不进 LLM） */
const MARK_KEY = "skillReminders";

/** 边界投递条目的 customType（bash 通道扫库识别） */
const CUSTOM_TYPE = "skill-reminders";

/** 单条注入标记：hash 为提醒段文本摘要（去重权威键）；path 为触发文件（诊断） */
interface Mark {
  path: string;
  hash: string;
}

function isMark(v: unknown): v is Mark {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as { path?: unknown }).path === "string" &&
    typeof (v as { hash?: unknown }).hash === "string"
  );
}

/** 合并标记进 details（保留工具自有 details 字段，按 hash 去重） */
function withMarks(details: unknown, marks: readonly Mark[]): unknown {
  const base: Record<string, unknown> =
    typeof details === "object" && details !== null
      ? { ...(details as Record<string, unknown>) }
      : {};
  const prev: Mark[] = Array.isArray(base[MARK_KEY])
    ? (base[MARK_KEY] as unknown[]).filter(isMark)
    : [];
  const seen = new Set(prev.map((m) => m.hash));
  for (const m of marks) {
    if (!seen.has(m.hash)) {
      seen.add(m.hash);
      prev.push(m);
    }
  }
  base[MARK_KEY] = prev;
  return base;
}

/** 提醒段文本的 sha256 摘要（去重键） */
function hashOf(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

/** 扫库：从会话已落库条目收集已注入标记（持久去重权威来源；compact 后随条目消失） */
function scanSessionMarks(ctx: { sessionManager: { buildContextEntries: () => unknown[] } }): {
  paths: Set<string>;
  hashes: Set<string>;
} {
  const paths = new Set<string>();
  const hashes = new Set<string>();
  for (const entry of ctx.sessionManager.buildContextEntries()) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const e = entry as {
      type?: string;
      customType?: string;
      details?: unknown;
      message?: { role?: string; details?: unknown };
    };
    let details: unknown;
    if (e.type === "message" && e.message?.role === "toolResult") {
      ({ details } = e.message);
    } else if (e.type === "custom_message" && e.customType === CUSTOM_TYPE) {
      ({ details } = e);
    } else {
      continue;
    }
    if (typeof details !== "object" || details === null) {
      continue;
    }
    const marks = (details as Record<string, unknown>)[MARK_KEY];
    if (!Array.isArray(marks)) {
      continue;
    }
    for (const raw of marks) {
      if (isMark(raw)) {
        paths.add(raw.path);
        hashes.add(raw.hash);
      }
    }
  }
  return { paths, hashes };
}

/**
 * 对触发文件集合解析提醒：存在性守卫过滤、渲染、hash 去重（扫库 + injected
 * 实例集，命中者就地入集）。返回新注入段与待落库标记；无新注入则两数组皆空。
 */
function resolveSections(
  paths: readonly string[],
  injected: Set<string>,
  scanned: { paths: Set<string>; hashes: Set<string> },
): { sections: string[]; marks: Mark[] } {
  const sections: string[] = [];
  const marks: Mark[] = [];
  for (const p of paths) {
    for (const reminder of collectReminders(p)) {
      const skillPath = reminder.requiresPath?.() ?? null;
      if (reminder.requiresPath !== undefined && skillPath === null) {
        continue; // 守卫不过：技能不存在，整条静默跳过
      }
      const section = renderReminderSection(reminder, skillPath ?? undefined);
      const hash = hashOf(section);
      if (injected.has(hash) || scanned.hashes.has(hash)) {
        continue; // 同一段提醒已注入过（含别的文件触发），不重复
      }
      injected.add(hash);
      sections.push(section);
      marks.push({ path: p, hash });
    }
  }
  return { sections, marks };
}

/** 取结构化工具的文件路径：read/edit/write 的 input.path 原样值（可能带 ~/ 相对前缀） */
function structuredFilePath(event: ToolResultEvent): string | null {
  if (event.toolName !== "read" && event.toolName !== "edit" && event.toolName !== "write") {
    return null;
  }
  const raw = event.input["path"];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/** 白名单启发式提取 bash 被操作路径，basename 命中代理文档者入 pending（投递延至 turn_end） */
function collectBashHits(command: unknown, root: string, pending: Set<string>): void {
  if (typeof command !== "string" || command.length === 0) {
    return;
  }
  for (const rel of extractBashPaths(command, root)) {
    const abs = path.resolve(root, rel);
    if (isAgentsDocPath(abs)) {
      pending.add(abs);
    }
  }
}

/** 解析手动技能命令名（/skill:<name> 后仅空白与参数；非技能命令返回 null） */
function skillCommandName(text: string): string | null {
  const matched = /^\/skill:([^\s]+)(\s[\s\S]*)?$/u.exec(text);
  return matched?.[1] ?? null;
}

export default function (pi: ExtensionAPI) {
  /** 本实例已注入的提醒段 hash（compact 后清空，允许重注入） */
  const injectedHashes = new Set<string>();
  /** 本回合 bash 命中的待投文件（turn_end 处理并清空） */
  const pendingPaths = new Set<string>();

  // 手动 /skill:<name> 通道：input 事件先于技能展开（agent-session prompt），
  // 在文本尾部追加提醒段；展开后提醒随 args 进入用户消息
  pi.on("input", async (event) => {
    const name = skillCommandName(event.text);
    if (name === null) {
      return undefined;
    }
    const reminders = collectRemindersBySkillName(name);
    if (reminders.length === 0) {
      return undefined;
    }
    const sections = reminders.map((reminder) => renderReminderSection(reminder));
    // 命令名后必须留一个空格：Pi 以首个空格切分技能名与参数
    const spacer = event.text.length === 7 + name.length ? " " : "";
    return {
      action: "transform" as const,
      text: `${event.text}${spacer}\n\n${sections.join("\n\n---\n")}`,
    };
  });

  // 结构化通道投递 + bash 通道收集（触发在 tool_result，投递统一到 turn_end）
  pi.on("tool_result", async (event, ctx) => {
    if (event.isError) {
      return undefined;
    }
    const filePath = structuredFilePath(event);
    if (filePath === null) {
      if (event.toolName === "bash" || event.toolName === "powershell") {
        collectBashHits(event.input["command"], realpathOr(ctx.cwd), pendingPaths);
      }
      return undefined;
    }
    const abs = path.resolve(ctx.cwd, expandHome(filePath));
    const { sections, marks } = resolveSections([abs], injectedHashes, scanSessionMarks(ctx));
    if (sections.length === 0) {
      return undefined;
    }
    const first = event.content.at(0);
    if (!first || first.type !== "text") {
      return undefined;
    }
    return {
      content: [
        {
          type: "text" as const,
          text: `${first.text}\n\n---\n${sections.join("\n\n---\n")}`,
        },
        ...event.content.slice(1),
      ],
      details: withMarks(event.details, marks),
    };
  });

  // 投递 bash 通道：turn_end 边界单条 custom_message（见文件头设计）
  pi.on("turn_end", async (event, ctx) => {
    if (pendingPaths.size === 0) {
      return undefined;
    }
    const paths = [...pendingPaths];
    pendingPaths.clear();
    const { sections, marks } = resolveSections(paths, injectedHashes, scanSessionMarks(ctx));
    if (sections.length === 0) {
      return undefined;
    }
    return {
      entries: [
        ...event.entries,
        {
          type: "custom_message" as const,
          customType: CUSTOM_TYPE,
          content: sections.join("\n\n---\n"),
          display: true,
          details: withMarks(undefined, marks),
        },
      ],
    };
  });

  // 压缩（compact）后扫库标记随条目消失（代理不再记得提醒），实例集同步清空回到可注入态
  pi.on("session_compact", async () => {
    injectedHashes.clear();
  });
}

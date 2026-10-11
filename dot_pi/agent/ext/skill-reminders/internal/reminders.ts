/**
 * 技能专项提醒注册表（skill-reminders 包内纯库，2026-09-19 自 better-skill 的
 * internal/skill-content.ts 迁出并组件化）
 *
 * 一条提醒 = 一个注册项：命中判断 + 条目正文。新增提醒只需在 SKILL_REMINDERS
 * 追加一条，不改投递管线（index.ts）；同一技能的多条提醒并入该条目的 items
 * （list 形态渲染为编号列表），不新开注册项。LLM 注入段直接由条目正文渲染
 * （单一来源，改条目即生效）。
 *
 * 命中判断双通道：
 * - 文件：入参为文件路径（input.path 原样值，可能带 ~ 前缀）；匹配按路径
 *   组件，不锁绝对路径（技能目录受 npx skills 管理重装迁移后仍生效）。
 * - input：入参为手动命令解析出的技能名（/skill:<name>，2026-10-03 补）；
 *   按条目声明的 skillName 精确匹配。
 *
 * 存在性守卫（2026-10-12 补）：条目可声明 requiresPath，命中时探测目标
 * 技能是否安装，未安装则整条静默跳过（探测见 internal/skill-presence.ts）；
 * 返回路径可经 {skill-path} 占位符填进正文。声明了 requiresPath 的条目
 * 通常不声明 skillName：手动激活已达成目的，无需再提醒。
 */

import { findWritingForAgentsSkill } from "./skill-presence.ts";

/** 一条技能专项提醒 */
export interface SkillReminder {
  /** 提醒标识（渲染进 LLM 段标题，如 "agent-browser"） */
  id: string;
  /** 技能命令名（/skill:<name> 输入通道命中用；与 id 相同时仍显式声明） */
  skillName?: string;
  /** 正文形态：list = 编号条目（默认）；prose = 单段正文（标题后直接衔接） */
  format?: "list" | "prose";
  /** 语气：must = 须遵守（默认，硬指令）；suggest = 建议（软指令） */
  tone?: "must" | "suggest";
  /** 命中判断：入参为文件路径（文件通道） */
  matches: (filePath: string) => boolean;
  /** 存在性守卫：返回正文所需技能路径；返回 null 时整条跳过不注入 */
  requiresPath?: () => string | null;
  /** 提醒条目（LLM 注入段唯一来源）；{skill-path} 占位符由 requiresPath 结果替换 */
  items: readonly string[];
}

/** 判断是否 agent-browser 技能的 SKILL.md：basename 为 SKILL.md 且路径组件含
 * agent-browser（兼容 / 与 \ 分隔符，不锁绝对路径） */
export function isAgentBrowserSkill(filePath: string): boolean {
  const parts = filePath.split(/[\\/]/);
  return parts.at(-1) === "SKILL.md" && parts.includes("agent-browser");
}

/** 判断是否代理消费文档：AGENTS.override.md / AGENTS.md / CLAUDE.md /
 * SKILL.md（basename 匹配，兼容 / 与 \ 分隔符，不锁绝对路径）。
 * writing-for-agents 技能自己的 SKILL.md 排除：读它自己时再建议激活
 * 它自己是冗余（组件匹配语义，与其余 matches 一致） */
export function isAgentsDocPath(filePath: string): boolean {
  const parts = filePath.split(/[\\/]/);
  const base = parts.at(-1);
  if (base === "SKILL.md") {
    return !parts.includes("writing-for-agents");
  }
  return base === "AGENTS.md" || base === "AGENTS.override.md" || base === "CLAUDE.md";
}

/** 提醒注册表（数据驱动：新增提醒在此追加；投递管线见 index.ts） */
export const SKILL_REMINDERS: readonly SkillReminder[] = [
  {
    id: "agent-browser",
    skillName: "agent-browser",
    matches: isAgentBrowserSkill,
    items: [
      "本文件只是发现桩：后续运行 `agent-browser skills get <name>` 获取实际工作流内容时，终端输出必须完整读取；输出被截断（超过 2000 行或 50KB）时，改为完整读取截断提示中给出的落盘临时文件，禁止基于部分内容开工。",
      "涉及登录的会话，用 `--session <名> --restore` 自动保存/恢复登录态，或登录后 `state save <路径>` 导出快照；供后续复用，避免重复登录。",
    ],
  },
  {
    id: "writing-for-agents",
    format: "prose",
    tone: "suggest",
    matches: isAgentsDocPath,
    requiresPath: findWritingForAgentsSkill,
    items: [
      "本文件是给代理消费的文档（AGENTS.md/CLAUDE.md/SKILL.md），修改前建议先激活 writing-for-agents 技能（读取 {skill-path}）；改技能时另读同目录 SKILL-MECHANICS.md。",
    ],
  },
];

/** 命中技能文件的全部提醒（read 通道；无命中返回空数组） */
export function collectReminders(filePath: string): SkillReminder[] {
  return SKILL_REMINDERS.filter((reminder) => reminder.matches(filePath));
}

/** 命中技能命令名的全部提醒（input 通道；无命中返回空数组） */
export function collectRemindersBySkillName(skillName: string): SkillReminder[] {
  return SKILL_REMINDERS.filter((reminder) => reminder.skillName === skillName);
}

/** 渲染 LLM 注入段。标题随 tone：must = 专项提醒（自动注入，须遵守），
 * suggest = 建议（自动注入）；list 形态编号条目，prose 形态单段正文。
 * skillPath 传入时替换正文 {skill-path} 占位符。段间分隔由组装方统一加 */
export function renderReminderSection(reminder: SkillReminder, skillPath?: string): string {
  const header =
    reminder.tone === "suggest"
      ? `**${reminder.id} 建议（自动注入）**`
      : `**${reminder.id} 专项提醒（自动注入，须遵守）**`;
  const fill = (item: string): string =>
    skillPath === undefined ? item : item.replaceAll("{skill-path}", skillPath);
  if (reminder.format === "prose") {
    return `${header}：${reminder.items.map(fill).join("\n")}`;
  }
  const items = reminder.items.map((item, index) => `${index + 1}. ${fill(item)}`);
  return `${header}：\n${items.join("\n")}`;
}

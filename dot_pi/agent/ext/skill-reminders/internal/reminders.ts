/**
 * 技能专项提醒注册表（skill-reminders 包内纯库，2026-09-19 自 better-skill 的
 * internal/skill-content.ts 迁出并组件化）
 *
 * 一条提醒 = 一个注册项：命中判断 + 条目正文。新增提醒只需在 SKILL_REMINDERS
 * 追加一条，不改投递管线（index.ts）；同一技能的多条提醒并入该条目的 items
 * （渲染为编号列表），不新开注册项。渲染器保证 LLM 注入段与 TUI 通知展开
 * 态共用同一份条目正文（单一来源，改条目即两处同步）。
 *
 * 命中判断入参为技能文件路径：read 通道为 input.path 原样值（可能带 ~ 前缀），
 * skill 工具通道为结果 details.path（绝对路径）；匹配按路径组件，不锁绝对
 * 路径（技能目录受 npx skills 管理重装迁移后仍生效）。
 */

/** 一条技能专项提醒 */
export interface SkillReminder {
  /** 提醒标识（渲染进 LLM 段标题与 TUI 通知，如 "agent-browser"） */
  id: string;
  /** 命中判断：入参为技能文件路径 */
  matches: (filePath: string) => boolean;
  /** 提醒条目（LLM 注入段与 TUI 通知展开态共用，单一来源） */
  items: readonly string[];
}

/** 判断是否 agent-browser 技能的 SKILL.md：basename 为 SKILL.md 且路径组件含
 * agent-browser（兼容 / 与 \ 分隔符，不锁绝对路径） */
export function isAgentBrowserSkill(filePath: string): boolean {
  const parts = filePath.split(/[\\/]/);
  return parts.at(-1) === "SKILL.md" && parts.includes("agent-browser");
}

/** 提醒注册表（数据驱动：新增提醒在此追加；投递管线见 index.ts） */
export const SKILL_REMINDERS: readonly SkillReminder[] = [
  {
    id: "agent-browser",
    matches: isAgentBrowserSkill,
    items: [
      "本文件只是发现桩：后续运行 `agent-browser skills get <name>` 获取实际工作流内容时，终端输出必须完整读取；输出被截断（超过 2000 行或 50KB）时，改为完整读取截断提示中给出的落盘临时文件，禁止基于部分内容开工。",
      "涉及登录的会话，用 `--session <名> --restore` 自动保存/恢复登录态，或登录后 `state save <路径>` 导出快照；供后续复用，避免重复登录。",
    ],
  },
];

/** 命中技能文件的全部提醒（无命中返回空数组） */
export function collectReminders(filePath: string): SkillReminder[] {
  return SKILL_REMINDERS.filter((reminder) => reminder.matches(filePath));
}

/** 渲染 LLM 注入段：`**<id> 专项提醒（自动注入，须遵守）**：` + 编号条目；
 * 段间分隔由组装方统一加 */
export function renderReminderSection(reminder: SkillReminder): string {
  const items = reminder.items.map((item, index) => `${index + 1}. ${item}`);
  return `**${reminder.id} 专项提醒（自动注入，须遵守）**：\n${items.join("\n")}`;
}

/** 渲染 TUI 通知载荷（appendEntry data）：摘要 + 展开态条目全文 */
export function renderReminderNotice(reminder: SkillReminder): { notice: string; lines: string[] } {
  return {
    notice: `[自动注入] 技能专项提醒：${reminder.id}`,
    lines: [...reminder.items],
  };
}

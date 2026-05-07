/**
 * Skill overrides plugin for OpenCode.ai
 *
 * 将 default.md agent 配置中的 "Skill 使用规则覆写" 段落剥离至此插件。
 * 仅在 brainstorming / writing-plans skill 被激活时注入覆写内容。
 *
 * 机制：拦截 skill 工具执行结果，追加覆写至 output.output。
 */

import type { Plugin } from "@opencode-ai/plugin";

// ----- 覆写内容（原样迁移自 agents/default.md） -----

const BRAINSTORMING_OVERRIDE = [
  "",
  "## Skill 覆写：brainstorming",
  "",
  "1. 设计文档用中文。caveman 激活则从之。",
  "2. 以 question 工具发问。宜一次多问，可多轮至无疑。",
  "3. 自审改为：",
  "   - 读 brainstorming Skill 之 spec-document-reviewer-prompt.md。",
  "   - 用此提示词启动 general 子 Agent 自审。",
  "   - 发现问题则修复，修复后以相同提示词再启子 Agent。",
   "   - 循环至无问题，不限轮数。",
   "",
].join("\n");

const WRITING_PLANS_OVERRIDE = [
  "",
  "## Skill 覆写：writing-plans",
  "",
  "1. 计划文档用中文。caveman 激活则从之。",
  '2. 单步代码量过大时，以“接口 + 思路”形式呈现。',
  "3. 自审改为：",
  "   - 读 writing-plans Skill 之 plan-document-reviewer-prompt.md。",
  "   - 用此提示词启动 general 子 Agent 自审。",
  "   - 发现问题则修复，修复后以相同提示词再启子 Agent。",
  "   - 循环至无问题，不限轮数。",
   "4. 默认子代理驱动执行。仅当用户明确要求内联时方用内联。",
  "",
].join("\n");

const SKILL_OVERRIDES: Record<string, string> = {
  brainstorming: BRAINSTORMING_OVERRIDE,
  "writing-plans": WRITING_PLANS_OVERRIDE,
};

// ----- 插件入口 -----

export const SkillOverridesPlugin: Plugin = async () => ({
  "tool.execute.after": async (input, output) => {
    // 仅拦截 skill 工具
    if (input.tool !== "skill") return;

    // 提取技能名称
    const args = input.args as Record<string, unknown> | undefined;
    const skillName = typeof args?.name === "string" ? args.name : undefined;
    if (!skillName) return;

    // 查找对应覆写
    const override = SKILL_OVERRIDES[skillName];
    if (!override) return;

    // 追加至工具输出
    output.output = (output.output ?? "") + override;
  },
});

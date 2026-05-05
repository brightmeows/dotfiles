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
  "## Skill 使用规则覆写: brainstorming",
  "",
  "1. 使用中文编写设计文档。如果 `caveman` 已激活，跟随其风格。",
  '2. "自审"步骤修改为：',
  "   - 读取 `brainstorming` Skill 的 `spec-document-reviewer-prompt.md` 提示词。",
  "   - 使用这个提示词，启动 `general` 子 Agent 进行自审。",
  "   - 如果发现问题，修复所有发现的问题。修复完成后，再次使用**相同提示词**启动子 Agent。",
  "   - 如此循环，直至所有问题被解决。不限制循环轮数。",
  "3. 禁止将设计文档提交至仓库。",
  "",
].join("\n");

const WRITING_PLANS_OVERRIDE = [
  "",
  "## Skill 使用规则覆写: writing-plans",
  "",
  "1. 使用中文编写计划文档。如果 `caveman` 已激活，跟随其风格。",
  '2. 对于单个实现步骤，如果代码量过大，考虑以"实现接口 + 实现思路"的形式呈现。',
  '3. "自审"步骤修改为：',
  "   - 读取 `writing-plans` Skill 的 `plan-document-reviewer-prompt.md` 提示词。",
  "   - 使用这个提示词，启动 `general` 子 Agent 进行自审。",
  "   - 如果发现问题，修复所有发现的问题。修复完成后，再次使用**相同提示词**启动子 Agent。",
  "   - 如此循环，直至所有问题被解决。不限制循环轮数。",
  "4. 禁止将计划文档提交至仓库。",
  "5. 不要询问用户如何执行计划，而是自主判断：",
  "   - 如果你的上下文大小为 256K 及以下，优先选择\"子代理驱动\"。",
  "   - 如果你的上下文大小为 1M 及以上，优先选择\"内联执行\"。",
  "   判断完成后，直接选择，不要停下来询问。",
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

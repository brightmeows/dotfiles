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
  "1. 设计文档用中文。",
  "2. 用 question 工具提问，一次多问几轮直到没有疑问。",
  "3. 自审方式：",
  "   - 读取 brainstorming Skill 的 spec-document-reviewer-prompt.md。",
  "   - 用这段提示词启动 general 子 Agent 进行自审。",
  "   - 发现则修复，修复后再次启动子 Agent 重复检查。",
  "   - 循环直到无问题。",
  "",
].join("\n");

const WRITING_PLANS_OVERRIDE = [
  "",
  "## Skill 覆写：writing-plans",
  "",
  "1. 计划文档用中文。",
  "2. 单步代码量过大时，用“接口 + 思路”的形式呈现。",
  "3. 自审方式：",
  "   - 读取 writing-plans Skill 的 plan-document-reviewer-prompt.md。",
  "   - 用这段提示词启动 general 子 Agent 进行自审。",
  "   - 发现则修复，修复后再次启动子 Agent 重复检查。",
  "   - 循环直到无问题。",
  "",
].join("\n");

const SUBAGENT_DRIVEN_DEVELOPMENT_OVERRIDE = [
  "",
  "## Skill 覆写：subagent-driven-development",
  "",
  "1. 规格审查与代码审查并行。",
  "",
].join("\n");

const FINISHING_A_DEVELOPMENT_BRANCH_OVERRIDE = [
  "",
  "## Skill 覆写：finishing-a-development-branch",
  "",
  "1. 建PR前检查清单：",
  "   - 设计/计划文档已移除",
  "   - 当前分支干净，无未提交/未推送内容",
  "",
].join("\n");

const SKILL_OVERRIDES: Record<string, string> = {
  brainstorming: BRAINSTORMING_OVERRIDE,
  "writing-plans": WRITING_PLANS_OVERRIDE,
  "subagent-driven-development": SUBAGENT_DRIVEN_DEVELOPMENT_OVERRIDE,
  "finishing-a-development-branch": FINISHING_A_DEVELOPMENT_BRANCH_OVERRIDE,
};

// ----- 插件入口 -----

export const SkillOverridesPlugin: Plugin = async () => ({
  "tool.execute.after": async (input, output) => {
    // 仅拦截 skill 工具
    if (input.tool !== "skill") {
      return;
    }

    // 提取技能名称
    const args = input.args as Record<string, unknown> | undefined;
    const skillName = typeof args?.["name"] === "string" ? args["name"] : undefined;
    if (!skillName) {
      return;
    }

    // 查找对应覆写
    const override = SKILL_OVERRIDES[skillName];
    if (!override) {
      return;
    }

    // 追加至工具输出
    output.output = (output.output ?? "") + override;
  },
});

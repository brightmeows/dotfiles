/**
 * Caveman plugin for OpenCode.ai
 *
 * 会话启动时自动激活 caveman skill（wenyan-full 挡位）。
 * 通过用户消息 transform 注入激活提示词。
 */

import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";
import type { Plugin } from "@opencode-ai/plugin";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 解析 skill 内容（去除前置元数据）
const parseSkillContent = (content: string): string => {
  const match = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return match ? match[1].trim() : content.trim();
};

// 常见 skills 根目录（按优先级排序）
const SKILL_SEARCH_DIRS = [
  // 插件同级目录（dev / 单文件部署）
  path.resolve(__dirname, "../../skills"),
  // opencode 配置目录
  path.resolve(__dirname, "../../.config/opencode/skills"),
  // ~/.agents/skills/
  path.join(os.homedir(), ".agents", "skills"),
  // ~/.config/opencode/skills/
  path.join(os.homedir(), ".config", "opencode", "skills"),
  // ~/.claude/skills/
  path.join(os.homedir(), ".claude", "skills"),
];

const findSkillPath = (skill: string): string | null => {
  for (const dir of SKILL_SEARCH_DIRS) {
    const p = path.join(dir, skill, "SKILL.md");
    if (fs.existsSync(p)) return p;
  }
  return null;
};

export const CavemanPlugin: Plugin = async ({}) => {
  const skillPath = findSkillPath("caveman");

  if (!skillPath) {
    console.warn("[caveman] skill not found in any search path — plugin disabled");
    console.warn("[caveman] searched:", SKILL_SEARCH_DIRS.map((d) => path.join(d, "caveman", "SKILL.md")));
    return {};
  }

  const skillContent = parseSkillContent(fs.readFileSync(skillPath, "utf8"));

  const bootstrap = `<INJECTED_CAVEMAN>
Caveman skill 内容如下：
${skillContent}
以上是 Caveman skill 的内容。

你现在已经激活 Caveman skill，并启用了 wenyan-full 压缩模式。额外要求：使用简体字。
</INJECTED_CAVEMAN>`;

  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      if (!output.messages.length) return;

      const firstUser = output.messages.find((m) => m.info.role === "user");
      if (!firstUser?.parts.length) return;

      // 仅注入一次
      if (
        firstUser.parts.some((p) =>
          p.type === "text" && p.text.includes("INJECTED_CAVEMAN")
        )
      ) return;

      firstUser.parts.unshift({ type: "text", text: bootstrap });
    },
  };
};

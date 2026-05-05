/**
 * Superpowers plugin for OpenCode.ai
 *
 * 会话启动时自动激活 using-superpowers skill。
 * 自动注册 skills 目录，无需手动创建符号链接。
 */

import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";
import type { Plugin } from "@opencode-ai/plugin";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 解析 skill 内容（去前置元数据）
const parseSkillContent = (content: string): { frontmatter: Record<string, string>; content: string } => {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, content: content.trim() };

  const frontmatter: Record<string, string> = {};
  for (const line of (match[1] ?? "").split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, "");
      frontmatter[key] = value;
    }
  }

  return { frontmatter, content: (match[2] ?? "").trim() };
};

// 常见 skills 根目录（按优先级序）
const SKILL_SEARCH_DIRS = [
  // 插件同級目录（dev / 单文件部署）
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

export const SuperpowersPlugin: Plugin = async ({}) => {
  const skillPath = findSkillPath("using-superpowers");

  if (!skillPath) {
    console.warn("[superpowers] 未找到 using-superpowers skill 于任意搜索路径——插件停用");
    console.warn("[superpowers] 已检索：", SKILL_SEARCH_DIRS.map((d) => path.join(d, "using-superpowers", "SKILL.md")));
    return {};
  }

  const { content } = parseSkillContent(fs.readFileSync(skillPath, "utf8"));

  const toolMapping = `工具映射（OpenCode 等价）：
- \`TodoWrite\` → \`todowrite\`
- \`Task\` + subagents → OpenCode @mention
- \`Skill\` → OpenCode \`skill\`
- \`Read\`/\`Write\`/\`Edit\`/\`Bash\` → 原生工具`;

  const bootstrap = `<INJECTED_USING_SUPERPOWERS>
已获 superpowers。

using-superpowers skill 已加载于下文。勿重复加载。

${content}

${toolMapping}
</INJECTED_USING_SUPERPOWERS>`;

  return {
    // 注入 skills 路径，使 OpenCode 能发现 superpowers skills（无需手动符号链接）
    config: async (config) => {
      const cfg = config as Record<string, unknown>;
      cfg.skills = (cfg.skills as Record<string, unknown>) ?? {};
      const skills = cfg.skills as Record<string, unknown>;
      skills.paths = (skills.paths as string[]) ?? [];
      const superpowersSkillsDir = path.resolve(__dirname, "../../skills");
      if (!(skills.paths as string[]).includes(superpowersSkillsDir)) {
        (skills.paths as string[]).push(superpowersSkillsDir);
      }
    },

    "experimental.chat.messages.transform": async (_input, output) => {
      if (!output.messages.length) return;

      const firstUser = output.messages.find((m) => m.info.role === "user");
      if (!firstUser?.parts.length) return;

      // 仅注入一次
      if (
        firstUser.parts.some((p) =>
          p.type === "text" && p.text.includes("INJECTED_USING_SUPERPOWERS")
        )
      ) return;

      firstUser.parts.unshift({ type: "text", text: bootstrap } as never);
    },
  };
};

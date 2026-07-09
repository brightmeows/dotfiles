/**
 * Superpowers plugin for OpenCode.ai
 *
 * 会话启动时自动激活 using-superpowers skill。
 * 自动注册 skills 目录，无需手动创建符号链接。
 *
 * 上游参考：https://github.com/obra/superpowers/blob/main/.opencode/plugins/superpowers.js
 */

import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import type { Plugin } from "@opencode-ai/plugin";

const dirname = path.dirname(fileURLToPath(import.meta.url));

/** 解析 skill 内容（去前置元数据） */
const parseSkillContent = (
  content: string,
): { frontmatter: Record<string, string>; content: string } => {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, content: content.trim() };
  }

  const frontmatter: Record<string, string> = {};
  for (const line of (match[1] ?? "").split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line
        .slice(colonIdx + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
      frontmatter[key] = value;
    }
  }

  return { frontmatter, content: (match[2] ?? "").trim() };
};

/** 常见 skills 根目录（按优先级序） */
const SKILL_SEARCH_DIRS = [
  // 插件同級目录（dev / 单文件部署）
  path.resolve(dirname, "../../skills"),
  // Opencode 配置目录
  path.resolve(dirname, "../../.config/opencode/skills"),
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
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
};

const superpowersSkillsDir = path.resolve(dirname, "../../skills");

/** 模块级缓存：SKILL.md 内容在 session 内只读一次，避免每步 agent 都读盘 */
let bootstrapCache: string | null | undefined; // 缓存状态：undefined=未加载 null=文件缺失 string=已缓存

export const SuperpowersPlugin: Plugin = async () => ({
  /** 注入 skills 路径，使 OpenCode 能发现 superpowers skills（无需手动符号链接） */
  config: async (config) => {
    const cfg = config as Record<string, unknown>;
    cfg["skills"] ??= {};
    const skills = cfg["skills"] as Record<string, unknown>;
    skills["paths"] ??= [];
    if (!(skills["paths"] as string[]).includes(superpowersSkillsDir)) {
      (skills["paths"] as string[]).push(superpowersSkillsDir);
    }
  },

  /**
   * 在首条用户消息注入 bootstrap 上下文。
   * 用 user message 而非 system message 避免：
   *   1. system message 每轮重复消耗 token
   *   2. 多条 system message 导致某些模型（Qwen 等）异常
   *
   * 钩子在每步都触发（opencode prompt.ts 每步重载消息），
   * 但 getBootstrapContent() 因模块级缓存不重复读盘。
   */
  "experimental.chat.messages.transform": async (_input, output) => {
    const bootstrap = getBootstrapContent();
    if (!bootstrap || !output.messages.length) {
      return;
    }

    const firstUser = output.messages.find((m) => m.info.role === "user");
    if (!firstUser?.parts.length) {
      return;
    }

    // 防重复注入（OpenCode 可能将已变换的消息数组再次传入此钩子）
    if (firstUser.parts.some((p) => p.type === "text" && p.text.includes("EXTREMELY_IMPORTANT"))) {
      return;
    }

    // 保留 part 的 id/messageID/sessionID 等元数据
    firstUser.parts.unshift({ type: "text", text: bootstrap } as never);
  },
});

/** 惰性加载并缓存 bootstrap 内容（模块级，session 间共享） */
function getBootstrapContent(): string | null {
  if (bootstrapCache !== undefined) {
    return bootstrapCache;
  }

  const skillPath = findSkillPath("using-superpowers");
  if (!skillPath) {
    console.warn("[superpowers] 未找到 using-superpowers skill——插件停用");
    console.warn(
      "[superpowers] 已检索：",
      SKILL_SEARCH_DIRS.map((d) => path.join(d, "using-superpowers", "SKILL.md")),
    );
    bootstrapCache = null;
    return null;
  }

  const fullContent = fs.readFileSync(skillPath, "utf8");
  const { content } = parseSkillContent(fullContent);

  const toolMapping = `当 skill 请求操作时，替换为 OpenCode 等价物：

**工具映射（OpenCode 等价）：**
- \`TodoWrite\` → \`todowrite\`
- \`Subagent (general-purpose)\` → \`task\` + \`subagent_type: "general"\`
- \`Skill\` → OpenCode \`skill\`
- \`Read\` → \`read\`
- \`Write\`/\`Edit\` → \`apply_patch\`
- \`Bash\` → \`bash\`
- \`Grep\`/\`Glob\` → \`grep\` / \`glob\`
- \`WebFetch\` → \`webfetch\``;

  bootstrapCache = `<EXTREMELY_IMPORTANT>
已启用 superpowers。

**using-superpowers skill 的内容已附加在下方，已加载，请勿重复加载。**

${content}

${toolMapping}
</EXTREMELY_IMPORTANT>`;

  return bootstrapCache;
}

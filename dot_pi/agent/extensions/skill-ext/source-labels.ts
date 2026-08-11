/**
 * 技能来源标签解析（skill-ext 拆分自原 skill-index-rewrite.ts）
 *
 * 从技能安装清单（~/.agents/.skill-lock.json v3 / 项目 skills-lock.json v1）
 * 建立 name → 来源仓库显示标签（host/owner/repo 形态）：
 * - local 类型 → LOCAL_LABEL
 * - sourceUrl 可解析 → "host/owner/repo"：域名形态不可能被模型误当成本地
 *   路径段拼接（任何本地路径不会以 xxx.com/ 开头）
 * - github 类型无 sourceUrl（项目 lock v1 的特征）→ 短标识补 github.com 域名；
 *   ssh（git@host:path）与 URL 形式解析为 host/path
 * - 项目级 lock 从 cwd 向上逐层查找（与 Pi 收集祖先 .agents/skills 的行为
 *   对称），近 → 远合并，近者优先
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** 技能安装清单（全局，~/.agents/.skill-lock.json，v3；项目级 skills-lock.json，v1） */
const LOCK_FILE = join(homedir(), ".agents", ".skill-lock.json");

/** 安装清单无记录的技能来源标签 */
export const LOCAL_LABEL = "本地";

/** 安装清单读取失败时所有技能的来源标签 */
export const UNKNOWN_LABEL = "未知（lock 读取失败）";

/** 安装清单的 skills 字段条目结构 */
export interface LockSkillEntry {
  source?: string;
  sourceUrl?: string;
  sourceType?: string;
}

/** 从 URL 字符串解析 host/owner/repo 形态（去 .git）；非 URL 返回 null */
function parseHostRepo(urlLike: string): string | null {
  try {
    const u = new URL(urlLike);
    const path = u.pathname.replace(/^\/+/, "").replace(/\.git$/, "");
    if (u.hostname && path) {
      return `${u.hostname}/${path}`;
    }
  } catch {
    // 非 URL
  }
  return null;
}

/**
 * 从 lock 条目派生来源仓库显示标签：
 * - local 类型 → LOCAL_LABEL
 * - sourceUrl 可解析 → "host/owner/repo"：域名形态不可能被模型误当成本地
 *   路径段拼接（任何本地路径不会以 xxx.com/ 开头）
 * - github 类型无 sourceUrl（项目 lock v1 的特征）→ 短标识补 github.com 域名；
 *   ssh（git@host:path）与 URL 形式解析为 host/path
 */
function deriveSourceLabel(info: LockSkillEntry): string | null {
  if (info.sourceType === "local") {
    return LOCAL_LABEL;
  }
  if (info.sourceUrl) {
    const fromUrl = parseHostRepo(info.sourceUrl);
    if (fromUrl) {
      return fromUrl;
    }
  }
  if (info.source) {
    const s = info.source.replace(/\.git$/, "");
    if (info.sourceType === "github") {
      const fromUrl = parseHostRepo(s);
      if (fromUrl) {
        return fromUrl;
      }
      const ssh = s.match(/^git@([^:]+):(.+)$/);
      if (ssh) {
        return `${ssh[1]}/${ssh[2]}`;
      }
      if (!s.includes("://") && !s.startsWith("ssh://") && s.split("/").length === 2) {
        return `github.com/${s}`;
      }
    }
    return s;
  }
  return null;
}

/**
 * 读取项目级 lock（npx skills 项目安装时在项目根创建 skills-lock.json，v1）。
 * 从 cwd 向上逐层查找（与 Pi 收集祖先 .agents/skills 的行为对称），近 → 远
 * 合并，近者优先（调用方再覆盖全局 map）。
 */
export function loadProjectSourceMap(cwd: string): Map<string, string> {
  const map = new Map<string, string>();
  let dir = cwd;
  while (true) {
    try {
      const raw = readFileSync(join(dir, "skills-lock.json"), "utf8");
      const data = JSON.parse(raw) as { skills?: Record<string, LockSkillEntry> };
      if (data.skills) {
        for (const [name, info] of Object.entries(data.skills)) {
          const label = deriveSourceLabel(info);
          if (label && !map.has(name)) {
            map.set(name, label);
          }
        }
      }
    } catch {
      // 无 lock 或解析失败，继续向上查找
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return map;
}

/**
 * 读取 .skill-lock.json，建立 name → 来源仓库标签映射。
 * 文件不存在或解析失败时返回 ok:false，调用方据 fallback 标签区分。
 */
export function loadSourceMap(): { map: Map<string, string>; ok: boolean } {
  try {
    const raw = readFileSync(LOCK_FILE, "utf8");
    const data = JSON.parse(raw) as { skills?: Record<string, LockSkillEntry> };
    const map = new Map<string, string>();
    if (data.skills) {
      for (const [name, info] of Object.entries(data.skills)) {
        const label = deriveSourceLabel(info);
        if (label) {
          map.set(name, label);
        }
      }
    }
    return { map, ok: true };
  } catch {
    return { map: new Map(), ok: false };
  }
}

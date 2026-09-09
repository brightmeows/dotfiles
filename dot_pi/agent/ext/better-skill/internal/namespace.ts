/**
 * 技能名空间（better-skill 包内纯库，2026-09-01 新增）
 *
 * 全局唯一技能名空间的构建与查询（2026-09-01 主人确认的设计）：
 * - 覆盖范围：主技能（systemPromptOptions.skills，disableModelInvocation 已
 *   由调用方过滤）与嵌套子技能（各技能根整树扫描，复用 skill-content 的
 *   扫描逻辑）。子技能与主技能共用一个名空间，可调用名全局唯一。
 * - 构建时机（Q7）：before_agent_start 时 diff 本轮技能文件路径集合与进程
 *   缓存，不一致才全量重建（启动预扫描）；session_start（含 /reload）清
 *   缓存。技能内容热改不触发重扫（与 Pi 技能收集同为启动时行为），改技能
 *   后 /reload 生效。
 * - 唯一性与别名（Q6/D11）：注册序先主后子——主技能按项目级（cwd 内）>
 *   ~/.agents/skills > ~/.pi/agent/skills > 其他注入路径、同级路径字母序；
 *   子技能按宿主主技能处理序。先注册者保原名，冲突者得别名 `原名@宿主标
 *   识`：子技能用宿主主技能原名，主技能用所在技能目录派生短标（路径去
 *   home 前缀与末尾 skills 段，剩余段连字符连接，空回落 local）。@ 不在
 *   技能名字符集（kebab-case），别名与真名、别名与别名结构性不碰撞。
 * - 名字取值（D14）：frontmatter name 优先、路径锚回落（子技能目录名 /
 *   散布文件 stem），由 skill-content 的扫描统一产出；收录条件不变。
 * - 消歧知情（D12）：每次重建产生的消歧记录返回给调用方，由调用方投递
 *   TUI 通知（本模块保持纯库、不持 pi 引用）。
 * - 查询（D13）：resolveDisplayName 路径反查显示名；lookupName 按可调用名
 *   精确查条目（skill 工具参数解析）；listCallableNames 全量可调用名
 *   （错误信息自纠用）。
 *
 * 已知边界（红队接受项）：同名真冲突技能（不同目录同名）在映射中各占
 * 一键（原名与别名），索引与工具行为一致；技能内容热改的子技能增删不
 * 感知（见构建时机）。
 *
 * 只读红线：扫描纯只读，不回写任何技能目录文件。
 */

import { homedir } from "node:os";
import { dirname, join, sep } from "node:path";
import { walkNestedSkills, type NestedSkillEntry } from "./skill-content.ts";

/** 名空间构建输入：主技能条目的最小结构（Pi Skill 的子集，结构兼容） */
export interface NamespaceSkillInput {
  name: string;
  filePath: string;
}

/** 名空间条目 */
export interface NamespaceEntry {
  /** 可调用名（原名或消歧别名） */
  callableName: string;
  /** 技能文件绝对路径（root 为 SKILL.md，nested 为子技能文件） */
  filePath: string;
  kind: "root" | "nested";
}

/** 一次重名消歧记录（供调用方投递 TUI 通知） */
export interface NameConflict {
  /** 冲突原名 */
  name: string;
  /** 保名方技能目录（~ 形式展示） */
  winnerDir: string;
  /** 消歧方技能目录（~ 形式展示） */
  loserDir: string;
  /** 消歧后的可调用名 */
  alias: string;
}

const USER_AGENTS_DIR = join(homedir(), ".agents", "skills");
const USER_PI_DIR = join(homedir(), ".pi", "agent", "skills");

/** 主目录前缀替换为 ~（通知展示用） */
function shortenHome(p: string): string {
  const home = homedir();
  return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

/** 主技能注册级别：项目（cwd 内）> ~/.agents/skills > ~/.pi/agent/skills >
 * 其他注入路径（D11 注册序，同级再按路径字母序） */
function levelOf(dir: string, cwd: string): number {
  if (dir === cwd || dir.startsWith(`${cwd}${sep}`)) {
    return 0;
  }
  if (dir === USER_AGENTS_DIR) {
    return 1;
  }
  if (dir === USER_PI_DIR) {
    return 2;
  }
  return 3;
}

/** 主技能消歧宿主标识：路径去 home 前缀与末尾 skills 段，剩余段连字符
 * 连接；空回落 local（D11）。例：~/.agents/skills → .agents；
 * ~/.pi/agent/skills → .pi-agent；~/Codes/dotfiles/.pi/skills →
 * Codes-dotfiles-.pi（home 后全路径段连接） */
function dirAlias(dir: string): string {
  const home = homedir();
  const withoutHome = dir.startsWith(home) ? dir.slice(home.length) : dir;
  const segments = withoutHome
    .split(sep)
    .map((s) => s.replace(/^-+|-+$/g, ""))
    .filter((s) => s.length > 0);
  if (segments.at(-1) === "skills") {
    segments.pop();
  }
  const joined = segments.join("-");
  return joined.length > 0 ? joined : "local";
}

// ---- 会话内缓存（session_start 清空；before_agent_start diff 重建）----

let byName = new Map<string, NamespaceEntry>();
let byPath = new Map<string, string>();
let cacheKey: string | null = null;

/** 清空名空间缓存（session_start 调用，含 /reload；下次构建全量重扫） */
export function resetNamespaceCache(): void {
  cacheKey = null;
  byName = new Map();
  byPath = new Map();
}

/**
 * 就绪名空间：技能文件路径集合与缓存一致时跳过（diff 缓存，D12）；不一
 * 致全量重建——主技能按注册序登记，再逐技能根整树扫描子技能登记；先注
 * 册者保原名，冲突者得别名（Q6 自动消歧）。返回本次重建产生的消歧记录
 * （缓存命中时为空数组），由调用方投递通知。
 */
export function ensureNamespace(
  skills: readonly NamespaceSkillInput[],
  cwd: string,
): { conflicts: NameConflict[] } {
  const key = skills
    .map((s) => s.filePath)
    .toSorted()
    .join("\n");
  if (cacheKey === key) {
    return { conflicts: [] };
  }
  cacheKey = key;
  byName = new Map();
  byPath = new Map();
  const conflicts: NameConflict[] = [];

  /** 登记参数（对象收拢，避免超长参数列表） */
  interface RegisterArgs {
    name: string;
    filePath: string;
    kind: NamespaceEntry["kind"];
    hostBase: string;
    dirForNotice: string;
  }

  /** 登记一个名字；冲突时生成别名并记录消歧（先到者保名，D11） */
  const register = ({ name, filePath, kind, hostBase, dirForNotice }: RegisterArgs): void => {
    const existing = byName.get(name);
    if (!existing) {
      byName.set(name, { callableName: name, filePath, kind });
      byPath.set(filePath, name);
      return;
    }
    // 别名与真名、别名与别名结构性不碰撞（@ 不在技能名字符集），序号
    // 兜底仅为防御宿主标识派生异常
    let alias = `${name}@${hostBase}`;
    let n = 2;
    while (byName.has(alias)) {
      alias = `${name}@${hostBase}-${n}`;
      n += 1;
    }
    byName.set(alias, { callableName: alias, filePath, kind });
    byPath.set(filePath, alias);
    // 目录粒度按条目类型：root 取技能目录（SKILL.md 上两级），nested 取
    // 文件所在目录（上一级），与 loserDir 同构
    const winnerDirPath =
      existing.kind === "root" ? dirname(dirname(existing.filePath)) : dirname(existing.filePath);
    conflicts.push({
      name,
      winnerDir: shortenHome(winnerDirPath),
      loserDir: shortenHome(dirForNotice),
      alias,
    });
  };

  // 主技能：注册序排序后登记（级别，路径字母序）
  const roots = [...skills].toSorted(
    (a, b) =>
      levelOf(dirname(dirname(a.filePath)), cwd) - levelOf(dirname(dirname(b.filePath)), cwd) ||
      a.filePath.localeCompare(b.filePath),
  );
  for (const s of roots) {
    const dir = dirname(dirname(s.filePath));
    register({
      name: s.name,
      filePath: s.filePath,
      kind: "root",
      hostBase: dirAlias(dir),
      dirForNotice: dir,
    });
  }

  // 子技能：宿主序逐根整树扫描，宿主标识 = 宿主主技能原名（D11）
  for (const s of roots) {
    const list: NestedSkillEntry[] = [];
    walkNestedSkills(dirname(s.filePath), s.filePath, list);
    for (const e of list) {
      register({
        name: e.name,
        filePath: e.filePath,
        kind: "nested",
        hostBase: s.name,
        dirForNotice: dirname(e.filePath),
      });
    }
  }

  return { conflicts };
}

/** 路径反查可调用名（清单显示名）；未注册回落调用方给的名字 */
export function resolveDisplayName(filePath: string, fallbackName: string): string {
  return byPath.get(filePath) ?? fallbackName;
}

/** 按可调用名精确查条目（skill 工具参数解析） */
export function lookupName(name: string): NamespaceEntry | undefined {
  return byName.get(name);
}

/** 全量可调用名（字母序；skill 工具错误信息自纠用） */
export function listCallableNames(): string[] {
  return [...byName.keys()].toSorted((a, b) => a.localeCompare(b));
}

/**
 * 技能路径规范化与目录收集（better-skill 拆分自原 skill-index-rewrite.ts）
 *
 * 展示路径规范化（避免 symlink / 旧安装问题）：
 * - Pi 收集技能按 realpath 去重、先到先得：~/.pi/agent/skills 下的
 *   symlink 镜像先扫到，展示路径会落在 symlink 上，清理/重装后易失效。
 * - 渲染前对 filePath 做规范化：技能位于非规范目录时，若规范目录
 *   （项目 .agents/skills、祖先链 .agents/skills、~/.agents/skills）存在同名
 *   技能且 realpath 一致（同一文件的镜像），展示路径改用规范目录。
 *   .pi/skills 系列（用户 ~/.pi/agent/skills、项目 <cwd>/.pi/skills）均
 *   非规范目录：用户级与项目级统一以 .agents/skills 为规范优先。
 * - realpath 不一致（同名真冲突）或不可解析时保持 Pi 原路径，绝不
 *   把提示词路径指向别的文件内容。
 * - 分组排序：项目级目录优先于全局（判定在 index-rewrite.ts 侧：cwd 前缀
 *   为主、本模块收集的 .pi/skills / 祖先 .agents/skills 白名单作并集）；同级别
 *   内 .agents/skills 组先于 .pi/skills 组，再按技能数量降序。
 */

import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

/** 用户级规范技能目录：真实安装位置优先于 symlink 镜像目录 */
export const CANONICAL_USER_DIRS = [join(homedir(), ".agents", "skills")];

/** 项目级目录集合：sort 供排序判断，canon 供路径重映射 */
export interface ProjectSkillDirs {
  /** 项目级目录全集（排序用）：<cwd>/.pi/skills + 祖先链 .agents/skills（排除
   *  ~/.agents/skills）。Pi 当前版本（2026-08-13 实测）不再扫描这些目录
   *  （loadSkills 走 includeDefaults: false），收集仅作防御：Pi 若恢复祖先
   *  扫描，白名单并集仍可正确归类 */
  sort: string[];
  /** 项目级规范目录（重映射目标）：仅祖先链 .agents/skills */
  canon: string[];
}

/**
 * 收集项目级技能目录（从近到远）：
 * - sort：<cwd>/.pi/skills + cwd 祖先链的 .agents/skills
 * - canon：仅祖先链 .agents/skills（.pi/skills 非规范目录，其技能若存在
 *   realpath 一致的 .agents/skills 镜像会被规范化）
 */
export function collectProjectSkillDirs(cwd: string): ProjectSkillDirs {
  const [userAgents] = CANONICAL_USER_DIRS;
  const sort: string[] = [join(cwd, ".pi", "skills")];
  const canon: string[] = [];
  let dir = cwd;
  while (true) {
    const agents = join(dir, ".agents", "skills");
    if (agents !== userAgents) {
      sort.push(agents);
      canon.push(agents);
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return { sort, canon };
}

/** 主目录前缀替换为 ~，提升可读性 */
export function shortenHome(p: string): string {
  const home = homedir();
  return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

/** ~ 前缀展开（shortenHome 的逆操作）：技能索引 group path 模板以 ~ 形式
 * 展示，模型可能照抄该形式发起 read，而 node fs 不展开 ~（readdirSync/
 * openSync 直接 ENOENT）；tool_result 拦截类模块在 fs 调用前展开 */
export function expandHome(p: string): string {
  if (p === "~") {
    return homedir();
  }
  if (p.startsWith("~/")) {
    return join(homedir(), p.slice(2));
  }
  return p;
}

/** 路径分组键：skills 目录（技能目录的上一层，绝对路径） */
export function pathGroupKey(filePath: string): string {
  return dirname(dirname(filePath));
}

/**
 * 展示路径规范化：技能位于非规范目录（如 ~/.pi/agent/skills、项目 .pi/skills
 * 的 symlink 镜像）时，若规范目录（项目 .agents/skills → ~/.agents/skills）
 * 存在同名技能且 realpath 一致（证明是同一文件），改用规范目录路径；
 * realpath 不一致（同名真冲突）或不可解析（断链）时保持原路径。
 */
export function canonicalSkillFilePath(filePath: string, canonDirs: string[]): string {
  const groupDir = dirname(dirname(filePath));
  if (canonDirs.includes(groupDir)) {
    return filePath;
  }
  const name = basename(dirname(filePath));
  let currentReal: string | null = null;
  try {
    currentReal = realpathSync(dirname(filePath));
  } catch {
    return filePath;
  }
  for (const dir of canonDirs) {
    const candidate = join(dir, name);
    if (!existsSync(join(candidate, "SKILL.md"))) {
      continue;
    }
    try {
      if (realpathSync(candidate) === currentReal) {
        return join(candidate, "SKILL.md");
      }
    } catch {
      // 候选不可解析，跳过
    }
  }
  return filePath;
}

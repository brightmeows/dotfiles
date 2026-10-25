/**
 * Pi 原生已加载上下文文件的内容指纹集（包内纯库，仅被本包入口 import；
 * 不依赖 pi 运行时，可用 node 独立单测）
 *
 * 复刻自 pi 1.4.0 的 dist/core/resource-loader.js（loadProjectContextFiles /
 * findShadowedContextFile / loadContextFileFromDir）与
 * dist/core/footer-data-provider.js（findGitPaths）；上游行为变更时对照更新。
 *
 * 目的：子目录规则文件的内容若已由 Pi 原生启动加载进系统提示词（agentDir
 * 全局一份 + cwd 祖先链每目录一份 + worktree shadow 规则），扩展不再重复
 * 注入——root 内嵌套 linked worktree（如 proj/.worktrees/wt）检出的副本与
 * 主树根规则文件内容相同时，原生已加载主树根那份，扩展再注入副本即重复；
 * 扩展自身去重集合不含原生那份，需此基准补齐。
 *
 * 与原生语义的对齐点（缺一会引入误判）：
 * - 候选名含大小写变体（AGENTS.MD / CLAUDE.MD）——扩展自身触发面
 *   （path-extract 的 CONTEXT_FILENAMES）不含变体，两处职责不同：这里管
 *   “原生加载了什么”，触发面管“扩展认哪些是子目录规则文件”
 * - shadow 按位置不按内容：cwd 在嵌套 worktree 内时，主树根同名文件被
 *   worktree 副本顶替不加载。不复刻 shadow 会把主树那份误算进基准集——
 *   当 worktree 副本为旧版本（与主树内容不同）时，与主树同内容的更深
 *   副本会被误跳过，而其内容实际不在系统提示词里（丢规则）
 * - 内容指纹按去 BOM 后计算：原生加载 stripBom，注入侧 readContent 同样
 *   去 BOM，两侧 hash 才可比
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

// ── 内容哈希（品牌类型，同内容多来源去重） ──

/** SHA256 十六进制摘要的品牌类型；仅由 hashOf 构造，禁止任意字符串冒充 */
export type Hash = string & { readonly __brand: "Hash" };

/** 计算内容的 sha256 摘要（唯一构造 Hash 的入口） */
export function hashOf(content: string): Hash {
  return createHash("sha256").update(content).digest("hex") as Hash;
}

/** 去掉开头 BOM（原生 stripBom 语义：上下文内容与 hash 均按去 BOM 口径） */
export function stripBom(content: string): string {
  return content.startsWith("\uFEFF") ? content.slice(1) : content;
}

/** 原生 loadContextFileFromDir 的候选名与优先序（比扩展触发面多大小写变体） */
const NATIVE_CONTEXT_CANDIDATES = [
  "AGENTS.override.md",
  "AGENTS.md",
  "AGENTS.MD",
  "CLAUDE.md",
  "CLAUDE.MD",
] as const;

/** 按 realpath 归一，失败回落原路径（原生 canonicalizePath 语义） */
function canonicalize(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/** 目录内按原生候选序选定的上下文文件（路径 + 去 BOM 内容）；无则 null */
function pickNativeContextFile(dir: string): { path: string; content: string } | null {
  for (const name of NATIVE_CONTEXT_CANDIDATES) {
    const candidate = path.join(dir, name);
    try {
      if (!fs.statSync(candidate).isFile()) {
        continue;
      }
      return { path: candidate, content: stripBom(fs.readFileSync(candidate, "utf8")) };
    } catch {
      // 定位或读取失败 → 原生会尝试下一候选
    }
  }
  return null;
}

/** 自 cwd 向上找到的 git 元数据（repoDir = .git 所在目录；commonGitDir 已按 commondir 文件解析） */
interface GitPaths {
  repoDir: string;
  commonGitDir: string;
}

/**
 * 解析 dir/.git 单点：undefined = 非 git 元数据形态（调用方继续向上），
 * null = 仓库但无效（原生语义：stat 失败/HEAD 缺失时放弃整棵树），
 * 对象 = 命中。与原生 findGitPaths 内层逐分支等价。
 */
function resolveGitPathsAt(gitPath: string, dir: string): GitPaths | null | undefined {
  try {
    const stat = fs.statSync(gitPath);
    if (stat.isFile()) {
      const content = fs.readFileSync(gitPath, "utf8").trim();
      if (!content.startsWith("gitdir: ")) {
        return undefined;
      }
      const gitDir = path.resolve(dir, content.slice(8).trim());
      if (!fs.existsSync(path.join(gitDir, "HEAD"))) {
        return null;
      }
      const commonDirPath = path.join(gitDir, "commondir");
      const commonGitDir = fs.existsSync(commonDirPath)
        ? path.resolve(gitDir, fs.readFileSync(commonDirPath, "utf8").trim())
        : gitDir;
      return { repoDir: dir, commonGitDir };
    }
    if (stat.isDirectory()) {
      if (!fs.existsSync(path.join(gitPath, "HEAD"))) {
        return null;
      }
      return { repoDir: dir, commonGitDir: gitPath };
    }
    return undefined;
  } catch {
    return null;
  }
}

/**
 * 复刻原生 findGitPaths：自 cwd 向上找最近 .git，兼容普通仓库（.git 目录）
 * 与 linked worktree（.git 文件，gitdir: 指向 <主仓库>/.git/worktrees/<名>，
 * 其 commondir 文件指回主仓库 .git）。
 */
function findGitPaths(cwd: string): GitPaths | null {
  let dir = cwd;
  for (;;) {
    const gitPath = path.join(dir, ".git");
    if (fs.existsSync(gitPath)) {
      const resolved = resolveGitPathsAt(gitPath, dir);
      if (resolved !== undefined) {
        return resolved;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

/**
 * 复刻原生 findShadowedContextFile：cwd 位于主仓库树内的嵌套 linked
 * worktree 时，worktree 根自己的上下文文件与主树根同名文件同属一个逻辑
 * 仓库作用域，主树根那份被 shadow（不加载）。返回被 shadow 的文件路径
 * （canonical 主树根 + worktree 副本同名文件名）；无 shadow 语义时
 * undefined。bare 布局（.bare + 检出目录）与 submodule（gitdir 在
 * .git/modules 下）均不满足“主树根/.git 即 commonGitDir”，自然排除。
 */
function findShadowedContextFile(cwd: string): string | undefined {
  const gitPaths = findGitPaths(cwd);
  if (gitPaths === null) {
    return undefined;
  }
  const commonGitDir = canonicalize(gitPaths.commonGitDir);
  const worktreeRoot = canonicalize(gitPaths.repoDir);
  const mainRepoRoot = path.dirname(commonGitDir);
  // 普通仓库（两目录相同）与平级 worktree（主树非祖先）均无 shadow
  if (!worktreeRoot.startsWith(`${mainRepoRoot}${path.sep}`)) {
    return undefined;
  }
  // 主树根/.git 必须正是 commonGitDir（排除 bare 布局与 submodule）
  if (canonicalize(path.join(mainRepoRoot, ".git")) !== commonGitDir) {
    return undefined;
  }
  const worktreeContextFile = pickNativeContextFile(worktreeRoot);
  return worktreeContextFile === null
    ? undefined
    : path.join(mainRepoRoot, path.basename(worktreeContextFile.path));
}

/**
 * 收集 Pi 原生启动加载进系统提示词的上下文内容指纹集：agentDir 全局一份 +
 * 自 cwd 向上至文件系统根每目录一份（shadow 判定剔除）。cwd 传 pi 给出的
 * 原始值（不预 realpath，与原生 resolvePath(cwd) 口径对齐；shadow 比较时
 * 才 canonicalize）。结果与顺序无关，仅内容集合。
 */
export function collectNativeContextHashes(cwd: string, agentDir: string): Set<Hash> {
  const hashes = new Set<Hash>();
  const globalFile = pickNativeContextFile(agentDir);
  if (globalFile !== null) {
    hashes.add(hashOf(globalFile.content));
  }
  const shadowed = findShadowedContextFile(cwd);
  let currentDir = path.resolve(cwd);
  for (;;) {
    const picked = pickNativeContextFile(currentDir);
    if (
      picked !== null &&
      (shadowed === undefined ||
        path.join(canonicalize(currentDir), path.basename(picked.path)) !== shadowed)
    ) {
      hashes.add(hashOf(picked.content));
    }
    const parent = path.dirname(currentDir);
    if (parent === currentDir) {
      break;
    }
    currentDir = parent;
  }
  return hashes;
}

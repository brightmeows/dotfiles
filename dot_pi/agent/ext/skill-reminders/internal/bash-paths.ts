/**
 * 包内纯库：bash 命令路径提取（仅被本包入口 import；不依赖 pi 运行时，
 * 可用 node 独立单测）
 *
 * 自 subdir-agents-md/internal/path-extract.ts 改编的副本（各包自包含、
 * 副本间无同步义务），差异：
 * - 白名单追加纯读取命令（cat/head/tail/wc）：本包语义下 cat 读代理文档
 *   是高频真实场景，参数即路径无模式误报问题；rg/grep 仍排除（首个参数
 *   是模式，无法与路径区分，沿用原库教训）
 * - rel === "" 仍跳过但语义不同：原库因"根规则文件由 Pi 原生加载"，本包
 *   因创建类目标回落到 cwd 自身（root 非文档）无提取价值
 * - 不含锚点/规则文件查找逻辑（本包按 basename 匹配，不按目录管辖）
 *
 * 原库设计（2026-09-26 受控白名单版）：2026-09-14 曾因全 token 扫描把
 * rg/grep 的模式与参数误当访问路径而整体砍掉。现仅识别白名单文件操作
 * 命令，分段 + 包装命令跳过 + 存在性过滤三重约束。本库只用 node 内建
 * 模块，不 spawn 外部命令：部署区无 node_modules，glob 与 $VAR 路径按
 * 漏报处理，不展开。
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** 展开 ~ 与 ~/ 前缀（path.resolve 不处理波浪号） */
export function expandHome(p: string): string {
  if (p === "~") {
    return os.homedir();
  }
  if (p.startsWith("~/")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

/** 用 realpath 归一（symlink 解析到真实树）；目标不存在时回落原路径（write 目标场景） */
export function realpathOr(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/** Current 是否等于 root 或位于其下（严格前缀匹配，避免 /proj-x 误判 /proj） */
function withinRoot(current: string, root: string): boolean {
  return current === root || current.startsWith(root + path.sep);
}

/** 白名单文件操作命令（basename 匹配）；搜索类（rg/grep）刻意不收 */
const BASH_FILE_CMDS = new Set([
  "cat",
  "head",
  "tail",
  "wc",
  "cp",
  "mv",
  "rm",
  "rmdir",
  "mkdir",
  "touch",
  "ln",
  "install",
  "rsync",
  "tar",
  "sed",
  "chmod",
  "chown",
]);

/** 会创建目标的命令：目标不存在时回落到最深已存在祖先目录（mkdir -p / cp 新目标） */
const BASH_CREATORS = new Set(["mkdir", "touch", "ln", "cp", "mv", "install"]);

/** 命令包装器：跳过其自身与选项后再取真实命令（sudo -u root rm …） */
const BASH_WRAPPERS = new Set(["sudo", "command", "nice", "nohup", "time", "env", "exec"]);

/** 去除 token 首尾成对引号（无引号级 shell 解析，尽力而为） */
function stripSurroundQuotes(tok: string): string {
  if (tok.length >= 2) {
    const [a] = tok;
    const b = tok[tok.length - 1];
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) {
      return tok.slice(1, -1);
    }
  }
  return tok;
}

/** 路径是否存在（文件或目录） */
function existsAny(p: string): boolean {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
}

/** 最深已存在祖先目录（target 自身不存在时回落用）；越出 root 返回 null */
function deepestExistingAncestor(target: string, absRoot: string): string | null {
  let dir = path.dirname(target);
  let guard = 0;
  while (guard++ < 64 && withinRoot(dir, absRoot)) {
    if (existsAny(dir)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
  return null;
}

/**
 * 从 bash 命令提取被访问路径（相对 absRoot，已 withinRoot + 存在性过滤）。
 * 按 && || ; | 换行分段顺序处理（cd 跟随更新后续段的解析基目录），每段跳过
 * 包装命令后取命令名，仅白名单命令参与；候选 token 跳过选项与 KEY=VAL，
 * 解析失败（glob / $VAR / 模式串）由存在性过滤按漏报处理。
 */
export function extractBashPaths(command: string, absRoot: string): string[] {
  const found = new Set<string>();
  let base = absRoot;

  const record = (tok: string, creator: boolean): void => {
    let target = realpathOr(path.resolve(base, expandHome(tok)));
    if (!withinRoot(target, absRoot)) {
      return;
    }
    if (!existsAny(target)) {
      if (!creator) {
        return;
      }
      const ancestor = deepestExistingAncestor(target, absRoot);
      if (ancestor === null) {
        return;
      }
      target = ancestor;
    }
    const rel = path.relative(absRoot, target);
    if (rel === "") {
      return; // 创建类目标回落到 cwd 自身（root 非文档），无提取价值
    }
    found.add(rel);
  };

  for (const segment of command.split(/&&|\|\||;|\||\n/u)) {
    const tokens = segment.trim().split(/\s+/u).filter(Boolean).map(stripSurroundQuotes);
    let i = 0;
    // 跳过包装命令与其选项（sudo -u root …）
    while (i < tokens.length) {
      const first = tokens[i];
      if (first === undefined) {
        break;
      }
      const name = path.basename(first);
      if (!BASH_WRAPPERS.has(name)) {
        break;
      }
      i++;
      while (i < tokens.length && tokens[i]?.startsWith("-")) {
        const flag = tokens[i] ?? "";
        i++;
        if (
          (flag === "-u" || flag === "-g" || flag === "--user" || flag === "--group") &&
          i < tokens.length
        ) {
          i++;
        }
      }
    }
    if (i >= tokens.length) {
      continue;
    }
    const cmdToken = tokens[i];
    if (cmdToken === undefined) {
      continue;
    }
    const cmd = path.basename(cmdToken);
    const args = tokens.slice(i + 1);

    if (cmd === "cd") {
      // 目标必须真实存在才更新基目录（失败的 cd 后续路径仍相对原目录）
      const [cdTarget] = args;
      if (cdTarget !== undefined) {
        const target = realpathOr(path.resolve(base, expandHome(cdTarget)));
        if (withinRoot(target, absRoot) && existsAny(target)) {
          base = target;
        }
      }
      continue;
    }
    if (!BASH_FILE_CMDS.has(cmd)) {
      continue;
    }
    const creator = BASH_CREATORS.has(cmd);
    for (const tok of args) {
      if (tok.startsWith("-") || tok.includes("=")) {
        continue; // 选项与 KEY=VAL（env 包装残留）
      }
      record(tok, creator);
    }
  }
  return [...found];
}

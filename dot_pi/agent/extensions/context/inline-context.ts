/**
 * Inline Context extension for pi
 *
 * 在用户提交消息（agent 开始前）注入系统上下文，合并原 inline-date /
 * inline-env / inline-git-status 三个扩展：
 * - 日期：每轮现算，systemPrompt 注入（跨天自动更新）
 * - 系统环境：session 内一次，异步预计算，systemPrompt 注入
 * - Git 状态：session 内一次，异步预计算，systemPrompt 注入
 * - 首条消息注入一条极简摘要 message（display: true），TUI 可见一行
 *
 * 设计决策（可验证优先）：
 * - 检测全部异步化（execFile 而非 execFileSync）：原 inline-env 用同步
 *   execFileSync 跑 `pnpm --version` 单条阻塞 921ms，首条消息卡顿近 1 秒
 *   （benchmark 实测）；现在 session_start 时后台预计算，before_agent_start
 *   只 await 缓存结果，不阻塞事件循环
 * - 检测项精简：保留影响 LLM 决策的高价值项（OS / 不可变系统 / 会话 /
 *   桌面 / 容器），删除低价值项（shell / node / pnpm 版本、内核版本、
 *   架构）——需要时 LLM 可自行用命令查询
 * - 完整信息走 systemPrompt（每轮重建，compact 后自动恢复，无状态），
 *   摘要 message 只用于 TUI 可见性，不承载关键信息；TUI 渲染统一走
 *   lib/inject-notice.ts 的 renderInjectNotice（默认外观，collapsed 显示
 *   摘要行，ctrl+o 展开同内容）
 * - 工具与 gh 状态：检测已安装的现代 CLI 替代（仅 fd/rg，2026-08-12
 *   精简）与 gh 登录账号，让 LLM 写命令时优先用已装工具、知道 gh 可做
 *   认证操作；未安装 / 未登录自动省略，不占上下文
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { renderInjectNotice } from "../lib/inject-notice.ts";

const execFileAsync = promisify(execFile);

// ---------- 日期 ----------

function utcOffsetStr(): string {
  const offsetMin = -new Date().getTimezoneOffset();
  const sign = offsetMin < 0 ? "-" : "+";
  const absMin = Math.abs(offsetMin);
  const offsetH = Math.floor(absMin / 60);
  const offsetM = absMin % 60;
  return `${sign}${offsetH}${offsetM ? `:${String(offsetM).padStart(2, "0")}` : ""}`;
}

function formatDateLine(): string {
  const now = new Date();
  const formatted = new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "full",
  }).format(now);
  const tz = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `今天日期：${formatted}（${tz}, UTC${utcOffsetStr()}）`;
}

// 摘要用短格式：8月10日 周一 UTC+8
function formatDateShort(): string {
  const date = new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date());
  return `${date} UTC${utcOffsetStr()}`;
}

// ---------- 系统环境 ----------

export interface EnvContext {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  exec: (cmd: string, args: string[]) => Promise<string | null>; // 失败返回 null
}

export interface SystemInfo {
  platform: NodeJS.Platform;
  os: string | null;
  immutable: boolean;
  session: string | null;
  desktop: string | null;
  container: string | null;
}

// Fedora Atomic 桌面变体：均为不可变系统
const IMMUTABLE_VARIANTS = new Set([
  "kinoite",
  "silverblue",
  "sericea",
  "onyx",
  "sodalite",
  "atomic",
]);

async function readOsRelease(exec: EnvContext["exec"]): Promise<{
  pretty: string | null;
  variantId: string | null;
}> {
  const text = await exec("cat", ["/etc/os-release"]);
  if (!text) {
    return { pretty: null, variantId: null };
  }
  const pretty = text.match(/^PRETTY_NAME="?([^"\n]*)"?/m)?.[1] ?? null;
  const variantId = text.match(/^VARIANT_ID="?([^"\n]*)"?/m)?.[1] ?? null;
  return { pretty, variantId };
}

function platformLabel(platform: NodeJS.Platform): string {
  switch (platform) {
    case "win32": {
      return "Windows";
    }
    case "darwin": {
      return "macOS";
    }
    case "linux": {
      return "Linux";
    }
    default: {
      return platform;
    }
  }
}

// 基础层（process）兜底 + 增强层（平台命令，失败自动省略）
export async function detectEnv(ctx: EnvContext): Promise<SystemInfo> {
  const { platform, env, exec } = ctx;
  let os: string | null = null;
  let immutable = false;
  let container: string | null = null;

  if (platform === "linux") {
    const release = await readOsRelease(exec);
    if (release.pretty) {
      os = release.pretty;
      immutable =
        IMMUTABLE_VARIANTS.has(release.variantId ?? "") ||
        (await exec("rpm-ostree", ["--version"])) !== null;
    }
    const virt = await exec("systemd-detect-virt", ["--container"]);
    if (virt && virt !== "none" && virt !== "0") {
      container = virt;
    }
  } else if (platform === "darwin") {
    const ver = await exec("sw_vers", ["-productVersion"]);
    os = ver ? `macOS ${ver}` : "macOS";
  } else if (platform === "win32") {
    os = "Windows";
  }

  return {
    platform,
    os,
    immutable,
    session: env["XDG_SESSION_TYPE"] ?? null,
    desktop: env["XDG_CURRENT_DESKTOP"] ?? null,
    container,
  };
}

export function formatEnvLine(info: SystemInfo): string {
  const parts: string[] = [];
  const osLabel = info.os ?? platformLabel(info.platform);
  parts.push(
    info.immutable ? `${osLabel}（不可变系统：系统级包用 rpm-ostree / flatpak）` : osLabel,
  );
  if (info.session) {
    parts.push(info.desktop ? `${info.session} 会话（${info.desktop}）` : `${info.session} 会话`);
  }
  if (info.container) {
    parts.push(`容器环境（${info.container}）`);
  }
  return `[系统环境] ${parts.join("；")}`;
}

// 摘要用短标签：Fedora Kinoite(不可变)
function shortEnvLabel(info: SystemInfo): string {
  const osLabel = info.os ?? platformLabel(info.platform);
  // "Fedora Linux 44.x (Kinoite)" → "Fedora Kinoite"
  const m = info.os?.match(/^([^\s]+).*\(([^)]+)\)$/);
  const base = m ? `${m[1]!} ${m[2]!}` : osLabel;
  return info.immutable ? `${base}(不可变)` : base;
}

// ---------- Git 状态 ----------

const WORKTREE_DIRS = [".worktrees", "worktrees", ".worktree", "worktree"];

export interface GitStatus {
  root: string;
  branch: string | null; // 当前分支（detached HEAD 时为 null）
  isWorktree: boolean;
  isSubmodule: boolean;
}

export interface GitContext {
  info: GitStatus | null;
  ignoredWorktreeDir: string | null;
}

// 执行 git 命令，失败（非仓库 / 命令不存在）返回 null
async function runGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf8" });
    return String(stdout).trim();
  } catch {
    return null;
  }
}

// 不在 Git 仓库时返回 null
export async function detectGitStatus(cwd: string): Promise<GitStatus | null> {
  const gitDir = await runGit(cwd, ["rev-parse", "--git-dir"]);
  if (!gitDir) {
    return null;
  }
  const commonDir = await runGit(cwd, ["rev-parse", "--git-common-dir"]);
  const root = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
  const branch = await runGit(cwd, ["branch", "--show-current"]);
  const superproject = await runGit(cwd, ["rev-parse", "--show-superproject-working-tree"]);

  // Superproject 路径输出非空 ⇒ 位于 submodule 中
  const isSubmodule = Boolean(superproject);
  // Linked worktree：git-dir 与 git-common-dir 不同（submodule 除外）
  const isWorktree = !isSubmodule && Boolean(commonDir) && gitDir !== commonDir;

  return {
    root: root ?? cwd,
    branch: branch || null,
    isWorktree,
    isSubmodule,
  };
}

// 返回第一个已被 .gitignore 忽略的工作树目录名，否则 null
// 并行检测所有候选目录，比串行快一个量级
export async function findIgnoredWorktreeDir(cwd: string): Promise<string | null> {
  const results = await Promise.all(
    WORKTREE_DIRS.map(async (dir) => {
      const out = await runGit(cwd, ["check-ignore", "-q", dir]);
      return out !== null ? dir : null;
    }),
  );
  return results.find((dir) => dir !== null) ?? null;
}

// Git 状态 + worktree 建议合并检测，供 systemPrompt 每轮复用
export async function detectGitContext(cwd: string): Promise<GitContext> {
  const info = await detectGitStatus(cwd);
  if (!info) {
    return { info: null, ignoredWorktreeDir: null };
  }
  let ignoredWorktreeDir: string | null = null;
  if (
    (info.branch === "main" || info.branch === "master") &&
    !info.isWorktree &&
    !info.isSubmodule
  ) {
    ignoredWorktreeDir = await findIgnoredWorktreeDir(cwd);
  }
  return { info, ignoredWorktreeDir };
}

export function formatGitLine(ctx: GitContext): string {
  const { info, ignoredWorktreeDir } = ctx;
  if (!info) {
    return "[Git 状态] 当前目录不在 Git 仓库中。";
  }
  const { root, branch, isWorktree, isSubmodule } = info;
  let text: string;
  if (isSubmodule) {
    text = `[Git 状态] 当前位于 Git submodule（仓库根 ${root}，分支 ${branch ?? "detached HEAD"}），按普通仓库对待。`;
  } else if (isWorktree) {
    text = `[Git 状态] 当前位于 Git linked worktree（仓库根 ${root}，分支 ${branch ?? "detached HEAD"}），工作区已隔离。`;
  } else {
    text = `[Git 状态] 当前位于 Git 仓库（根目录 ${root}，分支 ${branch ?? "detached HEAD"}）。`;
  }
  if (!branch) {
    text += " 处于 detached HEAD，由外部管理，收尾时需创建分支。";
  }
  if (ignoredWorktreeDir) {
    text += ` 工作树目录 ${ignoredWorktreeDir} 已被 Git 忽略，建议在隔离分支上开发：\`git worktree add ${ignoredWorktreeDir}/<新分支> -b <新分支>\`，避免直接修改 ${branch ?? "HEAD"}。`;
  }
  return text;
}

// ---------- CLI 工具 ----------

// 候选现代替代工具（仅注入已安装的，未装自动省略；2026-08-12 精简为 fd/rg 两个高价值项）
const TOOL_RECOMMENDATIONS = [
  { bin: "rg", replaces: "grep" },
  { bin: "fd", replaces: "find" },
] as const;

// 返回已安装的工具名列表（并行检测，--version 验证可执行性）
export async function detectTools(): Promise<string[]> {
  const results = await Promise.all(
    TOOL_RECOMMENDATIONS.map(async ({ bin }) => {
      try {
        await execFileAsync(bin, ["--version"], { encoding: "utf8" });
        return bin;
      } catch {
        return null;
      }
    }),
  );
  type ToolBin = (typeof TOOL_RECOMMENDATIONS)[number]["bin"];
  return results.filter((b): b is ToolBin => b !== null);
}

export function formatToolsLine(installed: string[]): string | null {
  if (installed.length === 0) {
    return null;
  }
  const installedSet = new Set(installed);
  const items = TOOL_RECOMMENDATIONS.filter((t) => installedSet.has(t.bin))
    .map((t) => `${t.bin}替代${t.replaces}`)
    .join("、");
  return `[CLI 工具] 优先使用现代替代：${items}`;
}

// ---------- GitHub CLI ----------

export interface GhStatus {
  // Hosts.yml 中存储的账号（keyring / 明文文件）
  storedAccounts: string[];
  // 环境变量 token 是否存在（GITHUB_TOKEN / GH_TOKEN，gh 优先使用）
  hasEnvToken: boolean;
}

// 纯本地检测（零进程零网络）：gh auth status 对 env token 会走 API 反查
// 账号名（实测 1.7s 网络请求），会拖慢首条消息；读 hosts.yml + 环境变量
// 瞬时完成，代价是 env token 的账号名不可知（gh 会自动使用，不影响操作）
export async function detectGh(): Promise<GhStatus | null> {
  const storedAccounts: string[] = [];
  const configPath =
    process.platform === "win32"
      ? join(process.env["APPDATA"] ?? homedir(), "GitHub CLI", "hosts.yml")
      : join(homedir(), ".config", "gh", "hosts.yml");
  try {
    const text = await readFile(configPath, "utf8");
    // Hosts.yml 中账号键为 8 空格缩进，形如 "        MiyakoMeow:"
    for (const line of text.split("\n")) {
      const m = line.match(/^ {8}([^:\s]+):/);
      if (m) {
        storedAccounts.push(m[1]!);
      }
    }
  } catch {
    // 未安装 gh 或未登录：无配置文件
  }
  const hasEnvToken = Boolean(process.env["GITHUB_TOKEN"] ?? process.env["GH_TOKEN"]);
  if (storedAccounts.length === 0 && !hasEnvToken) {
    return null;
  }
  return { storedAccounts, hasEnvToken };
}

export function formatGhLine(status: GhStatus): string {
  const parts: string[] = [];
  if (status.hasEnvToken) {
    parts.push("GITHUB_TOKEN 环境变量");
  }
  parts.push(...status.storedAccounts);
  return `[GitHub] gh 已登录：${parts.join("、")}`;
}

// ---------- 摘要 message ----------

export function buildSummary(opts: {
  env: SystemInfo | null;
  git: GitContext | null;
  tools: string[];
  gh: GhStatus | null;
}): string {
  const { env, git, tools, gh } = opts;
  const parts: string[] = [`[上下文] ${formatDateShort()}`];
  if (env) {
    parts.push(shortEnvLabel(env));
  }
  if (git?.info) {
    parts.push(`git ${basename(git.info.root)}@${git.info.branch ?? "detached"}`);
  } else {
    parts.push("不在 Git 仓库");
  }
  if (tools.length > 0) {
    parts.push(tools.join("/"));
  }
  if (gh) {
    const names = [...(gh.hasEnvToken ? ["env"] : []), ...gh.storedAccounts];
    parts.push(`gh:${names.join("+")}`);
  }
  return parts.join(" | ");
}

// ---------- 扩展主体 ----------

// /resume 兼容：旧版三个扩展的注入消息也视为已注入，避免重复注入
const CUSTOM_TYPE = "inline-context";
const LEGACY_CUSTOM_TYPES = new Set(["inline-date", "inline-env", "inline-git-status"]);

function realEnv(): EnvContext {
  return {
    platform: process.platform,
    env: process.env,
    exec: async (cmd, args) => {
      try {
        const { stdout } = await execFileAsync(cmd, args, { encoding: "utf8" });
        return String(stdout).trim();
      } catch {
        return null;
      }
    },
  };
}

export default function (pi: ExtensionAPI) {
  // 统一渲染（默认外观，collapsed 只显示注入提示）
  pi.registerMessageRenderer(CUSTOM_TYPE, renderInjectNotice);

  // 首条消息是否已注入摘要（compact 后重置，允许重新展示）
  let injectedMessage = false;
  // Session_start 时启动的异步预计算（不阻塞事件循环）
  let envPromise: Promise<SystemInfo | null> | null = null;
  let gitPromise: Promise<GitContext> | null = null;
  let toolsPromise: Promise<string[]> | null = null;
  let ghPromise: Promise<GhStatus | null> | null = null;

  pi.on("session_compact", async () => {
    injectedMessage = false;
  });

  // Session 启动即后台预计算环境与 Git 状态，首条消息时直接取缓存
  pi.on("session_start", async (_event, ctx) => {
    envPromise = detectEnv(realEnv());
    gitPromise = detectGitContext(ctx.cwd);
    toolsPromise = detectTools();
    ghPromise = detectGh();
  });

  pi.on("before_agent_start", async (event, ctx) => {
    // 已完成的 promise await 为零成本；未完成则等异步结果（不阻塞 TUI）
    const envInfo = (await envPromise) ?? null;
    const gitInfo = (await gitPromise) ?? null;
    const tools = (await toolsPromise) ?? [];
    const gh = (await ghPromise) ?? null;

    const dateLine = `[日期] ${formatDateLine()}`;
    const envLine = envInfo ? formatEnvLine(envInfo) : "";
    const gitLine = gitInfo ? formatGitLine(gitInfo) : "";
    const toolsLine = tools.length > 0 ? formatToolsLine(tools) : "";
    const ghLine = gh ? formatGhLine(gh) : "";
    const systemPrompt = `${event.systemPrompt}\n\n${[dateLine, envLine, gitLine, toolsLine, ghLine]
      .filter(Boolean)
      .join("\n")}`;

    const result: {
      message?: {
        customType: string;
        content: string;
        details: { notice: string };
        display: boolean;
      };
      systemPrompt: string;
    } = { systemPrompt };

    // 首条消息注入一条极简摘要（TUI 可见），完整信息已进 systemPrompt
    if (!injectedMessage) {
      injectedMessage = true;
      // /resume 场景：历史已含（新或旧版）注入消息则跳过
      const hasInjected = ctx.sessionManager
        .getEntries()
        .some(
          (entry) =>
            entry.type === "custom_message" &&
            (entry.customType === CUSTOM_TYPE || LEGACY_CUSTOM_TYPES.has(entry.customType)),
        );
      if (!hasInjected) {
        // 提示内容即原摘要行（details.notice = content，collapsed/expanded 一致）
        const summary = buildSummary({ env: envInfo, git: gitInfo, tools, gh });
        result.message = {
          customType: CUSTOM_TYPE,
          content: summary,
          details: { notice: summary },
          display: true,
        };
      }
    }
    return result;
  });
}

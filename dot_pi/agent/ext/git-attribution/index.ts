/**
 * Git 提交署名扩展（git-attribution）
 *
 * 目标：像 Claude Code 的 attribution 一样，只对 agent 通过 Pi shell 工具
 * 产生的提交自动追加署名，不改命令文本、不改仓库文件、不覆盖仓库 hooks。
 *
 * 机制：
 *
 * - 覆盖 bash 与 powershell 工具定义，保留 shellPath / shellCommandPrefix；
 * - spawnHook 在每次命令的 env 里追加一条 git 运行时配置
 *   GIT_CONFIG_COUNT=<原值+1>、GIT_CONFIG_KEY_<n>=core.hooksPath、
 *   GIT_CONFIG_VALUE_<n>=临时 hooks 目录；
 * - 临时目录除 prepare-commit-msg 外，还为所有标准 hook 生成委托脚本，
 *   保证 pre-commit、commit-msg、post-commit 等不被 core.hooksPath 覆盖跳过；
 * - 临时 prepare-commit-msg 先执行仓库原有 hook（失败仍中止提交），再按
 *   merge/squash 跳过、规范化旧 agent 署名、追加
 *   Co-Authored-By: 白小喵 <noreply@pi.dev>
 *   与 Generated-By: pi <版本> (模型 @ provider, reasoning=档位)；
 * - 会话结束删除临时目录，仓库本身零改动。
 *
 * 为什么不用命令改写：追加 -m/--trailer 只能覆盖直接 git commit，脚本内提交、
 * 编辑器提交和命令链都容易漏；为什么不用仓库永久 hook：会改仓库、无法自动
 * 链式已有 prepare-commit-msg，也不适合临时目录与多仓库切换。
 *
 * 退出：
 *
 * - PI_GIT_ATTRIBUTION=0/false/no/off 关闭当前会话或单条命令；
 * - git config --local pi.attribution false 关闭当前仓库。
 *
 * 配置：
 *
 * - 全局 <agent dir>/git-attribution.json，仓库 <repo>/.pi/git-attribution.json；
 * - 仓库覆盖全局，字段级合并；session_start 读取，/reload 或重启生效；
 * - 只配置 coAuthor.name 与 coAuthor.email，默认白小喵 / noreply@pi.dev。
 *
 * 边界：git commit-tree、git revert、git am、rebase 内部提交通常不触发
 * prepare-commit-msg；env -i、sudo 未带 -E、容器清空环境变量时也不会加。
 * 另一个扩展若在本扩展之后覆盖 bash/powershell，spawnHook 会失效。
 * Windows PowerShell 需在 Windows 机器上手工验证。
 *
 * 运行时验证（提交正文需记录结果）：
 *
 *   pnpm test
 *   pnpm check
 *   pi -p -e dot_pi/agent/ext/git-attribution/index.ts --no-session "只回复：收到"
 *   临时仓库内用 pi -p 让 agent 执行 git commit，检查提交消息
 */

import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type BashSpawnHook,
  createBashToolDefinition,
  createPowerShellToolDefinition,
  type ExtensionAPI,
  getAgentDir,
  VERSION,
} from "@earendil-works/pi-coding-agent";

import { type AttributionConfig, DEFAULT_CONFIG, loadConfig } from "./internal/config.ts";
import { buildDelegatingHookScript, buildHookScript, DELEGATED_HOOKS } from "./internal/hook.ts";
import { buildAttribution, isAttributionDisabled, withGitConfig } from "./internal/trailers.ts";

const HOOK_FILENAME = "prepare-commit-msg";

let hooksDir: string | undefined;
let warned = false;
let config: AttributionConfig = DEFAULT_CONFIG;

export default function (pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    config = loadConfig(ctx.cwd, getAgentDir());
  });

  const spawnHook: BashSpawnHook = ({ command, cwd, env }) => {
    if (isAttributionDisabled(env["PI_GIT_ATTRIBUTION"])) {
      return { command, cwd, env };
    }
    const dir = ensureHooksDir();
    if (dir === undefined) {
      return { command, cwd, env };
    }
    const attribution = buildAttribution(env, VERSION, config);
    return { command, cwd, env: withGitConfig(env, dir, attribution) };
  };

  const settings = readSettings(pi);
  const bashOptions = {
    spawnHook,
    ...(settings.shellCommandPrefix ? { commandPrefix: settings.shellCommandPrefix } : {}),
    ...(settings.shellPath ? { shellPath: settings.shellPath } : {}),
  };

  pi.registerTool({
    ...createBashToolDefinition(process.cwd(), bashOptions),
    defaultActive: false,
  });
  pi.registerTool({
    ...createPowerShellToolDefinition(process.cwd(), { spawnHook }),
    defaultActive: false,
  });

  pi.on("session_shutdown", () => {
    cleanup();
  });
}

function ensureHooksDir(): string | undefined {
  if (hooksDir !== undefined) {
    return hooksDir;
  }
  let dir: string | undefined;
  try {
    dir = mkdtempSync(join(tmpdir(), "pi-git-attribution-"));
    writeHook(dir, HOOK_FILENAME, buildHookScript());
    const delegate = buildDelegatingHookScript();
    for (const hook of DELEGATED_HOOKS) {
      writeHook(dir, hook, delegate);
    }
    hooksDir = dir;
    return dir;
  } catch (error) {
    if (dir !== undefined) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // 临时目录清理失败不影响主流程。
      }
    }
    warnOnce(`[git-attribution] 临时 hook 目录创建失败：${message(error)}`);
    return undefined;
  }
}

function writeHook(dir: string, name: string, content: string): void {
  const path = join(dir, name);
  writeFileSync(path, content, { mode: 0o755 });
  try {
    chmodSync(path, 0o755);
  } catch {
    // Windows 没有 POSIX 执行位语义；Git for Windows 仍会运行 hook。
  }
}

function readSettings(pi: ExtensionAPI): {
  shellCommandPrefix?: string;
  shellPath?: string;
} {
  const result: { shellCommandPrefix?: string; shellPath?: string } = {};
  try {
    const settings = pi.getSettings();
    if (settings.shellCommandPrefix) {
      result.shellCommandPrefix = settings.shellCommandPrefix;
    }
    if (settings.shellPath) {
      result.shellPath = settings.shellPath;
    }
  } catch {
    // 设置读取失败时退回 Pi 默认 shell 配置。
  }
  return result;
}

function cleanup(): void {
  if (hooksDir === undefined) {
    return;
  }
  try {
    rmSync(hooksDir, { recursive: true, force: true });
  } catch {
    // 进程退出阶段的清理失败交给系统临时目录回收。
  }
  hooksDir = undefined;
}

function warnOnce(text: string): void {
  if (warned) {
    return;
  }
  warned = true;
  console.error(text);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

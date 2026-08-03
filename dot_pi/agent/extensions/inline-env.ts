/**
 * Inline Environment extension for pi
 *
 * 在用户提交消息（agent 开始前）注入系统环境信息（session 内一次，
 * TUI 可见，同 inline-git-status），让 LLM 知道当前平台的包管理 / 会话 /
 * shell / 工具链，避免基于通用 Linux 的预训练知识给出错误命令
 * （如 Kinoite 上建议 dnf）。
 *
 * 跨平台分层设计：
 * - 基础层：Node 原生 process（platform / arch / node 版本 / 环境变量），
 *   100% 跨平台可靠，无需任何 shell 命令
 * - 增强层：平台专属命令（Linux os-release / uname / systemd-detect-virt、
 *   macOS sw_vers），检测失败自动省略，不阻塞注入
 *
 * 亮点：Fedora Atomic（Kinoite / Silverblue 等）识别为不可变系统，
 * 提示系统级包用 rpm-ostree / flatpak 而非 dnf。
 *
 * detectEnv / formatEnvText 为纯函数，平台 / 环境变量 / 命令执行均通过
 * EnvContext 依赖注入，便于跨平台逻辑的单元测试。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";

export interface EnvContext {
  platform: NodeJS.Platform;
  arch: string;
  env: Record<string, string | undefined>;
  nodeVersion: string;
  exec: (cmd: string, args: string[]) => string | null; // 失败返回 null
}

export interface SystemInfo {
  platform: NodeJS.Platform;
  arch: string;
  node: string;
  os: string | null;
  kernel: string | null;
  immutable: boolean;
  session: string | null;
  desktop: string | null;
  shell: string | null;
  pnpm: string | null;
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

const SHELL_NAMES: Record<string, string> = {
  nu: "nushell",
  bash: "bash",
  zsh: "zsh",
  fish: "fish",
  sh: "sh",
  pwsh: "powershell",
  powershell: "powershell",
  "powershell.exe": "powershell",
  cmd: "cmd",
  "cmd.exe": "cmd",
};

function readOsRelease(exec: EnvContext["exec"]): {
  pretty: string | null;
  variantId: string | null;
} {
  const text = exec("cat", ["/etc/os-release"]);
  if (!text) {
    return { pretty: null, variantId: null };
  }
  const pretty = text.match(/^PRETTY_NAME="?([^"\n]*)"?/m)?.[1] ?? null;
  const variantId = text.match(/^VARIANT_ID="?([^"\n]*)"?/m)?.[1] ?? null;
  return { pretty, variantId };
}

function getShellName(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform,
): string | null {
  const raw = env["SHELL"] ?? (platform === "win32" ? env["COMSPEC"] : null);
  if (!raw) {
    return null;
  }
  const base = (raw.split(/[\\/]/).pop() ?? raw).toLowerCase();
  return SHELL_NAMES[base] ?? base;
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
export function detectEnv(ctx: EnvContext): SystemInfo {
  const { platform, arch, env, nodeVersion, exec } = ctx;
  let os: string | null = null;
  let kernel: string | null = null;
  let immutable = false;
  let container: string | null = null;

  if (platform === "linux") {
    const release = readOsRelease(exec);
    if (release.pretty) {
      os = release.pretty;
      immutable =
        IMMUTABLE_VARIANTS.has(release.variantId ?? "") ||
        exec("rpm-ostree", ["--version"]) !== null;
    }
    kernel = exec("uname", ["-r"]);
    const virt = exec("systemd-detect-virt", ["--container"]);
    if (virt && virt !== "none" && virt !== "0") {
      container = virt;
    }
  } else if (platform === "darwin") {
    const ver = exec("sw_vers", ["-productVersion"]);
    os = ver ? `macOS ${ver}` : "macOS";
  } else if (platform === "win32") {
    os = "Windows";
  }

  return {
    platform,
    arch,
    node: nodeVersion,
    os,
    kernel,
    immutable,
    session: env["XDG_SESSION_TYPE"] ?? null,
    desktop: env["XDG_CURRENT_DESKTOP"] ?? null,
    shell: getShellName(env, platform),
    pnpm: exec("pnpm", ["--version"]),
    container,
  };
}

export function formatEnvText(info: SystemInfo): string {
  const parts: string[] = [];
  const osLabel = info.os ?? platformLabel(info.platform);
  parts.push(
    info.immutable ? `${osLabel}（不可变系统：系统级包用 rpm-ostree / flatpak）` : osLabel,
  );
  if (info.kernel) {
    parts.push(`内核 ${info.kernel}`);
  }
  parts.push(info.arch);
  if (info.session) {
    parts.push(info.desktop ? `${info.session} 会话（${info.desktop}）` : `${info.session} 会话`);
  }
  if (info.shell) {
    parts.push(`shell ${info.shell}`);
  }
  parts.push(`node ${info.node}`);
  if (info.pnpm) {
    parts.push(`pnpm ${info.pnpm}`);
  }
  if (info.container) {
    parts.push(`容器环境（${info.container}）`);
  }
  return `[系统环境] ${parts.join("；")}`;
}

function realExec(cmd: string, args: string[]): string | null {
  try {
    return execFileSync(cmd, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function realEnv(): EnvContext {
  return {
    platform: process.platform,
    arch: process.arch,
    env: process.env,
    nodeVersion: process.version,
    exec: realExec,
  };
}

export default function (pi: ExtensionAPI) {
  // 静态信息：session 内不变，注入一次即可（compact 后重置重新注入）
  let injected = false;
  let cached: SystemInfo | null = null;

  pi.on("session_compact", async () => {
    injected = false;
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    if (injected) {
      return;
    }
    injected = true;
    // /resume 场景：会话历史已含注入消息则跳过
    const hasInjected = ctx.sessionManager
      .getEntries()
      .some((entry) => entry.type === "custom_message" && entry.customType === "inline-env");
    if (hasInjected) {
      return;
    }
    if (!cached) {
      cached = detectEnv(realEnv());
    }
    return {
      message: {
        customType: "inline-env",
        content: formatEnvText(cached),
        display: true,
      },
    };
  });
}

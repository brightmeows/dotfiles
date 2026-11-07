/**
 * Dsh-meow-context-hooks — Pi 扩展复刻的上下文注入三钩子
 *
 * 对齐 Pi 侧三个扩展的语义（pi-meow-inline-context / pi-meow-git-hooks /
 * pi-meow-subdir-agents-md），落在 dsh 的原生通道上：
 *
 * 1. Git 快照（inline-context 对齐）：agent/created 时经 workingDirectory
 *    服务取会话目录，异步采集 remote（剥凭据）、dirty 数、ahead/behind、
 *    stash、进行中操作、最近提交，缓存为 per-session 状态；
 *    ctx.systemPrompt.context() 注册动态运行时上下文，组装时同步读缓存。
 *    TTL 过期由下一次组装触发后台重采（fire-and-forget，不阻塞组装）。
 * 2. Git hooks 约定检测（git-hooks 对齐）：与快照同批采集，输出一句话
 *    状态（.githooks/ 约定优先，pre-commit 次之，二者互斥锚定同 Pi 版）。
 *    dsh 无 TUI widget 通道，提示降级为模型可见上下文，由模型转告。
 * 3. 子目录 AGENTS.md 懒加载（subdir-agents-md 对齐）：tools/post-execute
 *    瀑布监听 read/edit/write/grep/glob 的路径参数，收集 cwd 与目标目录
 *    之间各级的 AGENTS.md（cwd 根除外，已由 workspace instructions 加载），
 *    经 PostToolDecision.additionalContexts 注入。v1 边界：bash 命令内的
 *    路径启发式与跨 resume 扫库去重未实现（Pi 版有，复杂度高），同一
 *    会话同一目录只注入一次，进程重启后回到可注入态。
 *
 * 不 import 任何 dsh 包（无类型需求），服务经 ctx 注入或 ctx.get 可选拿；
 * engines 不声明 dsh 版本，peer 用宽范围，避免版本门禁误伤。
 */
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import Schema from "@deepseek-ai/schemastery";

const execFileP = promisify(execFile);

export const name = "dsh-meow-context-hooks";
export const inject = ["tools", "workingDirectory", "systemPrompt"];

export const Config = Schema.object({
  enableGitSnapshot: Schema.boolean()
    .default(true)
    .description(
      "Inject a per-session git snapshot (remote, dirty, ahead/behind, stash, in-progress ops, last commit) as a prompt context",
    ),
  enableGitHooksCheck: Schema.boolean()
    .default(true)
    .description(
      "Check .githooks/ and pre-commit conventions once per session and inject the result as a prompt context",
    ),
  enableSubdirAgents: Schema.boolean()
    .default(true)
    .description(
      "Inject AGENTS.md files from subdirectories between cwd and any file the model touches",
    ),
  snapshotTtlMs: Schema.number()
    .default(30_000)
    .description(
      "Git snapshot refresh interval in milliseconds; refresh happens in the background on the next assembly",
    ),
  gitTimeoutMs: Schema.number().default(5000).description("Timeout for one git invocation"),
  subdirMaxChars: Schema.number()
    .default(6000)
    .description("Truncate each injected AGENTS.md to this many characters"),
});

const GIT_SNAPSHOT_ORDER = 750;
const HOOKS_CHECK_ORDER = 751;
const PATH_TOOLS = new Set(["read", "edit", "write", "grep", "glob"]);
const AGENTS_FILE = "AGENTS.md";
const IN_PROGRESS_MARKERS = [
  ["rebase-merge", "rebase"],
  ["rebase-apply", "rebase/apply"],
  ["MERGE_HEAD", "merge"],
  ["CHERRY_PICK_HEAD", "cherry-pick"],
  ["REVERT_HEAD", "revert"],
  ["BISECT_LOG", "bisect"],
];

/** Per-session state: sid -> { cwd, git: {text, at}, hooks: {text, at}, collecting } */
const sessions = new Map();
/** Injected subdir rule dedup: sid -> Set<relativeDir> */
const injectedRules = new Map();

function stripCredential(url) {
  return String(url).replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]+@/iu, "$1");
}

async function git(cwd, args, timeoutMs) {
  const { stdout } = await execFileP("git", args, { cwd, timeout: timeoutMs, windowsHide: true });
  return stdout.trim();
}

async function runQuiet(command, args, timeoutMs) {
  try {
    await execFileP(command, args, { timeout: timeoutMs, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

/** First file name from `candidates` that exists as a readable file in `dir`. */
async function firstExistingFile(dir, candidates) {
  const checks = await Promise.allSettled(
    candidates.map(async (candidate) => {
      const st = await fs.stat(path.join(dir, candidate));
      return st.isFile() ? candidate : null;
    }),
  );
  for (const check of checks) {
    if (check.status === "fulfilled" && check.value !== null) {
      return check.value;
    }
  }
  return null;
}

async function dirHasExecutableScript(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  const access = await Promise.allSettled(
    entries
      .filter((entry) => entry.isFile())
      .map((entry) => fs.access(path.join(dir, entry.name), fs.constants.X_OK)),
  );
  return access.some((check) => check.status === "fulfilled");
}

async function inProgressOps(cwd, gitDir) {
  if (!gitDir) {
    return [];
  }
  const abs = path.isAbsolute(gitDir) ? gitDir : path.join(cwd, gitDir);
  const checks = await Promise.allSettled(
    IN_PROGRESS_MARKERS.map(([marker]) => fs.stat(path.join(abs, marker))),
  );
  return checks
    .map((check, index) => (check.status === "fulfilled" ? IN_PROGRESS_MARKERS[index][1] : null))
    .filter(Boolean);
}

async function collectSnapshot(cwd, timeoutMs) {
  const results = await Promise.allSettled([
    git(cwd, ["remote", "get-url", "origin"], timeoutMs),
    git(cwd, ["status", "--porcelain"], timeoutMs),
    git(cwd, ["status", "-sb"], timeoutMs),
    git(cwd, ["stash", "list"], timeoutMs),
    git(cwd, ["rev-parse", "--git-dir"], timeoutMs),
    git(cwd, ["log", "-1", "--oneline"], timeoutMs),
  ]);
  if (results[1].status === "rejected") {
    return null; // Not a git work tree
  }
  const [remote, status, sb, stash, gitDir, last] = results.map((result) =>
    result.status === "fulfilled" ? result.value : "",
  );

  const dirty = status ? status.split("\n").length : 0;
  const ab = /\[ahead (\d+)(?:, behind (\d+))?\]|\[behind (\d+)\]/u.exec(sb || "");
  let aheadBehind = "";
  if (ab) {
    aheadBehind =
      ab[3] !== undefined ? `behind ${ab[3]}` : `ahead ${ab[1]}${ab[2] ? ` behind ${ab[2]}` : ""}`;
  }

  const ops = await inProgressOps(cwd, gitDir);
  const parts = [];
  if (remote) {
    parts.push(`remote=${stripCredential(remote)}`);
  }
  parts.push(`dirty=${dirty}`);
  if (aheadBehind) {
    parts.push(aheadBehind);
  }
  if (stash) {
    parts.push(`stash=${stash.split("\n").length}`);
  }
  if (last) {
    parts.push(`last=${last.split("\n")[0]}`);
  }
  if (ops.length) {
    parts.push(`in-progress: ${ops.join(", ")}`);
  }
  return parts.join(" · ");
}

/** One-line status of the `.githooks/` convention, or null when it does not apply. */
async function githooksStatus(cwd, hooksPath) {
  const githooksDir = path.join(cwd, ".githooks");
  let usable = false;
  try {
    const st = await fs.stat(githooksDir);
    usable = st.isDirectory() && (await dirHasExecutableScript(githooksDir));
  } catch {
    return null;
  }
  if (!usable) {
    return null;
  }
  if (hooksPath === ".githooks" || path.resolve(cwd, hooksPath || "") === githooksDir) {
    return "git hooks: ready (.githooks active via core.hooksPath)";
  }
  if (!hooksPath) {
    return "git hooks: .githooks/ convention found but core.hooksPath is unset — activate with `git config core.hooksPath .githooks`";
  }
  return `git hooks: core.hooksPath is set to "${hooksPath}", the .githooks/ convention is not active (left untouched)`;
}

/** One-line status of the pre-commit convention, or null when it does not apply. */
async function preCommitStatus(cwd, hooksPath, timeoutMs) {
  const configFile = await firstExistingFile(cwd, [
    ".pre-commit-config.yaml",
    ".pre-commit-config.yml",
  ]);
  if (!configFile) {
    return null;
  }
  const toolPresent = await runQuiet("pre-commit", ["--version"], timeoutMs);
  if (!toolPresent) {
    return "pre-commit: config found but the pre-commit tool is not installed; hook setup skipped";
  }
  if (hooksPath) {
    return `pre-commit: config found but core.hooksPath ("${hooksPath}") takes over, pre-commit install is refused by design`;
  }
  let installed = false;
  try {
    const hooksDir = await git(cwd, ["rev-parse", "--git-path", "hooks"], timeoutMs);
    const absHooks = path.isAbsolute(hooksDir) ? hooksDir : path.join(cwd, hooksDir);
    await fs.access(path.join(absHooks, "pre-commit"));
    installed = true;
  } catch {
    installed = false;
  }
  return installed
    ? "pre-commit: hooks installed and ready"
    : "pre-commit: config found but hooks are not installed — activate with `pre-commit install`";
}

async function readHooksPath(cwd, timeoutMs) {
  try {
    return await git(cwd, ["config", "core.hooksPath"], timeoutMs);
  } catch {
    return "";
  }
}

async function checkHooks(cwd, timeoutMs) {
  const hooksPath = await readHooksPath(cwd, timeoutMs);
  const fromGithooks = await githooksStatus(cwd, hooksPath);
  if (fromGithooks !== null) {
    return fromGithooks;
  }
  const fromPreCommit = await preCommitStatus(cwd, hooksPath, timeoutMs);
  return fromPreCommit ?? "";
}

async function refreshSession(sid, config) {
  const st = sessions.get(sid);
  if (!st || st.collecting) {
    return;
  }
  st.collecting = true;
  try {
    const [snapshot, hooks] = await Promise.all([
      config.enableGitSnapshot ? collectSnapshot(st.cwd, config.gitTimeoutMs) : null,
      config.enableGitHooksCheck ? checkHooks(st.cwd, config.gitTimeoutMs) : null,
    ]);
    if (snapshot !== null) {
      st.git = { text: snapshot, at: Date.now() };
    }
    if (hooks !== null) {
      st.hooks = { text: hooks, at: Date.now() };
    }
  } catch {
    // Keep previous state on any unexpected failure.
  } finally {
    st.collecting = false;
  }
}

function safeDirOf(agent, workDir) {
  try {
    return workDir.get(agent);
  } catch {
    return null;
  }
}

/** Read per-session state, creating (and first-collecting) it lazily from the agent's directory. */
function stateOf(sid, cwd, config) {
  let st = sessions.get(sid);
  if (st) {
    return st;
  }
  if (!cwd) {
    return null;
  }
  st = { cwd, git: null, hooks: null, collecting: false };
  sessions.set(sid, st);
  void refreshSession(sid, config).catch(() => {});
  return st;
}

function scheduleRefresh(sid, config) {
  void refreshSession(sid, config).catch(() => {});
}

function truncateRule(text, maxChars) {
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n… (truncated)` : text;
}

/** AGENTS.md blocks for every directory between cwd and the touched path (exclusive of cwd itself). */
async function gatherSubdirRules(cwd, rawPath, config) {
  if (!rawPath || typeof rawPath !== "string") {
    return [];
  }
  const cwdAbs = path.resolve(cwd);
  const abs = path.resolve(cwdAbs, rawPath);
  if (abs !== cwdAbs && !abs.startsWith(cwdAbs + path.sep)) {
    return []; // Outside the workspace.
  }

  const dirs = [];
  let cur = path.dirname(abs);
  while (cur.startsWith(cwdAbs + path.sep)) {
    dirs.unshift(path.relative(cwdAbs, cur));
    cur = path.dirname(cur);
  }

  const reads = await Promise.allSettled(
    dirs.map(async (rel) => {
      const file = path.join(cwdAbs, rel, AGENTS_FILE);
      const st = await fs.stat(file);
      if (!st.isFile()) {
        return null;
      }
      const text = truncateRule(await fs.readFile(file, "utf8"), config.subdirMaxChars);
      return text.trim() ? { rel, text } : null;
    }),
  );
  return reads
    .filter((read) => read.status === "fulfilled" && read.value !== null)
    .map((read) => read.value);
}

function extractTouchedPath(args) {
  if (!args || typeof args !== "object") {
    return null;
  }
  return args.file_path || args.path || null;
}

/** Register the git snapshot and git-hooks prompt contexts on the system prompt service. */
function registerPromptContexts(ctx, sys, env) {
  const { workDir, config } = env;
  const makeText = (kind, format) => (assembleCtx) => {
    if (!assembleCtx?.scope?.id) {
      return "";
    }
    const {
      scope,
      scope: { id: sid },
    } = assembleCtx;
    const cwd = scope && typeof scope === "object" ? safeDirOf(scope, workDir) : null;
    const st = stateOf(String(sid), cwd, config);
    const cached = st?.[kind];
    if (!cached) {
      return "";
    }
    if (kind === "git" && Date.now() - cached.at > config.snapshotTtlMs) {
      scheduleRefresh(String(sid), config);
    }
    return cached.text ? format(cached.text, st.cwd) : "";
  };

  if (config.enableGitSnapshot) {
    ctx.effect(
      () =>
        sys.context({
          name: "meow-git-snapshot",
          order: GIT_SNAPSHOT_ORDER,
          text: makeText("git", (text, cwd) => `[git snapshot · cwd ${cwd}]\n${text}`),
        }),
      "dsh-meow-context-hooks: git snapshot context",
    );
  }
  if (config.enableGitHooksCheck) {
    ctx.effect(
      () =>
        sys.context({
          name: "meow-git-hooks-check",
          order: HOOKS_CHECK_ORDER,
          text: makeText("hooks", (text) => `[git hooks check]\n${text}`),
        }),
      "dsh-meow-context-hooks: git hooks context",
    );
  }
}

/** Injection target for one finished tool call: session id, workspace root, and touched path. */
function injectionTarget(exec, result, workDir) {
  if (result === null || result.isError) {
    return null;
  }
  if (!exec || !PATH_TOOLS.has(exec.name)) {
    return null;
  }
  const touched = extractTouchedPath(exec.arguments);
  const { agent } = exec;
  const sid = agent?.id ? String(agent.id) : null;
  const cwd = agent ? safeDirOf(agent, workDir) : null;
  if (!touched || !sid || !cwd) {
    return null;
  }
  return { sid, cwd, touched };
}

/** Register the subdirectory AGENTS.md injection on the tool post-execute waterfall. */
function registerSubdirRules(ctx, workDir, config) {
  ctx.effect(
    () =>
      ctx.on("tools/post-execute", async (exec, result, next) => {
        const decision = await next();
        try {
          if (decision?.kind !== "accept") {
            return decision;
          }
          const target = injectionTarget(exec, result, workDir);
          if (!target) {
            return decision;
          }
          const { sid, cwd, touched } = target;

          const blocks = await gatherSubdirRules(cwd, touched, config);
          let seen = injectedRules.get(sid);
          if (!seen) {
            seen = new Set();
            injectedRules.set(sid, seen);
          }
          const fresh = blocks.filter((block) => !seen.has(block.rel));
          if (!fresh.length) {
            return decision;
          }
          for (const block of fresh) {
            seen.add(block.rel);
          }

          const body = fresh
            .map(
              (block) => `Rules from ${block.rel}/${AGENTS_FILE} (auto-injected):\n${block.text}`,
            )
            .join("\n\n");
          const additionalContexts = [
            {
              role: "user",
              content: `[subdirectory rules auto-injection]\n${body}`,
              timestamp: Date.now(),
            },
          ];
          return {
            ...decision,
            additionalContexts: [...(decision.additionalContexts ?? []), ...additionalContexts],
          };
        } catch {
          return decision;
        }
      }),
    "dsh-meow-context-hooks: subdir rules post-execute",
  );
}

/** Track session directories and refresh state as agents come and go. */
function registerSessionTracking(ctx, workDir, config) {
  ctx.effect(
    () =>
      ctx.on("agent/created", (payload) => {
        const agent = payload?.agent;
        const sid = agent?.id ? String(agent.id) : null;
        if (!sid || sessions.has(sid)) {
          return;
        }
        const cwd = safeDirOf(agent, workDir);
        if (!cwd) {
          return;
        }
        sessions.set(sid, { cwd, git: null, hooks: null, collecting: false });
        scheduleRefresh(sid, config);
      }),
    "dsh-meow-context-hooks: first-touch snapshot collection",
  );

  ctx.effect(
    () =>
      ctx.on("agent/disposed", (payload) => {
        const sid = String(payload?.agent?.id ?? "");
        if (sid) {
          sessions.delete(sid);
          injectedRules.delete(sid);
        }
      }),
    "dsh-meow-context-hooks: session state cleanup",
  );
}

export function apply(ctx, config) {
  const resolved = config ?? {};
  const sys = ctx.get("systemPrompt");
  const workDir = ctx.get("workingDirectory");

  if (sys !== undefined && (resolved.enableGitSnapshot || resolved.enableGitHooksCheck)) {
    registerPromptContexts(ctx, sys, { workDir, config: resolved });
  }
  if (resolved.enableSubdirAgents) {
    registerSubdirRules(ctx, workDir, resolved);
  }
  registerSessionTracking(ctx, workDir, resolved);
}

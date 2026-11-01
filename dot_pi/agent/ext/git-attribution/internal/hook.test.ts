import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildDelegatingHookScript, buildHookScript, DELEGATED_HOOKS } from "./hook.ts";

const HOOK_FILENAME = "prepare-commit-msg";
const CO_AUTHOR = "Co-Authored-By: 白小喵（deepseek-v4.1-flash @ opencode-go） <noreply@pi.dev>";
const GENERATED_BY = "Generated-By: pi 1.4.0";

interface TestRepo {
  root: string;
  hooks: string;
  env: NodeJS.ProcessEnv;
}

function createRepo(t: { after: (fn: () => void) => void }): TestRepo {
  const base = mkdtempSync(join(tmpdir(), "pi-git-attribution-test-"));
  const root = join(base, "repo");
  const hooks = join(base, "hooks");
  mkdirSync(root);
  mkdirSync(hooks);
  const hookPath = join(hooks, HOOK_FILENAME);
  writeFileSync(hookPath, buildHookScript(), { mode: 0o755 });
  chmodSync(hookPath, 0o755);
  const delegate = buildDelegatingHookScript();
  for (const hook of DELEGATED_HOOKS) {
    const path = join(hooks, hook);
    writeFileSync(path, delegate, { mode: 0o755 });
    chmodSync(path, 0o755);
  }

  git(root, ["init", "--quiet", "-b", "main"]);
  git(root, ["config", "user.name", "Test"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "commit.gpgsign", "false"]);

  t.after(() => {
    rmSync(base, { recursive: true, force: true });
  });

  return {
    root,
    hooks,
    env: {
      ...process.env,
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.hooksPath",
      GIT_CONFIG_VALUE_0: hooks,
      PI_GIT_ATTRIBUTION_CONFIG_INDEX: "0",
      PI_GIT_ATTRIBUTION_CO_AUTHOR: CO_AUTHOR,
      PI_GIT_ATTRIBUTION_GENERATED_BY: GENERATED_BY,
    },
  };
}

function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = process.env): string {
  return execFileSync("git", args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

let fileCounter = 0;

function commit(repo: TestRepo, message: string, extraEnv: NodeJS.ProcessEnv = {}): void {
  fileCounter += 1;
  const name = `file-${String(fileCounter)}.txt`;
  writeFileSync(join(repo.root, name), `${String(fileCounter)}\n`);
  git(repo.root, ["add", name]);
  git(repo.root, ["commit", "--quiet", "-m", message], { ...repo.env, ...extraEnv });
}

function lastMessage(repo: TestRepo): string {
  return git(repo.root, ["log", "-1", "--format=%B"]).trim();
}

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

test("普通提交追加规范 trailer", (t) => {
  const repo = createRepo(t);
  commit(repo, "feat: normal");
  const message = lastMessage(repo);
  assert.equal(count(message, CO_AUTHOR), 1);
  assert.equal(count(message, GENERATED_BY), 1);
});

test("规范化旧 agent 署名并保留人类 co-author", (t) => {
  const repo = createRepo(t);
  commit(
    repo,
    [
      "feat: canonical",
      "",
      "Co-Authored-By: 白小喵（glm-5.3） <noreply@pi.dev>",
      "Co-Authored-By: Alice <alice@example.com>",
      "Co-Authored-By: DeepSeek V4.1 Flash <noreply@pi.dev>",
      "Generated-By: pi 0.80.0",
      "Signed-off-by: Bob <bob@example.com>",
    ].join("\n"),
  );
  const message = lastMessage(repo);
  assert.equal(count(message, CO_AUTHOR), 1);
  assert.equal(count(message, GENERATED_BY), 1);
  assert.equal(count(message, "Co-Authored-By: Alice <alice@example.com>"), 1);
  assert.equal(count(message, "Signed-off-by: Bob <bob@example.com>"), 1);
  assert.equal(count(message, "glm-5.3"), 0);
  assert.equal(count(message, "DeepSeek V4.1 Flash"), 0);
  assert.equal(count(message, "0.80.0"), 0);
});

test("amend 不重复追加", (t) => {
  const repo = createRepo(t);
  commit(repo, "feat: amend");
  fileCounter += 1;
  const name = `file-${String(fileCounter)}.txt`;
  writeFileSync(join(repo.root, name), "amend\n");
  git(repo.root, ["add", name]);
  git(repo.root, ["commit", "--quiet", "--amend", "--no-edit"], repo.env);
  assert.equal(count(lastMessage(repo), CO_AUTHOR), 1);
});

test("merge 提交跳过署名", (t) => {
  const repo = createRepo(t);
  commit(repo, "base");
  git(repo.root, ["checkout", "--quiet", "-b", "side"]);
  commit(repo, "side");
  git(repo.root, ["checkout", "--quiet", "main"]);
  commit(repo, "main");
  git(repo.root, ["merge", "--quiet", "--no-ff", "side", "-m", "merge side"], repo.env);
  assert.equal(count(lastMessage(repo), CO_AUTHOR), 0);
});

test("环境变量退出仍执行原有 hook", (t) => {
  const repo = createRepo(t);
  installOriginalHook(repo, "exit 0");
  commit(repo, "feat: opt out", { PI_GIT_ATTRIBUTION: "0" });
  const message = lastMessage(repo);
  assert.equal(count(message, CO_AUTHOR), 0);
  assert.equal(count(message, "ORIGINAL_HOOK_RAN"), 1);
});

test("仓库退出仍执行原有 hook", (t) => {
  const repo = createRepo(t);
  installOriginalHook(repo, "exit 0");
  git(repo.root, ["config", "--local", "pi.attribution", "false"]);
  commit(repo, "feat: repo opt out");
  const message = lastMessage(repo);
  assert.equal(count(message, CO_AUTHOR), 0);
  assert.equal(count(message, "ORIGINAL_HOOK_RAN"), 1);
});

test("链式执行仓库原有 hook", (t) => {
  const repo = createRepo(t);
  installOriginalHook(repo, "exit 0");
  commit(repo, "feat: chain");
  const message = lastMessage(repo);
  assert.equal(count(message, CO_AUTHOR), 1);
  assert.equal(count(message, "ORIGINAL_HOOK_RAN"), 1);
});

test("pre-commit 照常执行", (t) => {
  const repo = createRepo(t);
  installHook(repo, "pre-commit", `printf 'PRE_COMMIT_RAN\\n' >> "$PWD/pre-commit.txt"`);
  commit(repo, "feat: pre-commit");
  assert.equal(readFileSync(join(repo.root, "pre-commit.txt"), "utf8").trim(), "PRE_COMMIT_RAN");
  assert.equal(count(lastMessage(repo), CO_AUTHOR), 1);
});

test("pre-commit 失败中止提交", (t) => {
  const repo = createRepo(t);
  installHook(repo, "pre-commit", "exit 7");
  fileCounter += 1;
  const name = `file-${String(fileCounter)}.txt`;
  writeFileSync(join(repo.root, name), "fail\n");
  git(repo.root, ["add", name]);
  const result = spawnSync("git", ["commit", "--quiet", "-m", "feat: pre-commit fail"], {
    cwd: repo.root,
    env: repo.env,
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.equal(git(repo.root, ["rev-list", "-n", "1", "--all"]).trim(), "");
});

test("commit-msg 照常执行", (t) => {
  const repo = createRepo(t);
  installHook(repo, "commit-msg", `printf 'COMMIT_MSG_RAN\\n' >> "$PWD/commit-msg.txt"`);
  commit(repo, "feat: commit-msg");
  assert.equal(readFileSync(join(repo.root, "commit-msg.txt"), "utf8").trim(), "COMMIT_MSG_RAN");
});

test("post-commit 照常执行", (t) => {
  const repo = createRepo(t);
  installHook(repo, "post-commit", `printf 'POST_COMMIT_RAN\\n' >> "$PWD/post-commit.txt"`);
  commit(repo, "feat: post-commit");
  assert.equal(readFileSync(join(repo.root, "post-commit.txt"), "utf8").trim(), "POST_COMMIT_RAN");
});

test("原有 hook 失败时中止提交", (t) => {
  const repo = createRepo(t);
  installOriginalHook(repo, "exit 7");
  fileCounter += 1;
  const name = `file-${String(fileCounter)}.txt`;
  writeFileSync(join(repo.root, name), "fail\n");
  git(repo.root, ["add", name]);
  const result = spawnSync("git", ["commit", "--quiet", "-m", "feat: fail"], {
    cwd: repo.root,
    env: repo.env,
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.equal(git(repo.root, ["rev-list", "-n", "1", "--all"]).trim(), "");
});

test("--no-verify 仍追加署名", (t) => {
  const repo = createRepo(t);
  fileCounter += 1;
  const name = `file-${String(fileCounter)}.txt`;
  writeFileSync(join(repo.root, name), "no verify\n");
  git(repo.root, ["add", name]);
  git(repo.root, ["commit", "--quiet", "--no-verify", "-m", "feat: no verify"], repo.env);
  assert.equal(count(lastMessage(repo), CO_AUTHOR), 1);
});

test("脚本内提交也覆盖", { skip: process.platform === "win32" }, (t) => {
  const repo = createRepo(t);
  fileCounter += 1;
  const name = `file-${String(fileCounter)}.txt`;
  writeFileSync(join(repo.root, name), "script\n");
  git(repo.root, ["add", name]);
  const script = join(repo.root, "commit.sh");
  writeFileSync(script, '#!/bin/sh\ngit commit --quiet -m "feat: script"\n', { mode: 0o755 });
  chmodSync(script, 0o755);
  execFileSync("sh", [script], {
    cwd: repo.root,
    env: repo.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(count(lastMessage(repo), CO_AUTHOR), 1);
});

function installOriginalHook(repo: TestRepo, behavior: string): void {
  installHook(repo, HOOK_FILENAME, `printf '\\nORIGINAL_HOOK_RAN\\n' >> "$1"\n${behavior}`);
}

function installHook(repo: TestRepo, name: string, body: string): void {
  const dir = join(repo.root, ".githooks");
  mkdirSync(dir, { recursive: true });
  const hook = join(dir, name);
  writeFileSync(hook, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  chmodSync(hook, 0o755);
  git(repo.root, ["config", "core.hooksPath", ".githooks"]);
}

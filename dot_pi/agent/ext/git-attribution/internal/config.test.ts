import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { applyConfig, DEFAULT_CONFIG, loadConfig, normalizeEmail, sanitizeName } from "./config.ts";

test("默认身份", () => {
  assert.deepEqual(DEFAULT_CONFIG, {
    coAuthor: { name: "白小喵", email: "noreply@pi.dev" },
  });
});

test("字段级合并并清洗值", () => {
  const config = {
    coAuthor: { ...DEFAULT_CONFIG.coAuthor },
  };
  applyConfig(
    config,
    {
      coAuthor: {
        name: " 猫猫 ",
        email: "<meow@example.com>",
      },
    },
    "test",
  );
  assert.deepEqual(config.coAuthor, {
    name: "猫猫",
    email: "meow@example.com",
  });
});

test("非法字段保留上一层值", () => {
  const config = {
    coAuthor: { name: "全局", email: "global@example.com" },
  };
  applyConfig(
    config,
    {
      coAuthor: {
        name: 42,
        email: "not-an-email",
      },
    },
    "test",
  );
  assert.deepEqual(config.coAuthor, {
    name: "全局",
    email: "global@example.com",
  });
});

test("未知键告警并忽略", () => {
  const config = {
    coAuthor: { ...DEFAULT_CONFIG.coAuthor },
  };
  applyConfig(
    config,
    {
      coAuthors: { name: "忽略" },
      coAuthor: { name: "保留" },
    },
    "test",
  );
  assert.equal(config.coAuthor.name, "保留");
});

test("姓名与邮箱清洗边界", () => {
  assert.equal(sanitizeName("  "), "白小喵");
  assert.equal(sanitizeName(" 猫\n猫 "), "猫 猫");
  assert.equal(normalizeEmail("<meow@example.com>"), "meow@example.com");
  assert.equal(normalizeEmail("not-an-email"), undefined);
});

test("全局配置生效", (t) => {
  const base = mkdtempSync(join(tmpdir(), "pi-git-attribution-config-"));
  const agentDir = join(base, "agent");
  const repo = join(base, "repo");
  mkdirSync(agentDir);
  mkdirSync(repo);
  git(repo, ["init", "--quiet"]);
  writeFileSync(
    join(agentDir, "git-attribution.json"),
    JSON.stringify({ coAuthor: { name: "全局", email: "global@example.com" } }),
  );
  t.after(() => rmSync(base, { recursive: true, force: true }));

  assert.deepEqual(loadConfig(repo, agentDir).coAuthor, {
    name: "全局",
    email: "global@example.com",
  });
});

test("仓库配置字段级覆盖全局", (t) => {
  const base = mkdtempSync(join(tmpdir(), "pi-git-attribution-config-"));
  const agentDir = join(base, "agent");
  const repo = join(base, "repo");
  mkdirSync(agentDir);
  mkdirSync(repo);
  git(repo, ["init", "--quiet"]);
  writeFileSync(
    join(agentDir, "git-attribution.json"),
    JSON.stringify({ coAuthor: { name: "全局", email: "global@example.com" } }),
  );
  mkdirSync(join(repo, ".pi"));
  writeFileSync(
    join(repo, ".pi", "git-attribution.json"),
    JSON.stringify({ coAuthor: { email: "repo@example.com" } }),
  );
  t.after(() => rmSync(base, { recursive: true, force: true }));

  assert.deepEqual(loadConfig(repo, agentDir).coAuthor, {
    name: "全局",
    email: "repo@example.com",
  });
});

test("缺失与损坏配置退回默认", (t) => {
  const base = mkdtempSync(join(tmpdir(), "pi-git-attribution-config-"));
  const agentDir = join(base, "agent");
  const repo = join(base, "repo");
  mkdirSync(agentDir);
  mkdirSync(repo);
  git(repo, ["init", "--quiet"]);
  t.after(() => rmSync(base, { recursive: true, force: true }));

  assert.deepEqual(loadConfig(repo, agentDir).coAuthor, DEFAULT_CONFIG.coAuthor);

  writeFileSync(join(agentDir, "git-attribution.json"), "{ broken");
  assert.deepEqual(loadConfig(repo, agentDir).coAuthor, DEFAULT_CONFIG.coAuthor);
});

test("非仓库目录只读全局配置", (t) => {
  const base = mkdtempSync(join(tmpdir(), "pi-git-attribution-config-"));
  const agentDir = join(base, "agent");
  const cwd = join(base, "plain");
  mkdirSync(agentDir);
  mkdirSync(cwd);
  writeFileSync(
    join(agentDir, "git-attribution.json"),
    JSON.stringify({ coAuthor: { name: "全局" } }),
  );
  t.after(() => rmSync(base, { recursive: true, force: true }));

  assert.deepEqual(loadConfig(cwd, agentDir).coAuthor, {
    name: "全局",
    email: "noreply@pi.dev",
  });
});

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

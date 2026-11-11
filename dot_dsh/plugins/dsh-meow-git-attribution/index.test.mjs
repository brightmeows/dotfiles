/**
 * dsh-meow-git-attribution 逻辑冒烟：mock cordis 的 ctx.on 捕获监听器，
 * 直接驱动 tools/pre-execute 校验改写行为。真实通道的端到端验证以
 * 临时 git 仓库的实提提交为准。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { apply } from "./index.js";

function mount() {
  const handlers = {};
  const ctx = {
    on(event, listener) {
      handlers[event] = listener;
      return () => {};
    },
  };
  apply(ctx);
  return handlers["tools/pre-execute"];
}

test("单 -m 双引号：追加 trailer", async () => {
  const pre = mount();
  const exec = { name: "bash", arguments: { command: 'git commit -m "test: x"' } };
  await pre(exec, async () => "passed");
  assert.equal(
    exec.arguments.command,
    'git commit -m "test: x\n\nCo-Authored-By: 白小喵 <noreply@pi.dev>"',
  );
});

test("多 -m：trailer 追加到最后一段", async () => {
  const pre = mount();
  const exec = {
    name: "bash",
    arguments: { command: 'git commit -m "feat: a" -m "body line"' },
  };
  await pre(exec, async () => "passed");
  assert.ok(exec.arguments.command.includes('"body line\n\nCo-Authored-By: 白小喵'));
  assert.ok(!exec.arguments.command.includes('"feat: a\n\nCo-Authored-By'));
});

test("单引号消息：同样追加", async () => {
  const pre = mount();
  const exec = { name: "bash", arguments: { command: "git add -A && git commit -m 'chore: y'" } };
  await pre(exec, async () => "passed");
  assert.ok(
    exec.arguments.command.includes("'chore: y\n\nCo-Authored-By: 白小喵 <noreply@pi.dev>'"),
  );
});

test("已有 trailer：幂等放行", async () => {
  const pre = mount();
  const original = 'git commit -m "test: x\n\nCo-Authored-By: 白小喵 <noreply@pi.dev>"';
  const exec = { name: "bash", arguments: { command: original } };
  await pre(exec, async () => "passed");
  assert.equal(exec.arguments.command, original);
});

test("非 commit 命令：不动", async () => {
  const pre = mount();
  const exec = { name: "bash", arguments: { command: "git status -sb" } };
  await pre(exec, async () => "passed");
  assert.equal(exec.arguments.command, "git status -sb");
});

test("-F 文件消息与裸 -m：无法安全改写，放行", async () => {
  const pre = mount();
  const f = { name: "bash", arguments: { command: "git commit -F /tmp/msg.txt" } };
  await pre(f, async () => "passed");
  assert.equal(f.arguments.command, "git commit -F /tmp/msg.txt");
  const bare = { name: "bash", arguments: { command: "git commit -m fix" } };
  await pre(bare, async () => "passed");
  assert.equal(bare.arguments.command, "git commit -m fix");
});

test("非 bash 工具：不动", async () => {
  const pre = mount();
  const exec = { name: "read", arguments: { file_path: "x" } };
  await pre(exec, async () => "passed");
  assert.deepEqual(exec.arguments, { file_path: "x" });
});

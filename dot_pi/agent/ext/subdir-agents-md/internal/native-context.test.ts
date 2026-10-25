import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test, { type TestContext } from "node:test";
import { collectNativeContextHashes, hashOf, stripBom } from "./native-context.ts";

/** 每用例独立 mkdtemp，测后清理 */
function tmpdir(t: TestContext): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "native-ctx-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** 写文件（含父目录创建） */
function write(p: string, content: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

/** 最小 .git 目录（findGitPaths 只校验 HEAD 存在） */
function makeGitDir(p: string): void {
  write(path.join(p, "HEAD"), "ref: refs/heads/main\n");
}

/**
 * 最小 linked worktree 结构：wt/.git 文件 gitdir: 指向
 * <repo>/.git/worktrees/<name>，其 commondir 文件指回主 .git
 */
function makeWorktreeLink(repoDir: string, wtDir: string, wtName: string): void {
  const gitDir = path.join(repoDir, ".git", "worktrees", wtName);
  write(path.join(gitDir, "HEAD"), "ref: refs/heads/feature\n");
  // 真实 git 的 commondir 内容是相对 gitDir 的路径：.git/worktrees/<名> 回 .git 要上两级
  write(path.join(gitDir, "commondir"), "../..");
  write(path.join(wtDir, ".git"), `gitdir: ${gitDir}\n`);
}

test("普通仓库根规则文件进基准集", (t) => {
  const base = tmpdir(t);
  const proj = path.join(base, "proj");
  makeGitDir(path.join(proj, ".git"));
  write(path.join(proj, "AGENTS.md"), "X");
  const hashes = collectNativeContextHashes(proj, path.join(base, "agent"));
  assert.ok(hashes.has(hashOf("X")));
});

test("非 git 目录照样收集祖先链", (t) => {
  const base = tmpdir(t);
  const proj = path.join(base, "proj");
  write(path.join(proj, "AGENTS.md"), "X");
  const hashes = collectNativeContextHashes(proj, path.join(base, "agent"));
  assert.ok(hashes.has(hashOf("X")));
});

test("嵌套 worktree（cwd 在主树）：副本同内容命中基准集", (t) => {
  const base = tmpdir(t);
  const proj = path.join(base, "proj");
  makeGitDir(path.join(proj, ".git"));
  write(path.join(proj, "AGENTS.md"), "X");
  const wt = path.join(proj, ".worktrees", "wt");
  makeWorktreeLink(proj, wt, "wt");
  write(path.join(wt, "AGENTS.md"), "X");
  const hashes = collectNativeContextHashes(proj, path.join(base, "agent"));
  assert.ok(hashes.has(hashOf("X")));
});

test("cwd 在嵌套 worktree 内：主树文件被 shadow 不进集", (t) => {
  const base = tmpdir(t);
  const proj = path.join(base, "proj");
  makeGitDir(path.join(proj, ".git"));
  write(path.join(proj, "AGENTS.md"), "X");
  const wt = path.join(proj, ".worktrees", "wt");
  makeWorktreeLink(proj, wt, "wt");
  write(path.join(wt, "AGENTS.md"), "Y");
  const hashes = collectNativeContextHashes(wt, path.join(base, "agent"));
  assert.ok(hashes.has(hashOf("Y")));
  assert.ok(!hashes.has(hashOf("X")));
});

test("cwd 在嵌套 worktree 内但主树无规则文件：无 shadow 可言", (t) => {
  const base = tmpdir(t);
  const proj = path.join(base, "proj");
  makeGitDir(path.join(proj, ".git"));
  const wt = path.join(proj, ".worktrees", "wt");
  makeWorktreeLink(proj, wt, "wt");
  write(path.join(wt, "AGENTS.md"), "Y");
  const hashes = collectNativeContextHashes(wt, path.join(base, "agent"));
  assert.ok(hashes.has(hashOf("Y")));
});

test("平级 worktree：无 shadow，各自独立进集", (t) => {
  const base = tmpdir(t);
  const main = path.join(base, "main");
  makeGitDir(path.join(main, ".git"));
  write(path.join(main, "AGENTS.md"), "X");
  const wt = path.join(base, "wt-sib");
  makeWorktreeLink(main, wt, "sib");
  write(path.join(wt, "AGENTS.md"), "Y");
  const hashes = collectNativeContextHashes(wt, path.join(base, "agent"));
  assert.ok(hashes.has(hashOf("Y")));
  assert.ok(!hashes.has(hashOf("X")));
});

test("大小写变体被识别且按候选优先序选定", (t) => {
  const base = tmpdir(t);
  const proj = path.join(base, "proj");
  makeGitDir(path.join(proj, ".git"));
  write(path.join(proj, "AGENTS.MD"), "V");
  write(path.join(proj, "CLAUDE.md"), "C");
  const hashes = collectNativeContextHashes(proj, path.join(base, "agent"));
  assert.ok(hashes.has(hashOf("V")));
  assert.ok(!hashes.has(hashOf("C")));
});

test("agentDir 全局规则进集", (t) => {
  const base = tmpdir(t);
  const proj = path.join(base, "proj");
  makeGitDir(path.join(proj, ".git"));
  const agentDir = path.join(base, "agent");
  write(path.join(agentDir, "AGENTS.md"), "G");
  const hashes = collectNativeContextHashes(proj, agentDir);
  assert.ok(hashes.has(hashOf("G")));
});

test("BOM 按去 BOM 口径指纹", (t) => {
  const base = tmpdir(t);
  const proj = path.join(base, "proj");
  makeGitDir(path.join(proj, ".git"));
  write(path.join(proj, "AGENTS.md"), "\uFEFFX");
  const hashes = collectNativeContextHashes(proj, path.join(base, "agent"));
  assert.ok(hashes.has(hashOf("X")));
  assert.ok(!hashes.has(hashOf("\uFEFFX")));
  assert.equal(stripBom("\uFEFFX"), "X");
  assert.equal(stripBom("X"), "X");
});

test("祖先链上多目录各有规则文件时全部进集", (t) => {
  const base = tmpdir(t);
  const proj = path.join(base, "proj");
  makeGitDir(path.join(proj, ".git"));
  write(path.join(proj, "AGENTS.md"), "ROOT");
  write(path.join(proj, "sub", "AGENTS.md"), "SUB");
  const hashes = collectNativeContextHashes(path.join(proj, "sub"), path.join(base, "agent"));
  assert.ok(hashes.has(hashOf("ROOT")));
  assert.ok(hashes.has(hashOf("SUB")));
});

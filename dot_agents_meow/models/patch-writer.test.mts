/** Patch-writer 的组合逻辑测试：node --test dot_agents_meow/models/patch-writer.test.mts */

import assert from "node:assert/strict";
import { test } from "node:test";
import { MARKER_END, MARKER_START } from "./config.mts";
import { composeManagedBlock, stripManagedBlock } from "./patch-writer.mts";

const BLOCK = ["- id: llm-pi-ai", "  config:", "    providers: {}"].join("\n");
const FULL = `${MARKER_START}\n${BLOCK}\n${MARKER_END}\n`;
const TEMPLATE = [
  "# Your patch layer for this dsh profile, applied after every bundle layer:",
  "# a top-level YAML array of loader patch entries.",
  "[]",
  "",
].join("\n");

test("空文件写入生成块", () => {
  assert.equal(composeManagedBlock("", BLOCK), FULL);
});

test("纯空数组模板替换为生成块", () => {
  assert.equal(composeManagedBlock("[]\n", BLOCK), FULL);
});

test("带注释的模板保留注释并去掉空数组", () => {
  const result = composeManagedBlock(TEMPLATE, BLOCK);
  assert.ok(result.includes("# Your patch layer"));
  assert.ok(!result.includes("\n[]\n"));
  assert.ok(result.endsWith(FULL));
});

test("用户内容保留在生成块之前", () => {
  const result = composeManagedBlock("- id: user-row\n  config: {}\n", BLOCK);
  assert.equal(result, `- id: user-row\n  config: {}\n\n${FULL}`);
});

test("既有生成块被替换且幂等", () => {
  const once = composeManagedBlock(TEMPLATE, BLOCK);
  const twice = composeManagedBlock(once, BLOCK);
  assert.equal(twice, once);
});

test("生成块后的用户内容保留", () => {
  const withTail = `${TEMPLATE}${FULL}- id: tail-row\n`;
  const result = composeManagedBlock(withTail, BLOCK);
  assert.ok(result.includes("- id: tail-row"));
  assert.ok(result.indexOf("- id: llm-pi-ai") < result.indexOf("- id: tail-row"));
});

test("stripManagedBlock 只去掉生成块", () => {
  const withTail = `${TEMPLATE}${FULL}- id: tail-row\n`;
  const residual = stripManagedBlock(withTail);
  assert.ok(!residual.includes(MARKER_START));
  assert.ok(residual.includes("- id: tail-row"));
});

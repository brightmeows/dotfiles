import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compareDeclaration, computeFolderHash, parseDeclaredSkills } from "./check-skills.mjs";

test("parseDeclaredSkills 只读取工作流技能节的列表", () => {
  const markdown = [
    "### 工作流技能",
    "",
    "- `grilling`：盘问方案与决策",
    "- `ai-taste`：审中文 AI 味",
    "",
    "## 方法论",
    "",
    "- `not-a-skill`：不应解析",
  ].join("\n");
  assert.deepEqual(
    parseDeclaredSkills(markdown).map((skill) => skill.name),
    ["grilling", "ai-taste"],
  );
});

test("parseDeclaredSkills 拒绝重复技能", () => {
  const markdown = "### 工作流技能\n\n- `grilling`：一\n- `grilling`：二\n";
  assert.throws(() => parseDeclaredSkills(markdown), /技能重复/u);
});

test("parseDeclaredSkills 拒绝空清单", () => {
  assert.throws(() => parseDeclaredSkills("### 工作流技能\n\n没有列表\n"), /没有解析到技能条目/u);
});

test("compareDeclaration 报告缺项与多项", () => {
  const declared = [{ name: "grilling" }, { name: "ai-taste" }];
  const lock = {
    skills: {
      grilling: `sha256:${"0".repeat(64)}`,
      extra: `sha256:${"0".repeat(64)}`,
    },
  };
  assert.deepEqual(compareDeclaration(declared, lock), { missing: ["ai-taste"], extra: ["extra"] });
});

test("computeFolderHash 与文件遍历顺序无关", () => {
  const dir = mkdtempSync(join(tmpdir(), "skills-hash-"));
  mkdirSync(join(dir, "nested"));
  writeFileSync(join(dir, "b.md"), "b");
  writeFileSync(join(dir, "a.md"), "a");
  writeFileSync(join(dir, "nested", "c.md"), "c");
  const first = computeFolderHash(dir);
  const second = computeFolderHash(dir);
  assert.equal(first, second);
  assert.match(first, /^sha256:[0-9a-f]{64}$/u);
});

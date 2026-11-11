/**
 * dsh-prompt-relocation 逻辑级冒烟：用真实 dsh-system-prompt 服务挂载
 * 插件 waterfall，断言非保留段被迁入上下文快照、保留段原位不动。
 *
 * 服务包从本机 dsh 安装的 mise store 解析（绝对路径），测试前在临时
 * 目录建 node_modules 符号链接；store 缺失时跳过（CI 或换机无 dsh）。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

function resolveStoreNodeModules() {
  const installs = path.join(
    process.env.HOME ?? "",
    ".local/share/mise/installs/npm-deepseek-ai-dsh",
  );
  if (!fs.existsSync(installs)) return undefined;
  for (const version of fs.readdirSync(installs)) {
    const store = path.join(installs, version, "node_modules/.mise");
    if (!fs.existsSync(store)) continue;
    for (const entry of fs.readdirSync(store)) {
      if (!entry.startsWith("@deepseek-ai+dsh-system-prompt@")) continue;
      const nodeModules = path.join(store, entry, "node_modules");
      if (fs.existsSync(path.join(nodeModules, "@deepseek-ai/dsh-system-prompt"))) {
        return nodeModules;
      }
    }
  }
  return undefined;
}

async function loadHarness() {
  const storeNodeModules = resolveStoreNodeModules();
  if (!storeNodeModules) return undefined;
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-reloc-test-"));
  fs.mkdirSync(path.join(sandbox, "node_modules/@deepseek-ai"), { recursive: true });
  for (const name of ["cordis", "dsh-llm", "dsh-scope", "dsh-system-prompt", "schemastery"]) {
    fs.symlinkSync(
      path.join(storeNodeModules, "@deepseek-ai", name),
      path.join(sandbox, "node_modules/@deepseek-ai", name),
      "dir",
    );
  }
  const { SystemPrompt, renderPrompt, renderContextSections } = await import(
    require.resolve("@deepseek-ai/dsh-system-prompt", { paths: [sandbox] })
  );
  const { Context } = await import(require.resolve("@deepseek-ai/cordis", { paths: [sandbox] }));
  return { SystemPrompt, Context, renderPrompt, renderContextSections };
}

test("extension sections move into the snapshot; first-party sections stay", async (t) => {
  const harness = await loadHarness();
  if (!harness) return t.skip("dsh mise store not found on this machine");
  const { SystemPrompt, Context, renderPrompt, renderContextSections } = harness;

  const { apply } = await import(path.join(here, "index.js"));
  const root = new Context();
  const systemPrompt = new SystemPrompt(root, {});
  systemPrompt.section({
    name: "tool:bash",
    order: 1000,
    text: "Prefer bash for file operations.",
  });
  systemPrompt.section({
    name: "mcp-resource-servers",
    order: 3100,
    text: "MCP server alpha offers widgets.",
  });
  systemPrompt.context({
    name: "working-directory",
    order: 100,
    text: "Working directory is /tmp.",
  });

  const dispose = apply(root, {});
  t.after(() => dispose());
  const assembly = await systemPrompt.assemble();

  const sectionNames = new Set(assembly.sections.map((s) => s.name));
  const contextNames = assembly.contexts.map((c) => c.name);
  const provenance = renderContextSections(assembly).map((s) => s.name);
  const prompt = renderPrompt(assembly);

  assert(sectionNames.has("tool:bash"), "tool:bash should stay in the system prompt");
  assert(sectionNames.has("harness:identity"), "harness identity should stay");
  assert(!sectionNames.has("mcp-resource-servers"), "moved section should leave the system prompt");
  assert(!prompt.includes("MCP server alpha"), "moved text should leave the prompt");
  assert(
    contextNames.includes("relocated:mcp-resource-servers"),
    "moved section joins the snapshot",
  );
  assert(provenance.includes("relocated:mcp-resource-servers"), "snapshot keeps provenance name");
  assert(prompt.includes("Prefer bash"), "kept section text survives rendering");
});

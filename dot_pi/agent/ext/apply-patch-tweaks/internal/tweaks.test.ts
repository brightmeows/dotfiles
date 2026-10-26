import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import applyPatchTweaks from "../index.ts";

type Handler = (event: any) => unknown;

function harness(description: string): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  const pi = {
    on: (name: string, handler: Handler) => {
      handlers.set(name, handler);
    },
    getAllTools: () => [{ name: "apply_patch", description }],
  } as unknown as ExtensionAPI;
  applyPatchTweaks(pi);
  return handlers;
}

function systemOptions(): { toolGuidelines: Record<string, string[]> } {
  return { toolGuidelines: {} };
}

test("adds the Add File rule while the tool description lacks it", () => {
  const handlers = harness("old description");
  const options = systemOptions();
  handlers.get("before_agent_start")!({ systemPromptOptions: options });
  const lines = options.toolGuidelines["apply_patch"] ?? [];
  assert.ok(lines.some((line) => line.includes("including blank lines")));
  assert.ok(lines.some((line) => line.includes("one '*** Update File:' header")));
});

test("does not duplicate guidance after the upstream description owns the rule", () => {
  const handlers = harness(
    "Every line of an Add File body, including blank lines, must start with '+'.",
  );
  const options = systemOptions();
  handlers.get("before_agent_start")!({ systemPromptOptions: options });
  handlers.get("before_agent_start")!({ systemPromptOptions: options });
  const lines = options.toolGuidelines["apply_patch"] ?? [];
  assert.equal(new Set(lines).size, lines.length);
  assert.equal(
    lines.some((line) => line.includes("including blank lines")),
    false,
  );
});

test("repairs a patch on tool_call and annotates the result", () => {
  const handlers = harness("old description");
  const call = {
    toolName: "apply_patch",
    toolCallId: "call-1",
    input: {
      input: "*** Begin Patch\n*** Add File: n.txt\n+hello\n\n+world\n*** End Patch",
    },
  };
  handlers.get("tool_call")!(call);
  assert.match(call.input.input, /\+\n/u);

  const result = {
    toolName: "apply_patch",
    toolCallId: "call-1",
    content: [{ type: "text", text: "Success." }],
  };
  handlers.get("tool_result")!(result);
  assert.equal(result.content.length, 2);
  assert.match(result.content[1]!.text, /input repaired/u);
});

test("ignores other tools", () => {
  const handlers = harness("old description");
  const call = { toolName: "read", toolCallId: "call-2", input: { path: "a" } };
  handlers.get("tool_call")!(call);
  assert.deepEqual(call.input, { path: "a" });
});

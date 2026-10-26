import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import applyPatchTweaks from "../index.ts";

type Handler = (event: any) => unknown;

function harness(): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  const pi = {
    on: (name: string, handler: Handler) => {
      handlers.set(name, handler);
    },
  } as unknown as ExtensionAPI;
  applyPatchTweaks(pi);
  return handlers;
}

test("repairs a patch on tool_call and annotates the result", () => {
  const handlers = harness();
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
  const handlers = harness();
  const call = { toolName: "read", toolCallId: "call-2", input: { path: "a" } };
  handlers.get("tool_call")!(call);
  assert.deepEqual(call.input, { path: "a" });
});

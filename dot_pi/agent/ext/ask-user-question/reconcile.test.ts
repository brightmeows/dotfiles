import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ASK_USER_QUESTION_TOOL_NAME } from "./ask-user-question.ts";
import { reconcileAskUserQuestionTool } from "./reconcile.ts";

function harness(initial: readonly string[], hasUI: boolean) {
  const calls: string[][] = [];
  let active = [...initial];
  const pi = {
    getActiveTools: () => [...active],
    setActiveTools: (next: string[]) => {
      calls.push([...next]);
      active = [...next];
    },
  } as unknown as ExtensionAPI;
  const ctx = { hasUI } as unknown as ExtensionContext;
  return { pi, ctx, calls, active: () => active };
}

test("strips the tool when the run has no UI", () => {
  const { pi, ctx, calls, active } = harness(["read", ASK_USER_QUESTION_TOOL_NAME], false);
  reconcileAskUserQuestionTool(pi, ctx);
  assert.deepEqual(calls, [["read"]]);
  assert.deepEqual(active(), ["read"]);
});

test("leaves a headless active set alone when the tool is absent", () => {
  const { pi, ctx, calls } = harness(["read"], false);
  reconcileAskUserQuestionTool(pi, ctx);
  assert.deepEqual(calls, []);
});

test("does not re-add the tool in interactive runs", () => {
  const { pi, ctx, calls } = harness(["read"], true);
  reconcileAskUserQuestionTool(pi, ctx);
  assert.deepEqual(calls, []);
});

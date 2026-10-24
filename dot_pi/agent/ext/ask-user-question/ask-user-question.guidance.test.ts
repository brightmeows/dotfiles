import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_PROMPT_GUIDELINES, DEFAULT_TOOL_DESCRIPTION } from "./ask-user-question.ts";

test("states the header and label limits before a call", () => {
  const guidance = DEFAULT_PROMPT_GUIDELINES.join("\n");
  for (const text of [guidance, DEFAULT_TOOL_DESCRIPTION]) {
    assert.match(text, /maximum 16 characters/);
    assert.match(text, /maximum 60 characters/);
    assert.match(text, /Requests that exceed these limits fail validation/);
  }
  assert.equal(DEFAULT_PROMPT_GUIDELINES.length, 5);
  assert.doesNotMatch(guidance, /1-4|MAX_QUESTIONS/);
});

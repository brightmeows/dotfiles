import assert from "node:assert/strict";
import test from "node:test";
import type { QuestionParams } from "./types.ts";
import {
  normalizeLineTerminators,
  normalizeQuestionParams,
  prepareQuestionArguments,
} from "./normalize-params.ts";

test("normalizes CRLF and drops lone carriage returns", () => {
  assert.equal(normalizeLineTerminators("a\r\nb\rc"), "a\nbc");
  assert.equal(normalizeLineTerminators("GEMBA\r_LOG\r_FILE"), "GEMBA_LOG_FILE");
});

test("normalizes every user-facing field without mutating the input", () => {
  const params: QuestionParams = {
    questions: [
      {
        question: "Q\r?",
        header: "H\r",
        options: [{ label: "L\r", description: "D\r", preview: "P\r" }],
      },
    ],
  };
  const out = normalizeQuestionParams(params);
  assert.equal(out.questions[0]?.question, "Q?");
  assert.equal(out.questions[0]?.header, "H");
  assert.equal(out.questions[0]?.options[0]?.label, "L");
  assert.equal(out.questions[0]?.options[0]?.description, "D");
  assert.equal(out.questions[0]?.options[0]?.preview, "P");
  assert.equal(params.questions[0]?.question, "Q\r?");
});

test("keeps an absent preview absent", () => {
  const out = normalizeQuestionParams({
    questions: [
      {
        question: "Q?",
        header: "H",
        options: [{ label: "A", description: "a" }],
      },
    ],
  });
  assert.equal("preview" in (out.questions[0]?.options[0] ?? {}), false);
});

test("decodes double-encoded questions and options", () => {
  const out = prepareQuestionArguments({
    questions: JSON.stringify([
      {
        question: "Q?",
        header: "H",
        options: JSON.stringify([{ label: "A", description: "a" }]),
      },
    ]),
  });
  assert.equal(out.questions[0]?.header, "H");
  assert.equal(out.questions[0]?.options[0]?.label, "A");
});

test("passes malformed input through untouched", () => {
  const args = { questions: "[not json" };
  assert.deepEqual(prepareQuestionArguments(args), args);
  assert.equal(prepareQuestionArguments("not a record"), "not a record");
});

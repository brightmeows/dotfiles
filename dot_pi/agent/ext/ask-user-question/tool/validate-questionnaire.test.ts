import assert from "node:assert/strict";
import test from "node:test";
import type { QuestionData, QuestionParams } from "./types.ts";
import { validateQuestionnaire } from "./validate-questionnaire.ts";

function question(index: number): QuestionData {
  return {
    question: `Question ${index}?`,
    header: `H${index}`,
    options: [
      { label: `A${index}`, description: "first" },
      { label: `B${index}`, description: "second" },
    ],
  };
}

function params(questions: QuestionData[]): QuestionParams {
  return { questions };
}

test("accepts more questions than the removed four-question limit", () => {
  const questions = Array.from({ length: 12 }, (_, index) => question(index));
  assert.deepEqual(validateQuestionnaire(params(questions)), { ok: true });
});

test("rejects an empty questionnaire", () => {
  const result = validateQuestionnaire(params([]));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "no_questions");
});

test("rejects duplicate question text", () => {
  const result = validateQuestionnaire(params([question(1), question(1)]));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "duplicate_question");
});

test("rejects reserved option labels", () => {
  const duplicate = question(1);
  duplicate.options = [
    { label: "Other", description: "reserved" },
    { label: "B1", description: "second" },
  ];
  const result = validateQuestionnaire(params([duplicate]));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "reserved_label");
});

test("rejects fewer than two options", () => {
  const sparse = question(1);
  sparse.options = [{ label: "A1", description: "only" }];
  const result = validateQuestionnaire(params([sparse]));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "empty_options");
});

test("rejects duplicate option labels", () => {
  const duplicate = question(1);
  duplicate.options = [
    { label: "A1", description: "first" },
    { label: "A1", description: "second" },
  ];
  const result = validateQuestionnaire(params([duplicate]));
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "duplicate_option_label");
});

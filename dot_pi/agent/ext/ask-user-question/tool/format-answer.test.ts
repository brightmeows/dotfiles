import assert from "node:assert/strict";
import test from "node:test";
import { formatAnswerScalar, NO_INPUT_PLACEHOLDER } from "./format-answer.ts";

const base = { questionIndex: 0, question: "Q?" };

test("formats option answers", () => {
  assert.equal(formatAnswerScalar({ ...base, kind: "option", answer: "A" }, "summary"), "A");
  assert.equal(
    formatAnswerScalar({ ...base, kind: "option", answer: null }, "envelope"),
    NO_INPUT_PLACEHOLDER,
  );
});

test("formats custom answers and empty drafts", () => {
  assert.equal(
    formatAnswerScalar({ ...base, kind: "custom", answer: "typed" }, "summary"),
    "typed",
  );
  assert.equal(
    formatAnswerScalar({ ...base, kind: "custom", answer: "" }, "summary"),
    NO_INPUT_PLACEHOLDER,
  );
});

test("formats multi-select answers and appends custom text", () => {
  assert.equal(
    formatAnswerScalar({ ...base, kind: "multi", answer: null, selected: ["A", "B"] }, "summary"),
    "A, B",
  );
  assert.equal(
    formatAnswerScalar({ ...base, kind: "multi", answer: "C", selected: ["A"] }, "summary"),
    "A, C",
  );
  assert.equal(
    formatAnswerScalar({ ...base, kind: "multi", answer: null, selected: [] }, "summary"),
    NO_INPUT_PLACEHOLDER,
  );
});

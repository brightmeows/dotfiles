import assert from "node:assert/strict";
import test from "node:test";
import type { QuestionAnswer, QuestionData, QuestionParams } from "./types.ts";
import {
  DECLINE_MESSAGE,
  buildAnswerSegment,
  buildQuestionnaireResponse,
} from "./response-envelope.ts";

const params: QuestionParams = {
  questions: [
    {
      question: "Q1?",
      header: "H1",
      options: [
        { label: "A", description: "a" },
        { label: "B", description: "b" },
      ],
    },
    {
      question: "Q2?",
      header: "H2",
      options: [
        { label: "C", description: "c" },
        { label: "D", description: "d" },
      ],
    },
  ] satisfies QuestionData[],
};

function answer(questionIndex: number): QuestionAnswer {
  return {
    questionIndex,
    question: params.questions[questionIndex]?.question ?? "",
    kind: "option",
    answer: questionIndex === 0 ? "A" : "C",
  };
}

test("builds the answered envelope with every question segment", () => {
  const response = buildQuestionnaireResponse(
    { answers: [answer(0), answer(1)], cancelled: false },
    params,
  );
  const text = response.content[0]?.text ?? "";
  assert.match(text, /User has answered your questions:/);
  assert.match(text, /"Q1\?"="A"/);
  assert.match(text, /"Q2\?"="C"/);
  assert.doesNotMatch(text, /unanswered:/);
  assert.equal(response.details.unanswered, undefined);
});

test("names unanswered questions on a partial submit", () => {
  const response = buildQuestionnaireResponse({ answers: [answer(0)], cancelled: false }, params);
  const text = response.content[0]?.text ?? "";
  assert.match(text, /unanswered: "Q2\?"\./);
  assert.deepEqual(response.details.unanswered, [1]);
});

test("uses the decline message for cancelled results", () => {
  const response = buildQuestionnaireResponse({ answers: [], cancelled: true }, params);
  assert.equal(response.content[0]?.text, DECLINE_MESSAGE);
  assert.equal(response.details.cancelled, true);
});

test("keeps a global note on a zero-answer submit", () => {
  const response = buildQuestionnaireResponse(
    { answers: [], cancelled: false, globalNote: "note" },
    params,
  );
  const text = response.content[0]?.text ?? "";
  assert.match(text, /global note: note\./);
  assert.notEqual(text, DECLINE_MESSAGE);
});

test("builds a single answer segment with preview and notes", () => {
  const segment = buildAnswerSegment({
    questionIndex: 0,
    question: "Q?",
    kind: "option",
    answer: "A",
    preview: "p",
    notes: "n",
  });
  assert.equal(segment, '"Q?"="A". selected preview: p. user notes: n.');
});

import assert from "node:assert/strict";
import test from "node:test";
import { repairPatch } from "./repair.ts";

const VALID = `*** Begin Patch
*** Update File: a.txt
@@
-line
+LINE
*** End Patch`;

test("leaves a valid patch byte-identical", () => {
  assert.deepEqual(repairPatch(VALID), { text: VALID, notes: [] });
});

test("prefixes blank and unprefixed Add File lines", () => {
  const input = `*** Begin Patch
*** Add File: n.txt
+hello

///
(
*** End Patch`;
  const expected = `*** Begin Patch
*** Add File: n.txt
+hello
+
+///
+(
*** End Patch`;
  assert.deepEqual(repairPatch(input), {
    text: expected,
    notes: ["3 Add File content lines prefixed with '+'"],
  });
});

test("merges consecutive Update blocks for the same file", () => {
  const input = `*** Begin Patch
*** Update File: a.txt
@@
-one
+ONE
*** Update File: a.txt
@@
-two
+TWO
*** End Patch`;
  const expected = `*** Begin Patch
*** Update File: a.txt
@@
-one
+ONE
@@
-two
+TWO
*** End Patch`;
  assert.deepEqual(repairPatch(input), {
    text: expected,
    notes: ["1 duplicate Update block merged"],
  });
});

test("keeps duplicate Update blocks separated by another file", () => {
  const input = `*** Begin Patch
*** Update File: a.txt
@@
-one
+ONE
*** Update File: b.txt
@@
-two
+TWO
*** Update File: a.txt
@@
-three
+THREE
*** End Patch`;
  assert.deepEqual(repairPatch(input), { text: input, notes: [] });
});

test("drops an Update header with no body", () => {
  const input = `*** Begin Patch
*** Update File: empty.txt
*** Update File: b.txt
@@
-x
+y
*** End Patch`;
  const expected = `*** Begin Patch
*** Update File: b.txt
@@
-x
+y
*** End Patch`;
  assert.deepEqual(repairPatch(input), {
    text: expected,
    notes: ["1 empty Update block dropped"],
  });
});

test("normalizes a numeric hunk header when the chunk has a locator line", () => {
  const input = `*** Begin Patch
*** Update File: a.txt
@@ -1,2 +1,2 @@
 one
-two
+TWO
*** End Patch`;
  const expected = `*** Begin Patch
*** Update File: a.txt
@@
 one
-two
+TWO
*** End Patch`;
  assert.deepEqual(repairPatch(input), {
    text: expected,
    notes: ["1 numeric hunk header normalized"],
  });
});

test("leaves a numeric header on a pure-addition chunk alone", () => {
  const input = `*** Begin Patch
*** Update File: a.txt
@@ -1,2 +1,2 @@
+added
*** End Patch`;
  assert.deepEqual(repairPatch(input), { text: input, notes: [] });
});

test("adds the missing space after a bare @@ anchor", () => {
  const input = `*** Begin Patch
*** Update File: a.txt
@@fn main()
-old
+new
*** End Patch`;
  const expected = `*** Begin Patch
*** Update File: a.txt
@@ fn main()
-old
+new
*** End Patch`;
  assert.deepEqual(repairPatch(input), {
    text: expected,
    notes: ["1 anchor normalized"],
  });
});

test("unwraps a markdown fence around the patch", () => {
  const inner = `*** Begin Patch
*** Add File: n.txt
+hello
*** End Patch`;
  const input = `\`\`\`diff\n${inner}\n\`\`\``;
  assert.deepEqual(repairPatch(input), { text: inner, notes: ["fenced patch unwrapped"] });
});

test("preserves CRLF when repairing an Add File blank line", () => {
  const input = "*** Begin Patch\r\n*** Add File: n.txt\r\n+hello\r\n\r\n+world\r\n*** End Patch";
  const expected =
    "*** Begin Patch\r\n*** Add File: n.txt\r\n+hello\r\n+\r\n+world\r\n*** End Patch";
  assert.deepEqual(repairPatch(input), {
    text: expected,
    notes: ["1 Add File content line prefixed with '+'"],
  });
});

test("does not complete a truncated patch", () => {
  const input = "*** Begin Patch\n*** Add File: n.txt\n+hello";
  assert.deepEqual(repairPatch(input), { text: input, notes: [] });
});

test("does not touch an unsupported environment header", () => {
  const input = "*** Begin Patch\n*** Environment ID: x\n*** Add File: a\n+b\n*** End Patch";
  assert.deepEqual(repairPatch(input), { text: input, notes: [] });
});

test("does not repair context mismatches", () => {
  const input = `*** Begin Patch
*** Update File: a.txt
@@
stale context
-old
+new
*** End Patch`;
  assert.deepEqual(repairPatch(input), { text: input, notes: [] });
});

test("drops an Update whose body is only blank lines", () => {
  const input = `*** Begin Patch
*** Update File: a.txt

*** End Patch`;
  assert.deepEqual(repairPatch(input), {
    text: "*** Begin Patch\n*** End Patch",
    notes: ["1 empty Update block dropped"],
  });
});

test("merges duplicate Update blocks written with absolute and relative paths", () => {
  const input = `*** Begin Patch
*** Update File: /work/a.txt
@@
-one
+ONE
*** Update File: a.txt
@@
-two
+TWO
*** End Patch`;
  const expected = `*** Begin Patch
*** Update File: /work/a.txt
@@
-one
+ONE
@@
-two
+TWO
*** End Patch`;
  assert.deepEqual(repairPatch(input, { cwd: "/work" }), {
    text: expected,
    notes: ["1 duplicate Update block merged"],
  });
});

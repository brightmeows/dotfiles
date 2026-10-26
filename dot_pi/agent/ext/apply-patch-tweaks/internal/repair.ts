/**
 * Pure input repairs for apply_patch.
 *
 * The executor keeps Codex's strict parser. These repairs only normalize
 * mechanical mistakes that non-Codex models repeat: missing `+` prefixes in an
 * Add File body, a markdown fence around the envelope, unified-diff hunk
 * headers, `@@` without a space, duplicate Update headers for one file, and
 * empty Update headers with no hunks.
 *
 * Context matching is deliberately not touched. A stale or inexact context
 * stays a failure so the model re-reads the file instead of writing at a
 * guessed location. A missing `*** End Patch` is also left alone: completing a
 * truncated patch would write half a file.
 *
 * Every repair fails open. If the envelope is not the standard Begin/End shape,
 * or an unrecognized line sits outside a file section, the original input is
 * returned unchanged and the executor reports its own error.
 */

import { isAbsolute, relative, resolve } from "node:path";

export interface RepairResult {
  readonly text: string;
  readonly notes: readonly string[];
}

export interface RepairOptions {
  /** Workspace root, used to compare absolute and relative paths for one file. */
  readonly cwd?: string;
}

type SectionKind = "add" | "update" | "delete";

interface Section {
  readonly kind: SectionKind;
  readonly header: string;
  readonly path: string;
  /** Original `*** Move to:` line, when the parser would accept it. */
  moveTo?: string;
  readonly body: string[];
  drop?: boolean;
}

interface Header {
  readonly kind: SectionKind;
  readonly prefix: string;
}

const HEADERS: readonly Header[] = [
  { kind: "add", prefix: "*** Add File: " },
  { kind: "delete", prefix: "*** Delete File: " },
  { kind: "update", prefix: "*** Update File: " },
];
const MOVE = "*** Move to: ";
const NUMERIC_HUNK = /^@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/u;
const FENCE = /^```/u;

function headerOf(line: string): Header | undefined {
  return HEADERS.find((header) => line.startsWith(header.prefix));
}

function isMarker(line: string, marker: string): boolean {
  return line.trim() === marker;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function hasEndOfFile(body: readonly string[]): boolean {
  return body.some((line) => line.trim() === "*** End of File");
}

function firstNonBlank(lines: readonly string[], from: number): number {
  let index = from;
  while (index < lines.length && (lines[index]?.trim() ?? "") === "") {
    index++;
  }
  return index;
}

function lastNonBlank(lines: readonly string[], from: number): number {
  let index = from;
  while (index > 0 && (lines[index]?.trim() ?? "") === "") {
    index--;
  }
  return index;
}

/** Remove one markdown fence around the patch. A fence inside content is left alone. */
function unwrapFence(input: string): { text: string; stripped: boolean } {
  const text = input.trim();
  const lines = text.split(/\r?\n/u);
  if (!FENCE.test(lines[0]?.trim() ?? "")) {
    return { text: input, stripped: false };
  }
  const begin = firstNonBlank(lines, 1);
  if ((lines[begin]?.trim() ?? "") !== "*** Begin Patch") {
    return { text: input, stripped: false };
  }
  const end = lastNonBlank(lines, lines.length - 1);
  if (!FENCE.test(lines[end]?.trim() ?? "")) {
    return { text: input, stripped: false };
  }
  return { text: lines.slice(begin, end).join("\n").trim(), stripped: true };
}

/**
 * Split the patch into file sections.
 *
 * Returns undefined for an envelope the executor would reject for structural
 * reasons, so a repair never hides a malformed patch or drops content outside
 * a recognized section.
 */
function scanSections(lines: readonly string[]): Section[] | undefined {
  const begin = lines.findIndex((line) => isMarker(line, "*** Begin Patch"));
  if (begin === -1) {
    return undefined;
  }
  const end = lines.findIndex((line, index) => index > begin && isMarker(line, "*** End Patch"));
  if (end === -1) {
    return undefined;
  }
  if (lines.slice(0, begin).some((line) => line.trim() !== "")) {
    return undefined;
  }
  if (lines.slice(end + 1).some((line) => line.trim() !== "")) {
    return undefined;
  }

  const sections: Section[] = [];
  let current: Section | undefined;
  for (let index = begin + 1; index < end; index++) {
    const line = lines[index]!;
    const marker = line.trim();
    if (marker.startsWith("*** Environment ID:")) {
      return undefined;
    }
    const header = headerOf(marker);
    if (header) {
      current = {
        kind: header.kind,
        header: line,
        path: marker.slice(header.prefix.length).trim(),
        body: [],
      };
      sections.push(current);
      continue;
    }
    if (!current) {
      if (marker !== "") {
        return undefined;
      }
      continue;
    }
    // The parser accepts Move only before the first hunk line.
    if (
      current.kind === "update" &&
      current.moveTo === undefined &&
      current.body.length === 0 &&
      line.trimEnd().startsWith(MOVE)
    ) {
      current.moveTo = line;
      continue;
    }
    current.body.push(line);
  }
  return sections;
}

/** Add the `+` prefix the Add File grammar requires on every content line. */
function repairAddFileLines(sections: readonly Section[], notes: string[]): void {
  let count = 0;
  for (const section of sections) {
    if (section.kind !== "add") {
      continue;
    }
    for (let index = 0; index < section.body.length; index++) {
      const line = section.body[index]!;
      if (line.startsWith("+")) {
        continue;
      }
      section.body[index] = `+${line}`;
      count++;
    }
  }
  if (count > 0) {
    notes.push(`${plural(count, "Add File content line")} prefixed with '+'`);
  }
}

/** Drop an Update header that has no body. It is a semantic no-op. */
function dropEmptyUpdates(sections: readonly Section[], notes: string[]): void {
  let count = 0;
  for (const section of sections) {
    if (
      section.kind !== "update" ||
      section.moveTo !== undefined ||
      section.body.some((line) => line.trim() !== "")
    ) {
      continue;
    }
    section.drop = true;
    count++;
  }
  if (count > 0) {
    notes.push(`${plural(count, "empty Update block")} dropped`);
  }
}

/** Whether the current chunk still has a context or removal line after its header. */
function hasLocatorLine(body: readonly string[], from: number): boolean {
  for (let index = from + 1; index < body.length; index++) {
    const line = body[index]!;
    if (line.startsWith("@@")) {
      return false;
    }
    if (line.startsWith(" ") || line.startsWith("-")) {
      return true;
    }
  }
  return false;
}

/** Normalize unified-diff and no-space hunk headers into the Codex format. */
function normalizeHunks(sections: readonly Section[], notes: string[]): void {
  let numeric = 0;
  let anchors = 0;
  for (const section of sections) {
    if (section.kind !== "update") {
      continue;
    }
    for (let index = 0; index < section.body.length; index++) {
      const line = section.body[index]!;
      if (!line.startsWith("@@")) {
        continue;
      }
      if (NUMERIC_HUNK.test(line.trimEnd())) {
        // A numeric header on a pure-addition chunk carries no locator.
        // Keeping it makes the executor fail instead of appending the block at EOF.
        if (!hasLocatorLine(section.body, index)) {
          continue;
        }
        section.body[index] = "@@";
        numeric++;
        continue;
      }
      if (line !== "@@" && !line.startsWith("@@ ")) {
        section.body[index] = `@@ ${line.slice(2)}`;
        anchors++;
      }
    }
  }
  if (numeric > 0) {
    notes.push(`${plural(numeric, "numeric hunk header")} normalized`);
  }
  if (anchors > 0) {
    notes.push(`${plural(anchors, "anchor")} normalized`);
  }
}

/** Whether no non-dropped section sits between two Update blocks. */
function adjacent(sections: readonly Section[], first: Section, second: Section): boolean {
  let seenFirst = false;
  for (const section of sections) {
    if (section === first) {
      seenFirst = true;
      continue;
    }
    if (section === second) {
      return seenFirst;
    }
    if (seenFirst && !section.drop) {
      return false;
    }
  }
  return false;
}

/** Merge consecutive Update blocks for one file into the canonical single header. */
function mergeDuplicateUpdates(sections: readonly Section[], notes: string[], cwd?: string): void {
  const keyOf = (section: Section): string => {
    if (cwd === undefined) {
      return section.path;
    }
    const absolute = isAbsolute(section.path) ? section.path : resolve(cwd, section.path);
    return relative(cwd, absolute);
  };
  const firstByPath = new Map<string, Section>();
  let count = 0;
  for (const section of sections) {
    if (section.kind !== "update" || section.drop || section.moveTo !== undefined) {
      continue;
    }
    if (hasEndOfFile(section.body)) {
      continue;
    }
    const key = keyOf(section);
    const first = firstByPath.get(key);
    if (!first) {
      firstByPath.set(key, section);
      continue;
    }
    // A second block without a new @@ would silently extend the previous chunk.
    const firstLine = section.body.find((line) => line.trim() !== "");
    if (!firstLine?.trimEnd().startsWith("@@")) {
      continue;
    }
    if (!adjacent(sections, first, section)) {
      continue;
    }
    first.body.push(...section.body);
    section.drop = true;
    count++;
  }
  if (count > 0) {
    notes.push(`${plural(count, "duplicate Update block")} merged`);
  }
}

function rebuild(sections: readonly Section[], eol: string): string {
  const rows = ["*** Begin Patch"];
  for (const section of sections) {
    if (section.drop) {
      continue;
    }
    rows.push(section.header);
    if (section.moveTo !== undefined) {
      rows.push(section.moveTo);
    }
    rows.push(...section.body);
  }
  rows.push("*** End Patch");
  return rows.join(eol);
}

export function repairPatch(input: string, options: RepairOptions = {}): RepairResult {
  const envelope = unwrapFence(input);
  const eol = envelope.text.includes("\r\n") ? "\r\n" : "\n";
  const sections = scanSections(envelope.text.split(/\r?\n/u));
  if (!sections) {
    return { text: input, notes: [] };
  }

  const notes: string[] = [];
  if (envelope.stripped) {
    notes.push("fenced patch unwrapped");
  }
  repairAddFileLines(sections, notes);
  dropEmptyUpdates(sections, notes);
  normalizeHunks(sections, notes);
  mergeDuplicateUpdates(sections, notes, options.cwd);
  if (notes.length === 0) {
    return { text: input, notes: [] };
  }
  return { text: rebuild(sections, eol), notes };
}

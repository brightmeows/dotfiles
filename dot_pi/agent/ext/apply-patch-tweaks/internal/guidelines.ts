/**
 * Prompt guidance for the local apply_patch setup.
 *
 * The strings below are kept byte-identical to the ones proposed upstream in
 * d3ara1n/pi-extensions. Once the upstream package ships them, the exact-string
 * dedupe in mergeGuidelines turns this module into a no-op, so the local
 * extension keeps working with either the vendored fork or the npm package.
 *
 * The Add File sentence is a contract and lives in the upstream tool
 * description. While the installed tool description predates that contract,
 * this extension adds it as a guideline; the description check in index.ts
 * suppresses it after the upstream release.
 */

import type { NormalizedBuildSystemPromptOptions } from "@earendil-works/pi-coding-agent";

export const ADD_FILE_GUIDELINE =
  "Every line of an Add File body, including blank lines, must start with '+'.";

export const PATCH_GUIDELINES: readonly string[] = [
  "Keep each file's hunks in file order under one '*** Update File:' header; a second header for the same file is rejected.",
  "Use bare '@@' or '@@ <context line>' locators; unified-diff '@@ -N,M +N,M @@' headers are not part of this format.",
  "Context lines must match the current file; re-read a file that changed earlier in the session before patching it.",
  "Prefer several small patches over one huge patch; a single unmatched hunk rejects every file in the patch.",
];

/** Append missing guidance without duplicating text already provided by the tool. */
export function mergeGuidelines(
  options: NormalizedBuildSystemPromptOptions,
  includeAddFileRule: boolean,
): void {
  const existing = options.toolGuidelines["apply_patch"] ?? [];
  const merged = [...existing];
  const candidates = includeAddFileRule
    ? [ADD_FILE_GUIDELINE, ...PATCH_GUIDELINES]
    : [...PATCH_GUIDELINES];
  for (const line of candidates) {
    if (!merged.includes(line)) {
      merged.push(line);
    }
  }
  options.toolGuidelines["apply_patch"] = merged;
}

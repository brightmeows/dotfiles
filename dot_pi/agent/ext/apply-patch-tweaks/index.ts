/**
 * Local hardening for apply_patch.
 *
 * The execution layer stays the vendored package (later the npm package). This
 * extension only touches the model-facing edges:
 *
 * - before_agent_start adds patch-authoring guidelines the installed tool
 *   description does not carry yet, deduped by exact text.
 * - tool_call repairs mechanical patch-format mistakes before the executor
 *   sees them, storing a note per call.
 * - tool_result appends that note to the tool result so the model learns that
 *   the input was repaired instead of believing its original text was valid.
 *
 * Repairs fail open: an unexpected exception logs and leaves the input alone.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mergeGuidelines } from "./internal/guidelines.ts";
import { repairPatch } from "./internal/repair.ts";

const TOOL = "apply_patch";

export default function applyPatchTweaks(pi: ExtensionAPI): void {
  const notes = new Map<string, readonly string[]>();

  pi.on("session_start", () => {
    notes.clear();
  });

  pi.on("before_agent_start", (event) => {
    const tool = pi.getAllTools().find((candidate) => candidate.name === TOOL);
    if (!tool) {
      return;
    }
    // The upstream tool description will own the Add File contract.
    // This extension carries it as a guideline until then; the description check prevents a duplicate.
    mergeGuidelines(event.systemPromptOptions, !tool.description.includes("including blank lines"));
  });

  pi.on("tool_call", (event) => {
    if (event.toolName !== TOOL) {
      return;
    }
    const { input } = event.input;
    if (typeof input !== "string") {
      return;
    }
    try {
      const repaired = repairPatch(input);
      if (repaired.notes.length === 0) {
        return;
      }
      event.input["input"] = repaired.text;
      notes.set(event.toolCallId, repaired.notes);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error(`[apply-patch-tweaks] repair failed: ${detail}`);
    }
  });

  pi.on("tool_result", (event) => {
    if (event.toolName !== TOOL) {
      return;
    }
    const repaired = notes.get(event.toolCallId);
    if (!repaired) {
      return;
    }
    notes.delete(event.toolCallId);
    event.content.push({
      type: "text",
      text: `apply_patch input repaired: ${repaired.join("; ")}.`,
    });
  });
}

/**
 * Local input repairs for apply_patch.
 *
 * The execution layer and prompt guidance belong to the upstream npm package.
 * This extension only repairs mechanical patch-format mistakes before the
 * executor sees them and appends a note to the tool result:
 *
 * - tool_call repairs Add File prefixes, an outer markdown fence, numeric hunk
 *   headers, `@@` without a space, consecutive duplicate Update headers, and
 *   empty Update headers.
 * - tool_result tells the model that its input was repaired instead of letting
 *   it believe the original text was valid.
 *
 * Repairs fail open: an unexpected exception logs and leaves the input alone.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { repairPatch } from "./internal/repair.ts";

const TOOL = "apply_patch";

export default function applyPatchTweaks(pi: ExtensionAPI): void {
  const notes = new Map<string, readonly string[]>();

  pi.on("session_start", () => {
    notes.clear();
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

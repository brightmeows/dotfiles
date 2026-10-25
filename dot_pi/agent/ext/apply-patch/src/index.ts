import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CONFIG, loadConfig, type PatchRenderConfig } from "./config.ts";
import { makeApplyPatchTool } from "./tool.ts";

export default function applyPatchExtension(pi: ExtensionAPI): void {
  // Render config is read once per session; a project `applyPatch` block
  // replaces the global one. Reads the settings files directly (pi-ask-user
  // pattern) rather than pi.getSettings(), which is an action method and is
  // unavailable while the extension factory runs.
  let config: PatchRenderConfig = DEFAULT_CONFIG;
  pi.on("session_start", (_event, ctx) => {
    config = loadConfig(ctx.cwd);
  });

  pi.registerTool(makeApplyPatchTool(undefined, () => config));
}

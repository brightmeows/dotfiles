/**
 * pi-meow-apply-patch entry: forwards to src/index.ts, keeping the upstream
 * file layout so the execution layer stays diffable against
 * @d3ara1n/pi-apply-patch.
 *
 * Fork baseline: @d3ara1n/pi-apply-patch@0.2.0 (Apache-2.0, see LICENSE and
 * NOTICE). Rendering-layer changes now live upstream as PRs #24 (cropped result
 * diff, `applyPatch` config) and #25 (streaming preview); this package tracks
 * them so the fork can be dropped once they ship. Execution layer
 * (src/core/, src/apply.ts, src/workspace.ts …) stays byte-identical to
 * upstream — re-audit its diff when bumping the baseline.
 *
 * Local-only file. The upstream package has no forwarding entry.
 */
import applyPatchExtension from "./src/index.ts";

export default applyPatchExtension;

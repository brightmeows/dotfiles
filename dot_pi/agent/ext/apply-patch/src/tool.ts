import {
  withFileMutationQueue,
  renderDiff,
  type Theme,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { applyPatch, formatSummary, nodeFileSystem, type ApplyContext } from "./apply.ts";
import { DEFAULT_CONFIG, type PatchRenderConfig } from "./config.ts";
import { CODEX_APPLY_PATCH_GRAMMAR } from "./grammar.ts";
import {
  countPatchFiles,
  makeDetails,
  renderPatchHeader,
  renderPatchResult,
  summarize,
  type PatchDetails,
  type PatchSummary,
} from "./render.ts";
import {
  buildPreview,
  emptyPreviewState,
  type PreviewBlock,
  type StreamPreviewState,
} from "./stream-preview.ts";

const schema = Type.Object({
  input: Type.String({
    description: "The complete patch text, from *** Begin Patch through *** End Patch.",
  }),
});

type Dependencies = Pick<ApplyContext, "fs" | "withFileQueue">;

const MARKERS = { add: "A", update: "M", delete: "D" } as const;

/** Row-local renderer state, shared between renderCall and renderResult. */
interface PatchRenderState {
  callComponent?: Box;
  callText?: Text;
  patchSummary?: PatchSummary;
  previewState?: StreamPreviewState;
}

/** Renderer state arrives as an untyped bag; name its shape once. */
function rowState(state: Record<string, unknown>): PatchRenderState {
  return state as PatchRenderState;
}

/**
 * Reuse the row's call component across frames. The default shell supplies the
 * state background and horizontal padding; the Box only groups the header with
 * the preview so both travel as one component.
 */
function callComponent(state: PatchRenderState, last: unknown): Box {
  if (last instanceof Box) {
    state.callComponent = last;
    return last;
  }
  const cached = state.callComponent;
  if (cached) return cached;
  const component = new Box(0, 0, (text) => text);
  state.callComponent = component;
  return component;
}

/** One preview block: the file row plus a real diff, a glimpse, or a warning. */
function renderBlock(block: PreviewBlock, theme: Theme): string[] {
  const label = block.moveTo ? `${block.path} → ${block.moveTo}` : block.path;
  const rows = [theme.fg("accent", `${MARKERS[block.kind]} ${label}`)];
  if (block.state === "ready" && block.diff !== undefined) {
    rows.push(renderDiff(block.diff));
    return rows;
  }
  if (block.state === "partial" && block.glimpse) {
    // Still being written: color the patch lines as they arrive instead of
    // matching them against the file.
    for (const line of block.glimpse) {
      const color = line.startsWith("+")
        ? "toolDiffAdded"
        : line.startsWith("-")
          ? "toolDiffRemoved"
          : "dim";
      rows.push(theme.fg(color, line));
    }
    rows.push(theme.fg("dim", "… writing"));
    return rows;
  }
  if (block.state === "unmatched") {
    rows.push(theme.fg("warning", `⚠ ${block.warning ?? "hunks did not match"}`));
    return rows;
  }
  rows.push(theme.fg("dim", "Preview unavailable: file is outside the workspace or not readable."));
  return rows;
}

/** Preview rows for the patch text received so far. */
function previewRows(
  args: { input?: string },
  theme: Theme,
  cwd: string,
  state: PatchRenderState,
): string[] {
  if (typeof args.input !== "string" || args.input.length === 0) return [];
  const previewState = state.previewState ?? emptyPreviewState();
  state.previewState = previewState;
  return buildPreview(args.input, cwd, previewState).flatMap((block) => renderBlock(block, theme));
}

/** @internal */
export function makeApplyPatchTool(
  dependencies: Dependencies = { fs: nodeFileSystem, withFileQueue: withFileMutationQueue },
  getConfig: () => PatchRenderConfig = () => DEFAULT_CONFIG,
): ToolDefinition<typeof schema, PatchDetails> {
  return {
    name: "apply_patch",
    label: "apply_patch",
    promptSnippet: "Edit workspace files with Codex-format patches",
    description:
      "Apply a Codex patch to files in the current workspace. Supports *** Add File:, *** Delete File:, *** Update File:, optional *** Move to:, @@ context markers, and *** End of File. Prefix added lines with +, removed lines with -, and context lines with a space. Relative and absolute paths must resolve within the workspace. Add and move operations can overwrite existing files. The entire patch is verified before writing, and failures list every unmatched hunk across every file with the closest matching locations. An I/O failure can leave partial changes. Direct tool call only — not callable from codemode scripts: it is absent from the script's `tools` object.",
    parameters: schema,
    constrainedSampling: { type: "grammar", variants: { openai_lark: CODEX_APPLY_PATCH_GRAMMAR } },
    // Model-only: the tool is built around grammar-constrained patch generation by the
    // model itself; a codemode script assembling patch text would bypass that contract.
    // Scripts edit through pi's callable file tools instead.
    exposure: "model-only",
    renderShell: "default",
    async execute(_id, { input }, signal, _onUpdate, ctx) {
      const result = await applyPatch(input, {
        ...dependencies,
        cwd: ctx.cwd,
        ...(signal !== undefined ? { signal } : {}),
      });
      return {
        content: [{ type: "text", text: formatSummary(result.files) }],
        details: makeDetails(result.files),
      };
    },
    renderCall(args, theme, context) {
      const state = rowState(context.state);
      const component = callComponent(state, context.lastComponent);
      // The header Text is stable: renderResult refreshes it in place once the
      // executed counts are known. Rebuilding it here would drop those counts
      // for one frame, because renderCall runs first on every pass.
      const header = state.callText ?? new Text("", 0, 0);
      state.callText = header;
      // Parsing the input is the only source available while the patch streams in.
      const summary: PatchSummary = state.patchSummary ?? {
        fileCount: typeof args.input === "string" ? countPatchFiles(args.input) : 0,
      };
      header.setText(renderPatchHeader(theme, summary));

      component.clear();
      component.addChild(header);
      // The preview belongs to argument streaming: once execution starts, the
      // result renderer owns the body. The last renderCall fires before
      // renderResult, so a flag set there cannot separate the phases —
      // executionStarted is the boundary.
      if (!context.executionStarted) {
        const rows = previewRows(args, theme, context.cwd, state);
        if (rows.length > 0) {
          component.addChild(new Text("", 0, 0));
          component.addChild(new Text(rows.join("\n"), 0, 0));
        }
      }
      return component;
    },
    renderResult(result, { expanded, isPartial }, theme, context) {
      const state = rowState(context.state);
      if (isPartial) return new Text(theme.fg("muted", "Applying patch…"), 0, 0);
      const text = result.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      const files =
        !context.isError && Array.isArray(result.details?.files) ? result.details.files : undefined;
      if (files) {
        const summary = summarize(files);
        const previous = state.patchSummary;
        state.patchSummary = summary;
        // Refresh the header in place: lastComponent here is the result, not the
        // header. Never call context.invalidate() from a renderer — it re-enters
        // updateDisplay synchronously and the row renders twice.
        if (
          previous?.fileCount !== summary.fileCount ||
          previous?.added !== summary.added ||
          previous?.removed !== summary.removed
        )
          state.callText?.setText(renderPatchHeader(theme, summary));
      }
      return renderPatchResult(result.details, text, expanded, context.isError, theme, getConfig());
    },
  };
}

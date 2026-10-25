/**
 * apply_patch 工具定义与渲染（pi-meow-apply-patch 渲染层，fork 自
 * @d3ara1n/pi-apply-patch@0.2.0 的 src/tool.ts，execute 与 schema 原样保留）。
 *
 * 渲染设计（相对上游的全部差异，2026-10-25 与主人敲定）：
 * - 调用组件为带状态背景色的 Box（对齐内建 edit 工具）：pending 黄底、成功
 *   绿底、失败红底；头行 `apply_patch N files +a -r`。
 * - 参数流式生成阶段，Box 内实时渲染 src/stream-preview.ts 的混合保真预览：
 *   封口 hunk 真 diff、写入中 +/- 行着色、匹配失败黄警。renderCall 是同步
 *   路径，每帧从预览缓存取块；input 变化时当帧重算（同步 IO 有签名缓存兜底）。
 * - 执行后 diff 默认全量展开（上游折叠在展开态且每文件 120 行 cap，均移除），
 *   保留上游的归一化匹配提示与多命中提示；失败分支保留上游行为（展开态全文、
 *   折叠态首行）。
 *
 * 与上游 execute 的契约不变：model-only exposure、grammar 约束采样、
 * withFileMutationQueue 串行化、Codex 摘要格式输出。
 */
import {
  withFileMutationQueue,
  renderDiff,
  type Theme,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { applyPatch, formatSummary, nodeFileSystem, type ApplyContext } from "./apply.ts";
import { CODEX_APPLY_PATCH_GRAMMAR } from "./grammar.ts";
import { buildPreview, emptyPreviewState, type PreviewBlock } from "./stream-preview.ts";
import {
  countPatchFiles,
  cropDiff,
  makeDetails,
  summarize,
  type FileDetails,
  type PatchDetails,
  type PatchSummary,
  type PreviewCropConfig,
  DEFAULT_CROP_CONFIG,
} from "./render.ts";

const schema = Type.Object({
  input: Type.String({
    description: "The complete patch text, from *** Begin Patch through *** End Patch.",
  }),
});

type Dependencies = Pick<ApplyContext, "fs" | "withFileQueue">;

/** 渲染状态：随单次工具调用的渲染上下文存亡。 */
interface PatchRenderState {
  component?: Box;
  executed?: { ok: boolean };
  summary?: PatchSummary;
  preview?: { inputLen: number; blocks: readonly PreviewBlock[] };
  previewState: ReturnType<typeof emptyPreviewState>;
  /** 由 renderResult 每帧回写；renderCall 读取以决定预览是否折叠（一帧延迟，流式 delta 驱动对齐）。 */
  expanded?: boolean;
}

function renderState(context: { state: Record<string, unknown> }): PatchRenderState {
  const raw = context.state as Partial<PatchRenderState>;
  if (!raw.previewState) raw.previewState = emptyPreviewState();
  return raw as PatchRenderState;
}

function getComponent(context: { lastComponent?: unknown }, state: PatchRenderState): Box {
  if (context.lastComponent instanceof Box) {
    state.component = context.lastComponent;
    return state.component;
  }
  if (!state.component) state.component = new Box(1, 1, (text) => text);
  return state.component;
}

function headerLine(theme: Theme, text: string, count: number, summary?: PatchSummary): string {
  const counted = ` ${count} file${count === 1 ? "" : "s"}`;
  const stats =
    summary?.added === undefined
      ? ""
      : ` ${theme.fg("toolDiffAdded", `+${summary.added}`)} ${theme.fg("toolDiffRemoved", `-${summary.removed ?? 0}`)}`;
  return theme.fg("toolTitle", theme.bold(text)) + theme.fg("dim", counted) + stats;
}

const MARKERS = { add: "A", update: "M", delete: "D" } as const;

function fileLabel(block: { kind: PreviewBlock["kind"]; path: string; moveTo?: string }): string {
  return block.moveTo ? `${block.path} → ${block.moveTo}` : block.path;
}

/** 折叠态限行，展开态原样。预览块与执行后结果共用。 */
function cropForDisplay(
  diff: string,
  expanded: boolean | undefined,
  config: PreviewCropConfig,
): string {
  return expanded ? diff : cropDiff(diff, config).text;
}

/** 单个预览块：文件行 + 真 diff / glimpse / 警告。 */
function renderBlock(
  block: PreviewBlock,
  theme: Theme,
  expanded: boolean,
  cropConfig: PreviewCropConfig,
): string[] {
  const rows = [theme.fg("accent", `${MARKERS[block.kind]} ${fileLabel(block)}`)];
  if (block.state === "ready" && block.diff !== undefined) {
    rows.push(renderDiff(cropForDisplay(block.diff, expanded, cropConfig)));
    return rows;
  }
  if (block.state === "partial" && block.glimpse) {
    for (const line of block.glimpse) {
      const color = line.startsWith("+")
        ? "toolDiffAdded"
        : line.startsWith("-")
          ? "toolDiffRemoved"
          : "dim";
      rows.push(theme.fg(color, line));
    }
    rows.push(theme.fg("dim", "··· 写入中"));
    return rows;
  }
  if (block.state === "unmatched") {
    rows.push(theme.fg("warning", `⚠ ${block.warning ?? "hunk 匹配失败"}`));
    return rows;
  }
  rows.push(theme.fg("dim", "无法预览：文件不可读或在 workspace 外。"));
  return rows;
}

function previewBody(
  args: { input?: string },
  theme: Theme,
  cwd: string,
  state: PatchRenderState,
  cropConfig: PreviewCropConfig,
): string[] {
  if (typeof args.input !== "string" || args.input.length === 0) return [];
  const input = args.input;
  if (!state.preview || state.preview.inputLen !== input.length) {
    state.preview = {
      inputLen: input.length,
      blocks: buildPreview(input, cwd, state.previewState),
    };
  }
  const rows: string[] = [];
  for (const block of state.preview.blocks)
    rows.push(...renderBlock(block, theme, state.expanded === true, cropConfig));
  return rows;
}

/** @internal */
export function makeApplyPatchTool(
  dependencies: Dependencies = { fs: nodeFileSystem, withFileQueue: withFileMutationQueue },
  getCropConfig: () => PreviewCropConfig = () => DEFAULT_CROP_CONFIG,
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
      const state = renderState(context);
      const box = getComponent(context, state);
      const settled = state.executed;
      const bgColor = settled ? (settled.ok ? "toolSuccessBg" : "toolErrorBg") : "toolPendingBg";
      box.setBgFn((text) => theme.bg(bgColor, text));
      box.clear();
      const count =
        state.summary?.fileCount ??
        (typeof args.input === "string" ? countPatchFiles(args.input) : 0);
      box.addChild(new Text(headerLine(theme, "apply_patch", count, state.summary), 0, 0));
      // 预览只在参数流式阶段画：executionStarted 翻转后 execute 已启动，继续画
      // 会与 renderResult 的真 diff 重复（实测：最后一次 renderCall 先于
      // renderResult，executed 标志彼时未设，不能作分割依据）。
      if (!settled && !context.executionStarted) {
        const body = previewBody(args, theme, context.cwd, state, getCropConfig());
        if (body.length > 0) {
          box.addChild(new Text("", 0, 0));
          box.addChild(new Text(body.join("\n"), 0, 0));
        }
      }
      return box;
    },
    renderResult(result, { isPartial, expanded }, theme, context) {
      const state = renderState(context);
      state.expanded = expanded;
      if (isPartial) return new Text(theme.fg("muted", "Applying patch…"), 0, 0);
      const isError = context.isError;
      const text = result.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      const files = isError ? undefined : (result.details as PatchDetails | undefined)?.files;
      if (files === undefined || !Array.isArray(files)) {
        state.executed = { ok: false };
        const output = expanded ? text : (text.split("\n")[0] ?? "");
        return new Text(theme.fg("error", output), 0, 0);
      }
      const detailed = files as readonly FileDetails[];
      state.executed = { ok: true };
      state.summary = summarize(detailed);
      const rows: string[] = [];
      for (const file of detailed) {
        rows.push(theme.fg("accent", `${MARKERS[file.kind]} ${fileLabel(file)}`));
        if (file.overwrites) rows.push(theme.fg("dim", "overwrote an existing file"));
        if (file.rematched)
          rows.push(theme.fg("dim", "rematched against content that changed while queued"));
        const hunks = file.hunks;
        if (hunks !== undefined && hunks.length > 0) {
          const normalized = hunks.filter((hunk) => hunk.strategy !== "exact").length;
          if (normalized > 0)
            rows.push(
              theme.fg(
                "dim",
                `${normalized} hunk${normalized === 1 ? "" : "s"} matched after whitespace or Unicode normalization`,
              ),
            );
          for (const hunk of hunks) {
            if (hunk.occurrences > 1)
              rows.push(
                theme.fg(
                  "dim",
                  `hunk ${hunk.hunk} matched the first of ${hunk.occurrences} occurrences`,
                ),
              );
          }
        }
        if (file.diff === undefined) {
          rows.push(theme.fg("dim", "Diff unavailable: previous content could not be read."));
        } else {
          rows.push(renderDiff(cropForDisplay(file.diff, expanded, getCropConfig())));
        }
      }
      return new Text(rows.join("\n"), 0, 0);
    },
  };
}

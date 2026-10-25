/**
 * 工具结果 details 的构造与类型（pi-meow-apply-patch，fork 自上游 render.ts）。
 *
 * 相对上游的差异：渲染函数（renderPatchHeader/renderPatchResult）已由
 * src/tool.ts 的 Box 组件渲染取代并移除；本文件只保留执行结果到 details 的
 * 投影（makeDetails）、流式头行计数（countPatchFiles）与执行后汇总
 * （summarize）。makeDetails 的 diff 文本同时服务于执行后渲染与
 * renderResult 的 details 持久化，行为与上游逐字一致。
 */
import { generateDiffString } from "@earendil-works/pi-coding-agent";
import type { FileChange } from "./apply.ts";
import type { HunkMatchInfo } from "./core/types.ts";

export interface FileDetails {
  readonly kind: FileChange["kind"];
  readonly path: string;
  readonly moveTo?: string;
  readonly added?: number;
  readonly removed?: number;
  readonly diff?: string;
  readonly hunks?: readonly HunkMatchInfo[];
  /** The write replaced a file that already existed. */
  readonly overwrites?: boolean;
  /** Source content changed between verification and write. */
  readonly rematched?: boolean;
}
export interface PatchDetails {
  readonly files: readonly FileDetails[];
}

/**
 * What the one-line tool call header shows. Counts stay undefined until the
 * result supplies comparable diffs; a file whose previous content could not be
 * read has no diff, so the aggregate would be wrong and is omitted.
 */
export interface PatchSummary {
  readonly fileCount: number;
  readonly added?: number;
  readonly removed?: number;
}

/** @internal */
export function makeDetails(files: readonly FileChange[]): PatchDetails {
  return {
    files: files.map((file) => {
      const identity = {
        kind: file.kind,
        path: file.path,
        ...(file.moveTo !== undefined ? { moveTo: file.moveTo } : {}),
      };
      const annotations = {
        ...(file.hunks?.length ? { hunks: file.hunks } : {}),
        ...(file.overwrites ? { overwrites: true } : {}),
        ...(file.rematched ? { rematched: true } : {}),
      };
      if (file.before === undefined) return { ...identity, ...annotations };
      // Normalize display text only; filesystem content follows Codex's baseline.
      const display = (text: string) => text.replace(/\r\n?/g, "\n");
      const { diff } = generateDiffString(display(file.before), display(file.after));
      const lines = diff.split("\n");
      return {
        ...identity,
        ...annotations,
        added: lines.filter((line) => line.startsWith("+")).length,
        removed: lines.filter((line) => line.startsWith("-")).length,
        diff,
      };
    }),
  };
}

/** Count `*** Add|Delete|Update File:` operations in raw patch text. @internal */
export function countPatchFiles(input: string): number {
  return [...input.matchAll(/^\s*\*\*\* (?:Add|Delete|Update) File: /gm)].length;
}

/** Aggregate per-file line counts into the header summary. @internal */
export function summarize(files: readonly FileDetails[]): PatchSummary {
  if (!files.every((file) => file.diff !== undefined)) return { fileCount: files.length };
  return {
    fileCount: files.length,
    added: files.reduce((total, file) => total + (file.added ?? 0), 0),
    removed: files.reduce((total, file) => total + (file.removed ?? 0), 0),
  };
}

/** 折叠态限行配置（settings 键 applyPatchPreview，见 readCropConfig）。 */
export interface PreviewCropConfig {
  /** 每个改动块前后的 context 行数，默认 1。 */
  readonly contextLines: number;
  /** 单个改动块内 -/+ 行合计上限，超出截断并加省略行，默认 10。 */
  readonly maxChangedLines: number;
}

export const DEFAULT_CROP_CONFIG: PreviewCropConfig = { contextLines: 1, maxChangedLines: 10 };

/**
 * 从 settings 读折叠限行配置（settings.json 不校验未知键，pi 自身不受影响）。
 * 非法值（非数字/负数/NaN）逐项回退默认；整键缺失或非对象则全默认。
 * 工厂期读取一次（src/index.ts），/reload 重建工厂后生效。
 */
export function readCropConfig(settings: unknown): PreviewCropConfig {
  const raw = settings as { applyPatchPreview?: unknown } | undefined;
  const value = raw?.applyPatchPreview;
  if (typeof value !== "object" || value === null) return DEFAULT_CROP_CONFIG;
  const pick = (key: keyof PreviewCropConfig, fallback: number): number => {
    const n = (value as Record<string, unknown>)[key];
    return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
  };
  return {
    contextLines: pick("contextLines", DEFAULT_CROP_CONFIG.contextLines),
    maxChangedLines: Math.max(1, pick("maxChangedLines", DEFAULT_CROP_CONFIG.maxChangedLines)),
  };
}

/** renderDiff 同款行前缀约定："+123 内容" / "-123 内容" / " 123 内容"。 */
function isChangedDiffLine(line: string): boolean {
  return line.startsWith("+") || line.startsWith("-");
}

/**
 * 折叠态限行：把全文 diff 裁成「每块 context 前后各 contextLines 行 + 改动行
 * 合计 ≤ maxChangedLines」的紧凑形态。展开态不经过本函数。
 *
 * 规则（2026-10-25 与主人敲定）：
 * - 相邻改动块间隔 ≤ 2×contextLines 行 context 时整体保留（归并，避免跳变）；
 *   更长的 context 中段以省略行注明行数；
 * - 改动块内 -/+ 行按原序保留前 maxChangedLines 行（- 组与 + 组的对齐不被
 *   破坏，renderDiff 的词级高亮照常工作），尾部插入省略行；
 * - 首尾改动块外侧的 context 同样只留 contextLines 行；
 * - 多文件时每份 diff 独立裁剪（调用方逐文件调用）。
 *
 * 省略行首字符用「…」：renderDiff 的 parseDiffLine 不匹配，回落 context 色，
 * 不会被误染成增删行。header 的 +a -r tally 来自真实统计，不受裁剪影响。
 */
export function cropDiff(
  diff: string,
  config: PreviewCropConfig,
): { text: string; omittedChanged: number } {
  const ctxN = Math.max(0, Math.floor(config.contextLines));
  const maxChanged = Math.max(1, Math.floor(config.maxChangedLines));
  const all = diff.split("\n");
  type Seg = { changed: boolean; lines: string[] };
  const segments: Seg[] = [];
  for (const line of all) {
    const changed = isChangedDiffLine(line);
    const last = segments.at(-1);
    if (last && last.changed === changed) last.lines.push(line);
    else segments.push({ changed, lines: [line] });
  }
  let omittedChanged = 0;
  const out: string[] = [];
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]!;
    if (segment.changed) {
      if (segment.lines.length > maxChanged) {
        const hidden = segment.lines.length - maxChanged;
        omittedChanged += hidden;
        out.push(...segment.lines.slice(0, maxChanged));
        out.push(`… 还有 ${hidden} 行改动（Ctrl+O 展开全量）`);
      } else {
        out.push(...segment.lines);
      }
      continue;
    }
    const needHead = index > 0 ? ctxN : 0;
    const needTail = index < segments.length - 1 ? ctxN : 0;
    if (needHead + needTail === 0) continue;
    if (segment.lines.length <= needHead + needTail) {
      out.push(...segment.lines);
      continue;
    }
    if (needHead > 0) out.push(...segment.lines.slice(0, needHead));
    const omittedContext = segment.lines.length - needHead - needTail;
    if (omittedContext > 0) out.push(`… 中间省略 ${omittedContext} 行`);
    if (needTail > 0) out.push(...segment.lines.slice(segment.lines.length - needTail));
  }
  return { text: out.join("\n"), omittedChanged };
}

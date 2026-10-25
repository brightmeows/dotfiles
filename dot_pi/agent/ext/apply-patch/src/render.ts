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

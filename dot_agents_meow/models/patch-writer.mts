/** Profile patch 的生成块写入：标记替换、内容不变不写、原子落盘。 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { MARKER_END, MARKER_START } from "./config.mts";

export interface WriteResult {
  written: string[];
  unchanged: string[];
}

/** 去掉既有生成块（含标记行），保留其余内容。 */
export function stripManagedBlock(text: string): string {
  const start = text.indexOf(MARKER_START);
  if (start === -1) {
    return text;
  }
  const end = text.indexOf(MARKER_END, start);
  if (end === -1) {
    return text.slice(0, start);
  }
  const lineEnd = text.indexOf("\n", end);
  return text.slice(0, start) + (lineEnd !== -1 ? text.slice(lineEnd + 1) : "");
}

/**
 * 归一化生成块之前的内容：
 * - 只有注释或空白：保留注释；
 * - 只有注释加空数组 `[]`（dsh profile 模板的初始形态）：去掉空数组、保留注释；
 * - 有用户内容：原样保留并以一个空行收尾。
 * 返回内容自带结尾换行（空串表示没有内容）。
 */
function normalizeHead(head: string): string {
  const lines = head.split("\n");
  const contentLines = lines.filter((line) => {
    const trimmed = line.trim();
    return trimmed !== "" && !trimmed.startsWith("#");
  });
  if (contentLines.length === 0) {
    const comments = head.trimEnd();
    return comments === "" ? "" : `${comments}\n`;
  }
  if (contentLines.length === 1 && contentLines[0] === "[]") {
    const comments = lines
      .filter((line) => line.trim() !== "[]")
      .join("\n")
      .trimEnd();
    return comments === "" ? "" : `${comments}\n`;
  }
  return `${head.replace(/\s*$/, "")}\n\n`;
}

/**
 * 组合新文件内容：既有生成块原位替换；无生成块时接在既有内容之后，
 * 并处理空文件与 dsh profile 模板（注释加 `[]`）两种初始形态。
 */
export function composeManagedBlock(existing: string, blockText: string): string {
  const full = `${MARKER_START}\n${blockText.trimEnd()}\n${MARKER_END}\n`;
  const start = existing.indexOf(MARKER_START);
  if (start !== -1) {
    const end = existing.indexOf(MARKER_END, start);
    const lineEnd = end === -1 ? -1 : existing.indexOf("\n", end);
    const tail = lineEnd < 0 ? "" : existing.slice(lineEnd + 1).replace(/\s*$/, "");
    const head = normalizeHead(existing.slice(0, start));
    return tail === "" ? `${head}${full}` : `${head}${full}${tail}\n`;
  }
  return `${normalizeHead(existing)}${full}`;
}

/** 把生成块写入每个目标文件；内容一致时不落盘。 */
export function writeManagedBlock(paths: string[], blockText: string): WriteResult {
  const written: string[] = [];
  const unchanged: string[] = [];
  for (const path of paths) {
    const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
    const next = composeManagedBlock(existing, blockText);
    if (next === existing) {
      unchanged.push(path);
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp-${process.pid}`;
    writeFileSync(tmp, next, "utf8");
    renameSync(tmp, path);
    // 回读校验：确认落盘内容与意图一致，防住写入被截断等意外。
    const landed = readFileSync(path, "utf8");
    if (landed !== next) {
      throw new Error(`写入校验失败：${path} 落盘内容与预期不一致`);
    }
    written.push(path);
  }
  return { written, unchanged };
}

/**
 * 流式补丁预览：参数生成阶段把补丁文本解析为分文件预览块，供 tool.ts 的
 * renderCall 画进调用组件。本模块是 pi-meow-apply-patch 相对上游的核心新增。
 *
 * 保真度分三层（混合式，2026-10-25 与主人敲定）：
 * - 封口 section（后续 `*** ` 操作标记已出现）：读磁盘，跑执行层同款
 *   planUpdate/applyReplacements 生成真 diff（与内建 edit 同款语义色与词级
 *   高亮），保证"预览即所得"；
 * - 写入中 section（尚未封口）：+/-/空格 行直接着色（glimpse），不匹配磁盘；
 * - 匹配失败：块级黄色警告（渲染层着色），不阻断其他文件。
 *
 * 容错契约：args.input 是流式增量解析出的 JSON 字符串，可能任意截断（悬挂
 * 反斜杠、半个转义、不完整行）。本模块任何解析失败都降级为 glimpse 或空块，
 * 绝不抛错——渲染路径抛错会打断 TUI 重绘。
 *
 * 缓存：磁盘内容按 (mtimeMs:size) 签名缓存；完整 section 的匹配结果按
 * section 文本缓存；input 长度未变时整体复用上一次 blocks。缓存随单次工具
 * 调用的渲染状态存亡（tool.ts 每次调用新建 state），无跨调用生命周期。
 *
 * 同步契约：pi 渲染器是同步路径（内建 edit 的 computeEditsDiff 同上），本
 * 模块全同步（statSync/readFileSync）。同步读在大文件首帧会阻塞一拍，由
 * 缓存兜底：同 path+签名只读一次，后续帧零 IO。
 *
 * 只读保证：本模块只读文件（UTF-8 严格解码，与执行层 nodeFileSystem 一致，
 * 二进制抛错按不可预览处理），不写任何路径；路径先做 workspace 内判定再读，
 * 与执行层边界一致。
 */
import { readFileSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { generateDiffString } from "@earendil-works/pi-coding-agent";
import type { Chunk } from "./core/types.ts";
import { applyReplacements, planUpdate } from "./core/update.ts";

export interface PreviewBlock {
  readonly kind: "add" | "update" | "delete";
  readonly path: string;
  readonly moveTo?: string;
  /** ready：真 diff；partial：写入中（glimpse）；unmatched：匹配失败；noread：磁盘不可读。 */
  readonly state: "ready" | "partial" | "unmatched" | "noread";
  readonly diff?: string;
  readonly glimpse?: readonly string[];
  readonly warning?: string;
}

export interface StreamPreviewState {
  inputLen: number;
  cached?: readonly PreviewBlock[];
  sections: Map<string, PreviewBlock>;
  files: Map<string, { sig: string; content: string }>;
}

export function emptyPreviewState(): StreamPreviewState {
  return { inputLen: -1, sections: new Map(), files: new Map() };
}

interface RawSection {
  kind: "add" | "update" | "delete";
  path: string;
  moveTo?: string;
  lines: string[];
  closed: boolean;
}

/** 解析流式补丁文本为分文件 section。全程容错，输入残缺时返回已可解析的部分。
 *
 * 封口语义：仅当下一个 `*** ` 操作标记或 End Patch 出现时前置 section 才封口；
 * 输入末尾的最后一个 section 保持未封口（写入中），由调用方走 glimpse 分支。
 */
export function parseSections(input: string): RawSection[] {
  const sections: RawSection[] = [];
  let current: RawSection | undefined;
  const close = () => {
    if (current) current.closed = true;
  };
  let begun = false;
  for (const line of input.split("\n")) {
    const trimmedEnd = line.replace(/\r$/, "");
    if (!begun) {
      if (trimmedEnd.trim() === "*** Begin Patch") begun = true;
      continue;
    }
    if (trimmedEnd.startsWith("*** End Patch")) {
      close();
      current = undefined;
      break;
    }
    const op = matchOperation(trimmedEnd);
    if (op) {
      close();
      current = { kind: op.kind, path: op.path, lines: [], closed: false };
      sections.push(current);
      continue;
    }
    if (trimmedEnd.startsWith("*** Move to: ") && current?.kind === "update") {
      current.moveTo = trimmedEnd.slice("*** Move to: ".length);
      continue;
    }
    if (current) current.lines.push(trimmedEnd);
  }
  return sections;
}

function matchOperation(line: string): { kind: RawSection["kind"]; path: string } | undefined {
  for (const [marker, kind] of [
    ["*** Add File: ", "add"],
    ["*** Update File: ", "update"],
    ["*** Delete File: ", "delete"],
  ] as const) {
    if (line.startsWith(marker)) return { kind, path: line.slice(marker.length) };
  }
  return undefined;
}

/** hunk 行（含 +/-/空格 前缀）转执行层 Chunk。与上游 parser 的正常输出对齐。 */
function buildChunks(lines: readonly string[]): Chunk[] {
  const chunks: Chunk[] = [];
  let anchor: string | undefined;
  let eof = false;
  let old: string[] = [];
  let added: string[] = [];
  const flush = () => {
    if (old.length === 0 && added.length === 0 && anchor === undefined && !eof) return;
    chunks.push({
      ...(anchor !== undefined ? { anchor } : {}),
      oldLines: old,
      newLines: added,
      endOfFile: eof,
    });
    anchor = undefined;
    eof = false;
    old = [];
    added = [];
  };
  for (const line of lines) {
    if (line.startsWith("@@")) {
      flush();
      const text = line.slice(2).trim();
      anchor = text.length > 0 ? text : undefined;
      continue;
    }
    if (line === "*** End of File") {
      eof = true;
      flush();
      continue;
    }
    const prefix = line.charAt(0);
    const body = line.slice(1);
    if (prefix === "+") added.push(body);
    else if (prefix === "-") old.push(body);
    else if (prefix === " " || line === "") {
      old.push(body);
      added.push(body);
    }
    // 其他杂行（sha 段、diff --git 污染等）直接忽略：预览从宽，执行层把关。
  }
  flush();
  return chunks;
}

function withinWorkspace(abs: string, cwd: string): boolean {
  const rel = relative(cwd, abs);
  return (
    rel === "" ||
    (rel !== ".." &&
      !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
      !isAbsolute(rel))
  );
}

const utf8Strict = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** 与执行层 nodeFileSystem.readFile 同一套解码行为（UTF-8 fatal，BOM 剥离交匹配层）。 */
function readFileCached(abs: string, state: StreamPreviewState): string | undefined {
  try {
    const st = statSync(abs);
    const sig = `${st.mtimeMs}:${st.size}`;
    const hit = state.files.get(abs);
    if (hit && hit.sig === sig) return hit.content;
    const content = utf8Strict.decode(readFileSync(abs));
    state.files.set(abs, { sig, content });
    return content;
  } catch {
    return undefined;
  }
}

/** 生成前做展示归一（换行统一），与上游 makeDetails 的 display 处理一致。 */
function toDiff(before: string, after: string): string {
  const display = (text: string) => text.replace(/\r\n?/g, "\n");
  return generateDiffString(display(before), display(after)).diff;
}

function addBlock(section: RawSection): PreviewBlock {
  const body = section.lines
    .filter((line) => line.startsWith("+"))
    .map((line) => line.slice(1))
    .join("\n");
  const content = body.length > 0 ? `${body}\n` : "";
  return {
    kind: "add",
    path: section.path,
    ...(section.moveTo !== undefined ? { moveTo: section.moveTo } : {}),
    state: "ready",
    diff: toDiff("", content),
  };
}

function deleteBlock(section: RawSection): PreviewBlock {
  return {
    kind: "delete",
    path: section.path,
    ...(section.moveTo !== undefined ? { moveTo: section.moveTo } : {}),
    state: "ready",
  };
}

function updateBlock(section: RawSection, cwd: string, state: StreamPreviewState): PreviewBlock {
  const abs = resolve(cwd, section.path);
  const base = {
    kind: "update" as const,
    path: section.path,
    ...(section.moveTo !== undefined ? { moveTo: section.moveTo } : {}),
  };
  if (!withinWorkspace(abs, cwd)) {
    return { ...base, state: "noread" };
  }
  const content = readFileCached(abs, state);
  if (content === undefined) {
    return { ...base, state: "noread" };
  }
  const plan = planUpdate(content, buildChunks(section.lines));
  const unmatched = plan.outcomes.filter((outcome) => outcome.status === "unmatched").length;
  if (unmatched > 0) {
    return {
      ...base,
      state: "unmatched",
      warning: `${unmatched} 个 hunk 未能匹配文件内容（预览可能不准，以执行结果为准）`,
    };
  }
  const after = applyReplacements(content, plan.replacements);
  return { ...base, state: "ready", diff: toDiff(content, after) };
}

/**
 * 主入口：input 长度未变直接复用；否则逐 section 处理，封口 section 结果按
 * section 文本缓存（只有新增 section 才触发磁盘读取与匹配）。
 */
export function buildPreview(
  input: string,
  cwd: string,
  state: StreamPreviewState,
): readonly PreviewBlock[] {
  if (input.length === state.inputLen && state.cached) return state.cached;
  const blocks: PreviewBlock[] = [];
  for (const section of parseSections(input)) {
    const isPartialUpdate = !section.closed && section.kind === "update";
    if (isPartialUpdate) {
      blocks.push({
        kind: "update",
        path: section.path,
        ...(section.moveTo !== undefined ? { moveTo: section.moveTo } : {}),
        state: "partial",
        glimpse: section.lines,
      });
      continue;
    }
    const key = `${section.kind}\0${section.path}\0${section.moveTo ?? ""}\0${section.lines.join("\n")}`;
    const hit = state.sections.get(key);
    if (hit) {
      blocks.push(hit);
      continue;
    }
    const block =
      section.kind === "add"
        ? addBlock(section)
        : section.kind === "delete"
          ? deleteBlock(section)
          : updateBlock(section, cwd, state);
    state.sections.set(key, block);
    blocks.push(block);
  }
  state.inputLen = input.length;
  state.cached = blocks;
  return blocks;
}

/**
 * Powerline 状态栏渲染纯库（包内自包含，不跨包 import）。
 *
 * 职责：把语义段拼成一行 ANSI Powerline——每段一个背景色块（色值取
 * 主题 colors 表的 RGB，自拼 48;2 序列，绕开 theme.bg 不接语义别名
 * token 的限制），段间用  三角分隔（前景 = 前段背景色，背景透明），
 * 视觉上三角形是前段色块的收边。
 *
 * 段内容本身由调用方用 theme.fg 预先拼好（前景 ANSI 可内嵌多段切换，
 * \x1b[39m 只关前景不动背景），本库只负责包背景与布局。
 *
 * 宽度降级：整行超宽时从右往左丢段重拼（左边段优先保留），只剩一段
 * 仍超宽时 truncateToWidth 兜底截断。
 */

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** 主题 colors 表（token -> 解析后 RGB；缺失 token 视为不可用段） */
export type ThemeColorTable = Record<string, RGB | undefined>;

export interface StatusSegment {
  /** 背景色 token 名（如 toolPendingBg） */
  bgToken: string;
  /** 段内容（调用方已用 theme.fg 拼好前景，允许内嵌多段前景色） */
  content: string;
}

const POWERLINE_SEPARATOR = "";

function bgAnsi(rgb: RGB): string {
  return `\x1b[48;2;${rgb.r};${rgb.g};${rgb.b}m`;
}

function fgFromBg(rgb: RGB): string {
  return `\x1b[38;2;${rgb.r};${rgb.g};${rgb.b}m`;
}

/**
 * 渲染 Powerline 单行。段从左到右依次拼接，段间三角分隔；
 * 超宽时从右往左丢段，最后一段仍超宽则硬截断。
 * 返回值以 reset 结尾，不影响后续渲染。
 */
export function renderPowerline(
  segments: readonly StatusSegment[],
  width: number,
  colors: ThemeColorTable,
): string {
  const rendered = segments.flatMap((segment) => {
    const bg = colors[segment.bgToken];
    if (!bg || segment.content.length === 0) {
      return [];
    }
    return [{ rgb: bg, text: `${bgAnsi(bg)}${segment.content}` }];
  });

  const join = (parts: readonly { rgb: RGB; text: string }[]): string => {
    let out = "";
    for (const [i, part] of parts.entries()) {
      out += part.text;
      if (i < parts.length - 1) {
        // 分隔符：背景透明，前景 = 当前段背景色，形成色块三角收边
        out += `\x1b[49m${fgFromBg(part.rgb)}${POWERLINE_SEPARATOR}`;
      }
    }
    return `${out}\x1b[0m`;
  };

  for (let keep = rendered.length; keep >= 1; keep--) {
    const line = join(rendered.slice(0, keep));
    if (visibleWidth(line) <= width) {
      return line;
    }
  }
  return truncateToWidth(rendered[0]?.text ?? "", width);
}

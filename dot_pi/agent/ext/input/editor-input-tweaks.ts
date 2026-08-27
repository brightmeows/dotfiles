/**
 * 编辑器输入增强扩展（editor-input-tweaks）：/@ 标记符着色 + / 补全停留
 *
 * 目标（合并自原 slash-completion-hold 与着色需求，避免两个扩展抢占编辑器槽位）：
 * - / 命令补全选中（enter）后停留输入框，不直接执行，需再按一次 enter 才提交
 * - / 命令标记符：黄色（\x1b[33m），@ 文件引用标记符：蓝色（\x1b[34m）
 *   只染“标记符单字符”本身，参数部分保持默认色（轻量方案，视觉提示用）。
 *
 * 纯视觉保证：
 * - 着色仅在 render 输出层注入 ANSI 颜色码，绝不触碰 state.lines（纯文本存储）。
 * - pi 的命令/引用触发全部基于 state.lines 纯文本（submit 读 state.lines.join、
 *   补全读 isInSlashCommandContext / extractAtPrefix），所以染色不影响触发。
 *
 * 着色条件实时复用 pi 识别规则（每次 render 重算，编辑破坏结构时自动取消染色）：
 * - / 命令：行首（trimStart 后）的首个 / —— 对应 pi isInSlashCommandContext
 *   （editor.js: cursorLine===0 且光标前文本 trimStart 以 / 开头）
 * - @ 引用：每个 token 开头（空白分隔）的 @ —— 对应 pi extractAtPrefix
 *   （autocomplete.js: 光标前文本最后 token 以 @ 开头）。本扩展对所有 @ 引用
 *   token 着色（不只光标所在的），视觉更一致。
 *
 * 补全停留原理（重写 handleInput）：
 * - pi 的 / 补全确认（enter）后走 applyCompletion → fall through → submitValue 直接执行；
 *   其他补全确认后 return 停留。本扩展在“补全激活 + 确认键”时临时置 disableSubmit=true
 *   包裹 super.handleInput，拦住 / 补全的 fall-through 提交（其他补全在 submit 检查前
 *   return，不受影响）。用 public 的 disableSubmit / isShowingAutocomplete，无 private 依赖。
 *
 * 实现原理（重写 render，在纯文本层着色）：
 * - pi 的 render 调 private layoutText 拿 layoutLines[{text 纯文本, hasCursor,
 *   cursorPos}]，text 无 ANSI（cursorPos 按纯文本 index 计算）。
 * - 本扩展复制 pi 的 render 主体（padding/border/scroll/autocomplete-list），
 *   但把“光标注入 + 着色”合并为一次 grapheme 遍历：每个字符判断是否光标位、
 *   是否标记符，组合 \x1b[7m（反白光标）与 \x1b[33m/\x1b[34m（颜色），用一个
 *   \x1b[0m 收尾，正确处理光标与颜色叠加（光标停在标记符上时反白+颜色同时生效）。
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ⚠️ API 依赖风险（跨 pi 升级必须复核）
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 private 字段访问（as unknown as 绕过类型检查）：
 *    - layoutText(width)          → 拿纯文本 layoutLines（着色定位的基础）
 *    - lastWidth / scrollOffset   → 滚动状态（render 计算用）
 *    - autocompleteState / autocompleteList → 补全菜单渲染（render 末尾）
 *    pi 若重命名/重构这些 private 成员，本扩展会断，需同步修复。
 * 🟡 render 逻辑复制：光标注入 + padding + border + scroll + autocomplete-list
 *    约 50 行复制自 pi-tui editor.js render()，pi 改 render 本扩展要同步。
 * 🟡 createScrollBorder：pi-tui editor.js 模块私有函数，本扩展复制其实现。
 * 🟢 颜色固定 ANSI 标准色：pi 的 EditorTheme 仅含 borderColor/selectList，
 *    无 semantic fg()，故用固定 \x1b[33m/\x1b[34m（不随主题变）。颜色常量集中
 *    在文件顶部，便于调整。
 *
 * 设计权衡（2026-08-07 主人确认）：
 * - 只染标记符单字符（方案 C），不染整个 token——光标与颜色叠加只发生在
 *   “光标恰好停在 / 或 @ 上”这一种情况，处理简单稳妥
 * - 接受 private API + render 复制的维护代价，换取输入框着色能力
 *
 * private API 自检降级（2026-08-27）：session_start 实例化编辑器时探测 5 个
 * private 成员（layoutText/lastWidth/scrollOffset/autocompleteState/
 * autocompleteList），任一缺失（pi 升级后重构）则降级为原生 CustomEditor 并
 * notify 提示，失效模式从“崩溃”变为“安静降级 + 可见提示”。
 */

import { CustomEditor, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CURSOR_MARKER, getKeybindings, sliceByColumn, visibleWidth } from "@earendil-works/pi-tui";

// ─── ANSI 颜色常量（固定标准色，便于调整） ───
const RESET = "\x1b[0m";
const REVERSE = "\x1b[7m";
const YELLOW = "\x1b[33m"; // / 命令标记符
const BLUE = "\x1b[34m"; // @ 文件引用标记符

// ─── grapheme 切分（不依赖 pi 的 private segment 方法） ───
const graphemeSegmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

/** 取字符串首个 grapheme（光标字符处理用）。 */
function firstGrapheme(s: string): string {
  const result = graphemeSegmenter.segment(s)[Symbol.iterator]().next();
  return result.done ? "" : result.value.segment;
}

// ─── pi-tui Editor 的 private 成员视图（绕过类型检查访问内部状态） ───
interface EditorInternals {
  layoutText: (width: number) => LayoutLine[];
  lastWidth: number;
  scrollOffset: number;
  autocompleteState: unknown;
  autocompleteList: { render: (width: number) => string[] } | null;
}

/** 单行结构（layoutText 返回值）：纯文本 + 光标位置。 */
interface LayoutLine {
  text: string;
  hasCursor: boolean;
  cursorPos: number;
}

/**
 * 复制自 pi-tui editor.js 的模块私有函数 createScrollBorder。
 * 🟡 风险：pi 改此函数本扩展要同步。
 */
function createScrollBorder(direction: string, hiddenLineCount: number, width: number): string {
  const availableWidth = Math.max(0, width);
  const indicator = `─── ${direction} ${hiddenLineCount} more `;
  const remaining = availableWidth - visibleWidth(indicator);
  if (remaining >= 0) {
    return indicator + "─".repeat(remaining);
  }
  const ellipsis = "...".slice(0, availableWidth);
  const indicatorWidth = availableWidth - visibleWidth(ellipsis);
  return sliceByColumn(indicator, 0, indicatorWidth, true) + ellipsis;
}

// ─── 标记符定位（复用 pi 识别规则） ───

/**
 * / 命令标记符位置：行首（trimStart 后）的首个 /。
 * 对应 pi isInSlashCommandContext（cursorLine===0 且光标前文本 trimStart 以 / 开头）。
 * 返回 -1 表示该行无 / 命令标记。
 */
function findSlashPos(text: string): number {
  const lead = text.length - text.trimStart().length;
  return text.charAt(lead) === "/" ? lead : -1;
}

/**
 * @ 引用标记符位置集合：所有 token 开头（空白分隔）的 @。
 * 对应 pi extractAtPrefix（光标前文本最后 token 以 @ 开头）；本扩展对所有 @ token 着色。
 */
function findAtPositions(text: string): Set<number> {
  const positions = new Set<number>();
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /\s/.test(text.charAt(i))) {
      i++;
    }
    if (i >= text.length) {
      break;
    }
    if (text.charAt(i) === "@") {
      positions.add(i);
    }
    while (i < text.length && !/\s/.test(text.charAt(i))) {
      i++;
    }
  }
  return positions;
}

/**
 * 渲染单个 layoutLine：着色 + 光标一次 grapheme 遍历完成。
 *
 * 每个字符判断是否光标位、是否标记符，组合 ANSI 前缀（反白 \x1b[7m + 颜色），
 * 用一个 \x1b[0m 收尾。光标停在标记符上时反白+颜色同时生效。
 *
 * 返回 displayText（含 ANSI）与可见宽度（光标行尾时已 +1）。
 */
function renderLayoutLine({
  text,
  hasCursor,
  cursorPos,
  emitMarker,
  isFirstLine,
}: {
  text: string;
  hasCursor: boolean;
  cursorPos: number;
  emitMarker: boolean;
  isFirstLine: boolean;
}): { displayText: string; width: number } {
  const slashPos = isFirstLine ? findSlashPos(text) : -1;
  const atPositions = findAtPositions(text);

  const colorOf = (idx: number): string | undefined => {
    if (idx === slashPos) {
      return YELLOW;
    }
    if (atPositions.has(idx)) {
      return BLUE;
    }
    return undefined;
  };
  // 普通字符着色（非光标位）
  const emitColored = (idx: number, ch: string): string => {
    const color = colorOf(idx);
    return color ? color + ch + RESET : ch;
  };

  let displayText = "";
  let width = visibleWidth(text);

  if (!hasCursor) {
    for (let i = 0; i < text.length; i++) {
      displayText += emitColored(i, text.charAt(i));
    }
    return { displayText, width };
  }

  // 有光标：分 before / 光标字符 / rest 三段
  const before = text.slice(0, cursorPos);
  const after = text.slice(cursorPos);
  for (let i = 0; i < before.length; i++) {
    displayText += emitColored(i, before.charAt(i));
  }

  const marker = emitMarker ? CURSOR_MARKER : "";
  if (after.length > 0) {
    // 光标落在字符上：取首个 grapheme，叠加反白 +（若为标记符）颜色
    const grapheme = firstGrapheme(after);
    const rest = after.slice(grapheme.length);
    const color = colorOf(cursorPos);
    const prefix = color ? REVERSE + color : REVERSE;
    displayText += marker + prefix + grapheme + RESET;
    for (let j = 0; j < rest.length; j++) {
      displayText += emitColored(cursorPos + grapheme.length + j, rest.charAt(j));
    }
  } else {
    // 光标在行尾：高亮一个空格
    displayText += `${marker}${REVERSE} ${RESET}`;
    width += 1;
  }
  return { displayText, width };
}

/**
 * 编辑器输入增强编辑器：/@ 着色（render）+ / 补全停留（handleInput）。
 *
 * 继承 CustomEditor 保留全部 app 级键绑定与 handler，重写 render 注入着色、
 * 重写 handleInput 拦截 / 补全的 fall-through 提交。
 */
class SlashAtHighlightEditor extends CustomEditor {
  // / 补全停留：补全激活时按确认键，临时禁用提交，拦住 / 补全的 fall-through 提交。
  // 其他补全（@/#/文件）在 submit 检查前已 return，不受影响。
  override handleInput(data: string): void {
    if (getKeybindings().matches(data, "tui.select.confirm") && this.isShowingAutocomplete()) {
      const prev = this.disableSubmit;
      this.disableSubmit = true;
      try {
        super.handleInput(data);
      } finally {
        this.disableSubmit = prev;
      }
      return;
    }
    super.handleInput(data);
  }

  override render(width: number): string[] {
    const self = this as unknown as EditorInternals;

    // ── 以下复制自 pi-tui editor.js render()，仅 displayText 生成换成本扩展的着色版本 ──
    const maxPadding = Math.max(0, Math.floor((width - 1) / 2));
    const paddingX = Math.min(this.getPaddingX(), maxPadding);
    const contentWidth = Math.max(1, width - paddingX * 2);
    const layoutWidth = Math.max(1, contentWidth - (paddingX ? 0 : 1));
    self.lastWidth = layoutWidth;

    const horizontal = this.borderColor("─");
    const layoutLines = self.layoutText(layoutWidth);

    const maxVisibleLines = Math.max(5, Math.floor(this.tui.terminal.rows * 0.3));
    let cursorLineIndex = layoutLines.findIndex((line) => line.hasCursor);
    if (cursorLineIndex === -1) {
      cursorLineIndex = 0;
    }
    if (cursorLineIndex < self.scrollOffset) {
      self.scrollOffset = cursorLineIndex;
    } else if (cursorLineIndex >= self.scrollOffset + maxVisibleLines) {
      self.scrollOffset = cursorLineIndex - maxVisibleLines + 1;
    }
    const maxScrollOffset = Math.max(0, layoutLines.length - maxVisibleLines);
    self.scrollOffset = Math.max(0, Math.min(self.scrollOffset, maxScrollOffset));

    const visibleLines = layoutLines.slice(self.scrollOffset, self.scrollOffset + maxVisibleLines);
    const result: string[] = [];
    const leftPadding = " ".repeat(paddingX);
    const rightPadding = leftPadding;

    // 顶 border（含向上滚动指示）
    if (self.scrollOffset > 0) {
      result.push(this.borderColor(createScrollBorder("↑", self.scrollOffset, width)));
    } else {
      result.push(horizontal.repeat(width));
    }

    // 内容行：着色 + 光标统一遍历
    const emitCursorMarker = this.focused;
    let isFirstContentLine = true;
    for (const layoutLine of visibleLines) {
      const { displayText, width: lineVisibleWidth } = renderLayoutLine({
        text: layoutLine.text,
        hasCursor: layoutLine.hasCursor,
        cursorPos: layoutLine.cursorPos,
        emitMarker: emitCursorMarker,
        isFirstLine: isFirstContentLine,
      });
      isFirstContentLine = false;
      const padding = " ".repeat(Math.max(0, contentWidth - lineVisibleWidth));
      const cursorInPadding =
        layoutLine.hasCursor && lineVisibleWidth > contentWidth && paddingX > 0;
      const lineRightPadding = cursorInPadding ? rightPadding.slice(1) : rightPadding;
      result.push(`${leftPadding}${displayText}${padding}${lineRightPadding}`);
    }

    // 底 border（含向下滚动指示）
    const linesBelow = layoutLines.length - (self.scrollOffset + visibleLines.length);
    if (linesBelow > 0) {
      result.push(this.borderColor(createScrollBorder("↓", linesBelow, width)));
    } else {
      result.push(horizontal.repeat(width));
    }

    // 补全菜单（激活时追加在底 border 之前的结果末尾）
    if (self.autocompleteState && self.autocompleteList) {
      const autocompleteResult = self.autocompleteList.render(contentWidth);
      for (const line of autocompleteResult) {
        const lineWidth = visibleWidth(line);
        const linePadding = " ".repeat(Math.max(0, contentWidth - lineWidth));
        result.push(`${leftPadding}${line}${linePadding}${rightPadding}`);
      }
    }

    return result;
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    // 编辑器组件仅 TUI 模式有意义
    if (ctx.mode !== "tui") {
      return;
    }
    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      const editor = new SlashAtHighlightEditor(tui, theme, keybindings);
      // Private API 自检：缺失即降级原生编辑器，避免 pi 升级后扩展崩溃
      if (!checkEditorInternals(editor)) {
        ctx.ui.notify(
          "editor-input-tweaks：pi-tui Editor private 成员缺失，已降级为原生编辑器（着色/补全停留停用）",
          "warning",
        );
        return new CustomEditor(tui, theme, keybindings);
      }
      return editor;
    });
  });
}

/**
 * 探测 pi-tui Editor 的 5 个 private 成员是否存在（跨版本自检）。
 * layoutText 为原型方法，其余为实例字段；任一缺失即判定 private API 已变更。
 */
function checkEditorInternals(editor: SlashAtHighlightEditor): boolean {
  const self = editor as unknown as Record<string, unknown>;
  return (
    typeof self["layoutText"] === "function" &&
    "lastWidth" in self &&
    "scrollOffset" in self &&
    "autocompleteState" in self &&
    "autocompleteList" in self
  );
}

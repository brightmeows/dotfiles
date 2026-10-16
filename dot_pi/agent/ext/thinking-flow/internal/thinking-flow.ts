/**
 * 接管 AssistantMessageComponent.updateContent 的核心实现。
 *
 * 可见性推导（对每个 thinking run）：
 *   visible = override ?? (hideThinkingBlock || runIndex === activeIndex)
 * - activeIndex：流式进行中且最后一个 segment 是 thinking 时为其下标，
 *   否则 -1（无进行中 run）
 * - override：内置单块点击 toggle（MouseRegion），优先级最高
 * - hideThinkingBlock：true 时全量展示（expanded 态，语义已反转，见
 *   index.ts 头注释）；false 时进入 flow 态，仅进行中 run 显示
 *
 * 渲染等价性（与 pi 1.2.0 assistant-message.js 对照）：
 * - segments 预扫合并连续 thinking 块（join "\n\n"），text 打断；
 *   空白块不入列——与原循环的 run 收集、空 run 跳过等价
 * - 开头 Spacer 条件（存在可见内容）、run 间 Spacer 条件（后方仍有
 *   可见内容）在 segments 模型下由 length>0 与 index<len-1 表达
 * - text 分支、abort/error/length 尾注逐行照抄，不改变行为
 *
 * 私有成员访问：不与类类型做交集（private 成员会使 intersection 塌缩为
 * never），改用纯形状接口 cast + in 探测守卫，不过则回退 original。
 * 守卫成员不含 lastMessage：bun 打包丢弃无初始值的类字段声明（家规
 * 踩坑点），lastMessage 构造后合法地不存在，首帧会误判回退 original；
 * 其余成员均构造期赋值，探测可靠。
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
  AssistantMessageComponent,
  MarkdownTransformer,
} from "@earendil-works/pi-coding-agent";
import {
  Container,
  Markdown,
  MouseRegion,
  Spacer,
  Text,
  type Component,
  type MarkdownTheme,
} from "@earendil-works/pi-tui";
import { createMarkdownTransform } from "./markdown-transform.ts";

// 主题访问（globalThis 共享单例，跨 module loader）

const THEME_KEY = Symbol.for("@earendil-works/pi-coding-agent:theme");
const THEME_KEY_OLD = Symbol.for("@mariozechner/pi-coding-agent:theme");

/** Theme 单例的实际接口面（只用到的三个方法；token 用宽松 string 接住） */
interface ThemeLike {
  fg: (color: string, text: string) => string;
  italic: (text: string) => string;
  bold: (text: string) => string;
}

function getTheme(): ThemeLike | undefined {
  const globals = globalThis as unknown as Record<symbol, unknown>;
  const theme = globals[THEME_KEY] ?? globals[THEME_KEY_OLD];
  return typeof theme === "object" && theme !== null ? (theme as ThemeLike) : undefined;
}

function fgOr(token: string, text: string): string {
  return getTheme()?.fg(token, text) ?? text;
}

const THINKING_TOKEN = "thinkingText";
const ACCENT_TOKEN = "accent";
const DIM_TOKEN = "dim";
const MUTED_TOKEN = "muted";
const COLLAPSED_LABEL = "Thinking";
const COLLAPSED_STATE = "已折叠";
const COLLAPSED_HINT = "点击展开";

// 可见段预扫

type Segment = { kind: "text"; text: string } | { kind: "thinking"; text: string };

/** 消息 content 数组折叠为有序可见段：非空 text 与连续非空 thinking 各成一段 */
function toSegments(content: AssistantMessage["content"]): Segment[] {
  const segments: Segment[] = [];
  for (const item of content) {
    if (item.type === "text" && item.text.trim()) {
      segments.push({ kind: "text", text: item.text.trim() });
    } else if (item.type === "thinking" && item.thinking.trim()) {
      const trimmed = item.thinking.trim();
      const last = segments.at(-1);
      if (last?.kind === "thinking") {
        last.text += `\n\n${trimmed}`;
      } else {
        segments.push({ kind: "thinking", text: trimmed });
      }
    }
  }
  return segments;
}

// Patch 目标形状

type UpdateContentFn = (message: AssistantMessage, isStreaming?: boolean) => void;

interface PatchedThis {
  contentContainer: Container;
  hideThinkingBlock: boolean;
  markdownTheme: MarkdownTheme;
  outputPad: number;
  markdownTransformers: readonly MarkdownTransformer[];
  lastMessage: AssistantMessage | undefined;
  hasToolCalls: boolean;
  isStreaming: boolean;
  thinkingVisibilityOverrides: Map<number, boolean>;
  updateContent: UpdateContentFn;
}

const SHAPE_MEMBERS: readonly string[] = [
  "contentContainer",
  "hideThinkingBlock",
  "markdownTheme",
  "outputPad",
  "markdownTransformers",
  "hasToolCalls",
  "isStreaming",
  "thinkingVisibilityOverrides",
  "updateContent",
];

function hasRequiredShape(instance: unknown): instance is PatchedThis {
  if (typeof instance !== "object" || instance === null) {
    return false;
  }
  const probe = instance as Record<string, unknown>;
  return SHAPE_MEMBERS.every((member) => probe[member] !== undefined);
}

// 思考块渲染

function renderExpandedThinking(text: string, self: PatchedThis): Component {
  const section = new Container();
  const theme = getTheme();
  const label = theme ? theme.fg(THINKING_TOKEN, theme.bold("Thinking")) : "Thinking";
  section.addChild(new Text(label, self.outputPad, 0));

  const style = {
    ...(theme ? { color: (t: string) => theme.fg(THINKING_TOKEN, t) } : {}),
    italic: true,
  };
  section.addChild(
    new Markdown(text, self.outputPad, 0, self.markdownTheme, style, {
      transform: createMarkdownTransform(
        "assistant-thinking",
        self.isStreaming,
        self.markdownTransformers,
      ),
    }),
  );
  return section;
}

/** 折叠占位行：> 前缀 + 分层语义色（accent/thinking 粗体/dim/muted），显式已折叠状态与点击提示 */
function renderHiddenThinking(outputPad: number): Component {
  const theme = getTheme();
  const chevron = theme?.fg(ACCENT_TOKEN, ">") ?? ">";
  const label = theme?.fg(THINKING_TOKEN, theme.bold(COLLAPSED_LABEL)) ?? COLLAPSED_LABEL;
  const state = theme?.fg(DIM_TOKEN, ` · ${COLLAPSED_STATE}`) ?? ` · ${COLLAPSED_STATE}`;
  const hint = theme?.fg(MUTED_TOKEN, ` · ${COLLAPSED_HINT}`) ?? ` · ${COLLAPSED_HINT}`;
  return new Text(`${chevron} ${label}${state}${hint}`, outputPad, 0);
}

interface ThinkingRunContext {
  runIndex: number;
  text: string;
  activeIndex: number;
}

function renderThinkingRun(self: PatchedThis, run: ThinkingRunContext): Component {
  const { runIndex, activeIndex } = run;
  const override = self.thinkingVisibilityOverrides.get(runIndex);
  const visible = override ?? (self.hideThinkingBlock || runIndex === activeIndex);
  const inner = visible
    ? renderExpandedThinking(run.text, self)
    : renderHiddenThinking(self.outputPad);
  return new MouseRegion(inner, (event) => {
    if (event.type !== "click" || event.button !== "left") {
      return undefined;
    }
    self.thinkingVisibilityOverrides.set(runIndex, !visible);
    if (self.lastMessage) {
      self.updateContent(self.lastMessage);
    }
    return { handled: true };
  });
}

// 正文与尾部修整（照抄内置逻辑）

function renderAssistantText(text: string, self: PatchedThis, isStreaming: boolean): Component {
  return new Markdown(text, self.outputPad, 0, self.markdownTheme, undefined, {
    transform: createMarkdownTransform("assistant", isStreaming, self.markdownTransformers),
  });
}

function finishMessageChrome(self: PatchedThis, message: AssistantMessage): void {
  const hasToolCalls = message.content.some((c) => c.type === "toolCall");
  self.hasToolCalls = hasToolCalls;
  if (message.stopReason === "length") {
    self.contentContainer.addChild(new Spacer(1));
    self.contentContainer.addChild(
      new Text(fgOr("error", "Response was truncated before completion."), self.outputPad, 0),
    );
    return;
  }
  if (hasToolCalls) {
    return;
  }
  if (message.stopReason === "aborted") {
    const abortMessage =
      message.errorMessage && message.errorMessage !== "Request was aborted"
        ? message.errorMessage
        : "Operation aborted";
    self.contentContainer.addChild(new Spacer(1));
    self.contentContainer.addChild(new Text(fgOr("error", abortMessage), self.outputPad, 0));
  } else if (message.stopReason === "error") {
    const errorMsg = message.errorMessage || "Unknown error";
    self.contentContainer.addChild(new Spacer(1));
    self.contentContainer.addChild(
      new Text(fgOr("error", `Error: ${errorMsg}`), self.outputPad, 0),
    );
  }
}

// Patch 安装

function createPatchedUpdateContent(
  original: UpdateContentFn,
): (this: AssistantMessageComponent, message: AssistantMessage, isStreaming?: boolean) => void {
  return function patchedUpdateContent(this, message, isStreaming) {
    const self = this as unknown as PatchedThis;
    if (!hasRequiredShape(self)) {
      original.call(this, message, isStreaming);
      return;
    }

    const streaming = isStreaming ?? self.isStreaming;

    self.lastMessage = message;
    self.isStreaming = streaming;
    self.contentContainer.clear();

    const segments = toSegments(message.content);
    if (segments.length > 0) {
      self.contentContainer.addChild(new Spacer(1));
    }

    const activeIndex =
      streaming && segments.at(-1)?.kind === "thinking" ? segments.length - 1 : -1;

    for (const [index, segment] of segments.entries()) {
      const component =
        segment.kind === "text"
          ? renderAssistantText(segment.text, self, streaming)
          : renderThinkingRun(self, { runIndex: index, text: segment.text, activeIndex });
      self.contentContainer.addChild(component);
      if (index < segments.length - 1) {
        self.contentContainer.addChild(new Spacer(1));
      }
    }

    finishMessageChrome(self, message);
  };
}

const ORIGINAL_KEY = Symbol.for("pi-meow-thinking-flow:original-update-content");

/**
 * 安装 patch。幂等设计：原生方法引用存 globalThis Symbol 槽，
 * 重装时 patch 闭包始终指向原生方法——reload 载入新代码后旧 patch
 * 被整体替换，不会出现 patch 套 patch。
 */
export function installThinkingFlowPatch(target: typeof AssistantMessageComponent): void {
  const globals = globalThis as unknown as Record<symbol, unknown>;
  const original =
    (globals[ORIGINAL_KEY] as UpdateContentFn | undefined) ?? target.prototype.updateContent;
  globals[ORIGINAL_KEY] = original;
  target.prototype.updateContent = createPatchedUpdateContent(original);
}

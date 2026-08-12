/**
 * Questionnaire Tool - Unified tool for asking single or multiple questions
 *
 * Single question: simple options list
 * Multiple questions: tab bar navigation between questions
 *
 * 基于官方示例 examples/extensions/questionnaire.ts（pi 0.84.1）演化而来，
 * 注册工具名 `questionnaire`。2026-08-11 由 official-clone 克隆区提升为顶层
 * 单文件扩展，可自由修改（不再受"原样克隆上游"约束）。相对上游的已知差异：
 * ① UI 文案与 schema description 中文化；② 仓库严格 tsconfig
 * （`noUncheckedIndexedAccess` / `exactOptionalPropertyTypes`）下的最小类型
 * 修复；③ typebox 为仓库 devDependency（运行时由 Pi 内部解析，仓库声明仅为
 * `pnpm check` 通过）。功能特性与上游完全对齐。
 *
 * 上游：/var/home/brightmeows/.local/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/questionnaire.ts
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  Editor,
  type EditorTheme,
  Key,
  matchesKey,
  Text,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";

// Types
interface QuestionOption {
  value: string;
  label: string;
  description?: string;
}

type RenderOption = QuestionOption & { isOther?: boolean };

interface Question {
  id: string;
  label: string;
  prompt: string;
  options: QuestionOption[];
  allowOther: boolean;
}

interface Answer {
  id: string;
  value: string;
  label: string;
  wasCustom: boolean;
  index?: number;
}

interface QuestionnaireResult {
  questions: Question[];
  answers: Answer[];
  cancelled: boolean;
}

// Schema
const QuestionOptionSchema = Type.Object({
  value: Type.String({ description: "选中时返回的值" }),
  label: Type.String({ description: "选项的显示标签" }),
  description: Type.Optional(Type.String({ description: "选项下方显示的补充说明（可选）" })),
});

const QuestionSchema = Type.Object({
  id: Type.String({ description: "该问题的唯一标识" }),
  label: Type.Optional(
    Type.String({
      description: "tab 栏的简短上下文标签，如“范围”“优先级”（默认 Q1、Q2）",
    }),
  ),
  prompt: Type.String({ description: "要显示的完整问题正文" }),
  options: Type.Array(QuestionOptionSchema, { description: "供选择的选项列表" }),
  allowOther: Type.Optional(
    Type.Boolean({ description: "是否允许“输入其他内容”选项（默认 true）" }),
  ),
});

const QuestionnaireParams = Type.Object({
  questions: Type.Array(QuestionSchema, { description: "要向用户提出的问题" }),
});

function errorResult(
  message: string,
  questions: Question[] = [],
): { content: { type: "text"; text: string }[]; details: QuestionnaireResult } {
  return {
    content: [{ type: "text", text: message }],
    details: { questions, answers: [], cancelled: true },
  };
}

export default function questionnaire(pi: ExtensionAPI) {
  pi.registerTool({
    name: "questionnaire",
    label: "Questionnaire",
    description:
      "向用户提出一个或多个问题。用于澄清需求、获取偏好或确认决策。单个问题显示为简单的选项列表；多个问题显示为带 tab 切换的界面。建议：调用本工具前，先在对话正文里把各个选项的完整含义向用户解释清楚，让用户带着理解在界面里选择。",
    parameters: QuestionnaireParams,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (ctx.mode !== "tui") {
        return errorResult("错误：UI 不可用（运行在非交互模式）");
      }
      if (params.questions.length === 0) {
        return errorResult("错误：未提供任何问题");
      }

      // Normalize questions with defaults
      const questions: Question[] = params.questions.map((q, i) => ({
        ...q,
        label: q.label || `Q${i + 1}`,
        allowOther: q.allowOther !== false,
      }));

      const isMulti = questions.length > 1;
      const totalTabs = questions.length + 1; // questions + Submit

      const result = await ctx.ui.custom<QuestionnaireResult>((tui, theme, _kb, done) => {
        // State
        let currentTab = 0;
        let optionIndex = 0;
        let inputMode = false;
        let inputQuestionId: string | null = null;
        let cachedLines: string[] | undefined;
        const answers = new Map<string, Answer>();

        // “输入其他内容…”选项的编辑器
        const editorTheme: EditorTheme = {
          borderColor: (s) => theme.fg("accent", s),
          selectList: {
            selectedPrefix: (t) => theme.fg("accent", t),
            selectedText: (t) => theme.fg("accent", t),
            description: (t) => theme.fg("muted", t),
            scrollInfo: (t) => theme.fg("dim", t),
            noMatch: (t) => theme.fg("warning", t),
          },
        };
        const editor = new Editor(tui, editorTheme);

        // Helpers
        function refresh() {
          cachedLines = undefined;
          tui.requestRender();
        }

        function submit(cancelled: boolean) {
          done({ questions, answers: Array.from(answers.values()), cancelled });
        }

        function currentQuestion(): Question | undefined {
          return questions[currentTab];
        }

        function currentOptions(): RenderOption[] {
          const q = currentQuestion();
          if (!q) return [];
          const opts: RenderOption[] = [...q.options];
          if (q.allowOther) {
            opts.push({ value: "__other__", label: "输入其他内容…", isOther: true });
          }
          return opts;
        }

        function allAnswered(): boolean {
          return questions.every((q) => answers.has(q.id));
        }

        function advanceAfterAnswer() {
          if (!isMulti) {
            submit(false);
            return;
          }
          if (currentTab < questions.length - 1) {
            currentTab++;
          } else {
            currentTab = questions.length; // Submit tab
          }
          optionIndex = 0;
          refresh();
        }

        function saveAnswer(
          questionId: string,
          value: string,
          label: string,
          wasCustom: boolean,
          index?: number,
        ) {
          answers.set(questionId, {
            id: questionId,
            value,
            label,
            wasCustom,
            ...(index !== undefined ? { index } : {}),
          });
        }

        // Editor submit callback
        editor.onSubmit = (value) => {
          if (!inputQuestionId) return;
          const trimmed = value.trim() || "（未作答）";
          saveAnswer(inputQuestionId, trimmed, trimmed, true);
          inputMode = false;
          inputQuestionId = null;
          editor.setText("");
          advanceAfterAnswer();
        };

        function handleInput(data: string) {
          // Input mode: route to editor
          if (inputMode) {
            if (matchesKey(data, Key.escape)) {
              inputMode = false;
              inputQuestionId = null;
              editor.setText("");
              refresh();
              return;
            }
            editor.handleInput(data);
            refresh();
            return;
          }

          const q = currentQuestion();
          const opts = currentOptions();

          // Tab navigation (multi-question only)
          if (isMulti) {
            if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
              currentTab = (currentTab + 1) % totalTabs;
              optionIndex = 0;
              refresh();
              return;
            }
            if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
              currentTab = (currentTab - 1 + totalTabs) % totalTabs;
              optionIndex = 0;
              refresh();
              return;
            }
          }

          // Submit tab
          if (currentTab === questions.length) {
            if (matchesKey(data, Key.enter) && allAnswered()) {
              submit(false);
            } else if (matchesKey(data, Key.escape)) {
              submit(true);
            }
            return;
          }

          // Option navigation
          if (matchesKey(data, Key.up)) {
            optionIndex = Math.max(0, optionIndex - 1);
            refresh();
            return;
          }
          if (matchesKey(data, Key.down)) {
            optionIndex = Math.min(opts.length - 1, optionIndex + 1);
            refresh();
            return;
          }

          // Select option
          if (matchesKey(data, Key.enter) && q) {
            const opt = opts[optionIndex]!;
            if (opt.isOther) {
              inputMode = true;
              inputQuestionId = q.id;
              editor.setText("");
              refresh();
              return;
            }
            saveAnswer(q.id, opt.value, opt.label, false, optionIndex + 1);
            advanceAfterAnswer();
            return;
          }

          // Cancel
          if (matchesKey(data, Key.escape)) {
            submit(true);
          }
        }

        function render(width: number): string[] {
          if (cachedLines) return cachedLines;

          const lines: string[] = [];
          const renderWidth = Math.max(1, width);
          const q = currentQuestion();
          const opts = currentOptions();

          function addWrapped(text: string) {
            lines.push(...wrapTextWithAnsi(text, renderWidth));
          }

          function addWrappedWithPrefix(prefix: string, text: string) {
            const prefixWidth = visibleWidth(prefix);
            if (prefixWidth >= renderWidth) {
              addWrapped(prefix + text);
              return;
            }
            const wrapped = wrapTextWithAnsi(text, renderWidth - prefixWidth);
            const continuationPrefix = " ".repeat(prefixWidth);
            for (let i = 0; i < wrapped.length; i++) {
              lines.push(`${i === 0 ? prefix : continuationPrefix}${wrapped[i]}`);
            }
          }

          lines.push(theme.fg("accent", "─".repeat(renderWidth)));

          // Tab bar (multi-question only)
          if (isMulti) {
            const tabs: string[] = ["← "];
            for (const [i, q] of questions.entries()) {
              const isActive = i === currentTab;
              const isAnswered = answers.has(q.id);
              const lbl = q.label;
              const box = isAnswered ? "■" : "□";
              const color = isAnswered ? "success" : "muted";
              const text = ` ${box} ${lbl} `;
              const styled = isActive
                ? theme.bg("selectedBg", theme.fg("text", text))
                : theme.fg(color, text);
              tabs.push(`${styled} `);
            }
            const canSubmit = allAnswered();
            const isSubmitTab = currentTab === questions.length;
            const submitText = " ✓ 提交 ";
            const submitStyled = isSubmitTab
              ? theme.bg("selectedBg", theme.fg("text", submitText))
              : theme.fg(canSubmit ? "success" : "dim", submitText);
            tabs.push(`${submitStyled} →`);
            addWrappedWithPrefix(" ", tabs.join(""));
            lines.push("");
          }

          // Helper to render options list
          function renderOptions() {
            for (const [i, opt] of opts.entries()) {
              const selected = i === optionIndex;
              const isOther = opt.isOther === true;
              const prefix = selected ? theme.fg("accent", "> ") : "  ";
              const label = `${i + 1}. ${opt.label}${isOther && inputMode ? " ✎" : ""}`;
              const color = selected || (isOther && inputMode) ? "accent" : "text";

              addWrappedWithPrefix(prefix, theme.fg(color, label));
              if (opt.description) {
                addWrappedWithPrefix("     ", theme.fg("muted", opt.description));
              }
            }
          }

          // Content
          if (inputMode && q) {
            addWrappedWithPrefix(" ", theme.fg("text", q.prompt));
            lines.push("");
            // Show options for reference
            renderOptions();
            lines.push("");
            addWrappedWithPrefix(" ", theme.fg("muted", "你的回答："));
            for (const line of editor.render(Math.max(1, renderWidth - 2))) {
              lines.push(` ${line}`);
            }
            lines.push("");
            addWrappedWithPrefix(" ", theme.fg("dim", "回车提交 • Esc 取消"));
          } else if (currentTab === questions.length) {
            addWrappedWithPrefix(" ", theme.fg("accent", theme.bold("准备提交")));
            lines.push("");
            for (const question of questions) {
              const answer = answers.get(question.id);
              if (answer) {
                const prefix = answer.wasCustom ? "（自填）" : "";
                const summary = `${theme.fg("muted", `${question.label}: `)}${theme.fg("text", prefix + answer.label)}`;
                addWrappedWithPrefix(" ", summary);
              }
            }
            lines.push("");
            if (allAnswered()) {
              addWrappedWithPrefix(" ", theme.fg("success", "按回车提交"));
            } else {
              const missing = questions
                .filter((q) => !answers.has(q.id))
                .map((q) => q.label)
                .join(", ");
              addWrappedWithPrefix(" ", theme.fg("warning", `未作答：${missing}`));
            }
          } else if (q) {
            addWrappedWithPrefix(" ", theme.fg("text", q.prompt));
            lines.push("");
            renderOptions();
          }

          lines.push("");
          if (!inputMode) {
            const help = isMulti
              ? "Tab/←→ 切换 • ↑↓ 选择 • 回车确认 • Esc 取消"
              : "↑↓ 选择 • 回车选中 • Esc 取消";
            addWrappedWithPrefix(" ", theme.fg("dim", help));
          }
          lines.push(theme.fg("accent", "─".repeat(renderWidth)));

          cachedLines = lines;
          return lines;
        }

        return {
          render,
          invalidate: () => {
            cachedLines = undefined;
          },
          handleInput,
        };
      });

      if (result.cancelled) {
        return {
          content: [{ type: "text", text: "用户取消了问卷" }],
          details: result,
        };
      }

      const answerLines = result.answers.map((a) => {
        const qLabel = questions.find((q) => q.id === a.id)?.label || a.id;
        if (a.wasCustom) {
          return `${qLabel}：用户自填：${a.label}`;
        }
        return `${qLabel}：用户选择：${a.index}. ${a.label}`;
      });

      return {
        content: [{ type: "text", text: answerLines.join("\n") }],
        details: result,
      };
    },

    renderCall(args, theme, _context) {
      const qs = (args.questions as Question[]) || [];
      const count = qs.length;
      const labels = qs.map((q) => q.label || q.id).join(", ");
      let text = theme.fg("toolTitle", theme.bold("questionnaire "));
      text += theme.fg("muted", `${count} 个问题`);
      if (labels) {
        text += theme.fg("dim", ` (${labels})`);
      }
      return new Text(text, 0, 0);
    },

    renderResult(result, _options, theme, _context) {
      const details = result.details as QuestionnaireResult | undefined;
      if (!details) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "", 0, 0);
      }
      if (details.cancelled) {
        return new Text(theme.fg("warning", "已取消"), 0, 0);
      }
      const lines = details.answers.map((a) => {
        if (a.wasCustom) {
          return `${theme.fg("success", "✓ ")}${theme.fg("accent", a.id)}：${theme.fg("muted", "（自填）")}${a.label}`;
        }
        const display = a.index ? `${a.index}. ${a.label}` : a.label;
        return `${theme.fg("success", "✓ ")}${theme.fg("accent", a.id)}：${display}`;
      });
      return new Text(lines.join("\n"), 0, 0);
    },
  });
}

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
 * `pnpm check` 通过）；④ renderResult 支持 Ctrl+O（`app.tools.expand`）展开：
 * 折叠态显示答案摘要 + 展开快捷键提示，展开态还原完整问答（prompt + 所有选项
 * 含 description + ✓ 选中标记），复用问卷弹窗的排版风格。
 *
 * 2026-08-12 ⑤ 选项参数简化：每个选项只留 `label`（展示文本即返回值，无
 * 重复字段，且消除模型漏传必填字段的校验失败）；label 必填且 `minLength: 1`
 * 防空串；schema 严格化（`additionalProperties: false`），多余属性直接校验失败。
 *
 * 2026-08-14 ⑥ 单选/多选支持：每个问题新增 `mode`（"single" 默认 / "multiple"），
 * 多选下空格勾选/撤回、回车提交本题（与单选"回车即选即走"分离）。配套 `minSelect`/
 * `maxSelect`（仅 multiple 生效，single 静默忽略）。状态由 `Map<id, Answer>`
 * 改为 `Map<id, Answer[]>`，`Answer` 结构零改动、`QuestionnaireResult.answers`
 * 仍为扁平 `Answer[]`（同 id 多次出现即多选），故外部消费契约不变。allowOther
 * 在多选下：追加的自填值进入选项列表（带"☑ 自填："前缀，空格撤回=删除，禁止空
 * 自填、允许重复）；单选下仍为覆盖，自填值不入列表（选了即走）。
 *
 * 2026-08-18 ⑦ 单选自填值进入选项列表：单选模式下已选的自填值同样作为列表项
 * （"✓ 自填：xxx"，恒 ✓ 存在即已选）插在固定项与 allowOther 入口之间，回车=清除
 * 自填（回到未作答），"输入其他内容…"再次进入=覆盖旧值；单选固定项增加 ✓ 已选
 * 标记。修复多问题场景下单选自填/固定选项后切回本页看不到已选内容、误以为输入
 * 丢失的问题。renderResult 展开态同步渲染自填值列表项（顺序与弹窗 currentOptions
 * 一致，替换原 isOther 下方缩进展示）。
 *
 * 上游：/var/home/brightmeows/.local/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/questionnaire.ts
 */

import { keyHint, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
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
  label: string;
  description?: string;
}

type RenderOption = QuestionOption & {
  isOther?: boolean;
  isCustom?: boolean;
  customPos?: number;
};

type SelectionMode = "single" | "multiple";

interface Question {
  id: string;
  label: string;
  prompt: string;
  options: QuestionOption[];
  allowOther: boolean;
  mode: SelectionMode;
  minSelect?: number;
  maxSelect?: number;
}

interface Answer {
  id: string;
  label: string;
  wasCustom: boolean;
  index?: number;
}

interface QuestionnaireResult {
  questions: Question[];
  answers: Answer[];
  cancelled: boolean;
}

// Schema（三层均 additionalProperties: false 严格校验，多余属性直接失败）
const QuestionOptionSchema = Type.Object(
  {
    label: Type.String({
      minLength: 1,
      description: "选项的展示文本（用户看到的内容，选中后即作为返回值）",
    }),
    description: Type.Optional(Type.String({ description: "选项下方显示的补充说明（可选）" })),
  },
  { additionalProperties: false },
);

const QuestionModeSchema = Type.Union([Type.Literal("single"), Type.Literal("multiple")], {
  description:
    "选择模式：single=单选（默认，回车选中即跳下一题）；multiple=多选（空格勾选/取消、回车提交本题）",
});

const QuestionSchema = Type.Object(
  {
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
    mode: Type.Optional(QuestionModeSchema),
    minSelect: Type.Optional(
      Type.Integer({
        minimum: 0,
        description:
          "多选最少选择数（默认 1；设 0 表示可不选）。仅 multiple 模式生效，single 模式静默忽略",
      }),
    ),
    maxSelect: Type.Optional(
      Type.Integer({
        minimum: 1,
        description: "多选最多选择数（默认不限）。仅 multiple 模式生效，single 模式静默忽略",
      }),
    ),
  },
  { additionalProperties: false },
);

const QuestionnaireParams = Type.Object(
  {
    questions: Type.Array(QuestionSchema, { description: "要向用户提出的问题" }),
  },
  { additionalProperties: false },
);

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
      "向用户提出一个或多个问题。用于澄清需求、获取偏好或确认决策。单个问题显示为简单的选项列表；多个问题显示为带 tab 切换的界面。每个问题可设 mode：single（默认，单选，选中即跳）或 multiple（多选，空格勾选、回车提交本题）。建议：调用本工具前，先在对话正文里把各个选项的完整含义向用户解释清楚，让用户带着理解在界面里选择。",
    parameters: QuestionnaireParams,

    // eslint-disable-next-line max-params -- Pi execute 回调固定签名
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (ctx.mode !== "tui") {
        return errorResult("错误：UI 不可用（运行在非交互模式）");
      }
      if (params.questions.length === 0) {
        return errorResult("错误：未提供任何问题");
      }

      // Normalize questions with defaults（显式构造，规避 exactOptionalPropertyTypes）
      const questions: Question[] = params.questions.map((q, i) => ({
        id: q.id,
        label: q.label || `Q${i + 1}`,
        prompt: q.prompt,
        options: q.options,
        allowOther: q.allowOther !== false,
        mode: q.mode === "multiple" ? "multiple" : "single",
        ...(q.minSelect !== undefined && q.minSelect >= 0 ? { minSelect: q.minSelect } : {}),
        ...(q.maxSelect !== undefined && q.maxSelect >= 1 ? { maxSelect: q.maxSelect } : {}),
      }));

      const isMulti = questions.length > 1;
      const totalTabs = questions.length + 1; // Questions + Submit

      // eslint-disable-next-line max-params -- Pi ui.custom 回调固定签名
      const result = await ctx.ui.custom<QuestionnaireResult>((tui, theme, _kb, done) => {
        // State
        let currentTab = 0;
        let optionIndex = 0;
        let inputMode = false;
        let inputQuestionId: string | null = null;
        let inputError: string | null = null;
        let cachedLines: string[] | undefined;
        // 多选支持：一个 id 对应多个 Answer（单选长度恒 1）
        const answers = new Map<string, Answer[]>();

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
          // 扁平化：单选每题 1 个、多选每题 N 个，同 id 多次出现即多选
          done({ questions, answers: [...answers.values()].flat(), cancelled });
        }

        function currentQuestion(): Question | undefined {
          return questions[currentTab];
        }

        function currentOptions(): RenderOption[] {
          const q = currentQuestion();
          if (!q) {
            return [];
          }
          const opts: RenderOption[] = [...q.options];
          // 已追加的自填值作为列表项（多选空格撤回 / 单选回车清除），插在 allowOther 入口前
          const customs = getSelected(q.id).filter((a) => a.wasCustom);
          for (const [pos, c] of customs.entries()) {
            opts.push({ label: c.label, isCustom: true, customPos: pos });
          }
          if (q.allowOther) {
            opts.push({ label: "输入其他内容…", isOther: true });
          }
          return opts;
        }

        function getSelected(qId: string): Answer[] {
          return answers.get(qId) ?? [];
        }

        function effectiveMin(q: Question): number {
          return q.mode === "multiple" ? (q.minSelect ?? 1) : 1;
        }

        function effectiveMax(q: Question): number {
          return q.mode === "multiple" ? (q.maxSelect ?? Infinity) : 1;
        }

        function isSatisfied(q: Question): boolean {
          const n = getSelected(q.id).length;
          return n >= effectiveMin(q) && n <= effectiveMax(q);
        }

        function allAnswered(): boolean {
          return questions.every(isSatisfied);
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

        // 单选：覆盖式写入（数组长度 1）
        function setSingle(answer: Answer) {
          answers.set(answer.id, [answer]);
        }

        // 多选：追加一个值
        function appendMulti(answer: Answer) {
          const sel = getSelected(answer.id);
          sel.push(answer);
          answers.set(answer.id, sel);
        }

        // 多选：切换固定选项的勾选（optIndex 为 q.options 内下标）
        function toggleFixed(q: Question, optIndex: number) {
          const sel = getSelected(q.id);
          const idx = optIndex + 1;
          const pos = sel.findIndex((a) => !a.wasCustom && a.index === idx);
          if (pos !== -1) {
            sel.splice(pos, 1);
            answers.set(q.id, sel);
          } else {
            const max = effectiveMax(q);
            if (sel.length >= max) {
              return;
            } // 超上限，静默忽略
            const opt = q.options[optIndex];
            if (!opt) {
              return;
            }
            sel.push({ id: q.id, label: opt.label, wasCustom: false, index: idx });
            answers.set(q.id, sel);
          }
          refresh();
        }

        // 多选：删除第 pos 个自填值（customPos 为自填子序列内的位置）
        function removeCustom(q: Question, pos: number) {
          const sel = getSelected(q.id);
          let seen = 0;
          const filtered = sel.filter((a) => {
            if (a.wasCustom) {
              if (seen === pos) {
                seen++;
                return false;
              }
              seen++;
            }
            return true;
          });
          answers.set(q.id, filtered);
          // 选项列表重排后 optionIndex 可能越界，clamp 到合法范围
          const newLen = currentOptions().length;
          if (optionIndex >= newLen) {
            optionIndex = Math.max(0, newLen - 1);
          }
          refresh();
        }

        // Editor submit callback
        editor.onSubmit = (text) => {
          if (!inputQuestionId) {
            return;
          }
          const q = questions.find((x) => x.id === inputQuestionId);
          if (!q) {
            return;
          }
          const trimmed = text.trim();
          if (q.mode === "multiple") {
            // 多选：禁止空自填（避免垃圾值），留输入态提示
            if (!trimmed) {
              inputError = "请输入内容（留空不追加）";
              refresh();
              return;
            }
            // 追加后回到列表，可继续勾选/提交（不 advance）
            appendMulti({ id: inputQuestionId, label: trimmed, wasCustom: true });
            inputError = null;
            inputMode = false;
            inputQuestionId = null;
            editor.setText("");
            refresh();
          } else {
            setSingle({ id: inputQuestionId, label: trimmed || "（未作答）", wasCustom: true });
            inputError = null;
            inputMode = false;
            inputQuestionId = null;
            editor.setText("");
            advanceAfterAnswer();
          }
        };

        function handleInput(data: string) {
          // Input mode: route to editor
          if (inputMode) {
            if (matchesKey(data, Key.escape)) {
              inputMode = false;
              inputQuestionId = null;
              inputError = null;
              editor.setText("");
              refresh();
              return;
            }
            if (inputError) {
              inputError = null;
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

          // Option navigation（循环：首个按上跳末尾，末尾按下跳首个）
          if (matchesKey(data, Key.up)) {
            optionIndex = (optionIndex - 1 + opts.length) % opts.length;
            refresh();
            return;
          }
          if (matchesKey(data, Key.down)) {
            optionIndex = (optionIndex + 1) % opts.length;
            refresh();
            return;
          }

          // 空格：多选切换勾选（固定项 toggle / 自填值删除）；单选忽略
          if (matchesKey(data, Key.space) && q) {
            if (q.mode === "multiple") {
              const opt = opts[optionIndex];
              if (opt && !opt.isOther) {
                if (opt.isCustom && opt.customPos !== undefined) {
                  removeCustom(q, opt.customPos);
                } else {
                  toggleFixed(q, optionIndex);
                }
              }
            }
            return;
          }

          // Enter：选择 / 提交
          if (matchesKey(data, Key.enter) && q) {
            const opt = opts[optionIndex];
            if (!opt) {
              return;
            }
            if (opt.isOther) {
              // 单选/多选都进入输入态（多选追加、单选覆盖）
              inputMode = true;
              inputQuestionId = q.id;
              editor.setText("");
              refresh();
              return;
            }
            if (opt.isCustom) {
              if (q.mode === "single") {
                // 单选：自填值项回车 = 清除自填（回到未作答）
                removeCustom(q, opt.customPos ?? 0);
                return;
              }
              // 多选：自填值项回车 = 提交本题，落入下方 multiple 分支
            }
            if (q.mode === "multiple") {
              // 回车 = 提交本题（固定项已由空格勾选存入）
              if (isSatisfied(q)) {
                advanceAfterAnswer();
              } else {
                refresh(); // 触发未满足提示重绘
              }
              return;
            }
            // 单选：选中即跳
            setSingle({ id: q.id, label: opt.label, wasCustom: false, index: optionIndex + 1 });
            advanceAfterAnswer();
            return;
          }

          // Cancel
          if (matchesKey(data, Key.escape)) {
            submit(true);
          }
        }

        function render(width: number): string[] {
          if (cachedLines) {
            return cachedLines;
          }

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

          // 多选已选摘要（固定项 + 自填值），顿号分隔
          lines.push(theme.fg("accent", "─".repeat(renderWidth)));

          // Tab bar (multi-question only)
          if (isMulti) {
            const tabs: string[] = ["← "];
            for (const [i, tq] of questions.entries()) {
              const isActive = i === currentTab;
              const isAnswered = isSatisfied(tq);
              const lbl = tq.label;
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
            const sel = q ? getSelected(q.id) : [];
            for (const [i, opt] of opts.entries()) {
              const cursor = i === optionIndex;
              const isOther = opt.isOther === true;
              const isCustom = opt.isCustom === true;
              const prefix = cursor ? theme.fg("accent", "> ") : "  ";
              const num = `${i + 1}.`;
              if (isCustom && q) {
                // 自填值项：存在即已选。多选 ☑（空格撤回=删除）；单选 ✓（回车撤回=清除）
                const mark = q.mode === "multiple" ? "☑" : "✓";
                const color = cursor ? "accent" : "text";
                addWrappedWithPrefix(prefix, theme.fg(color, `${mark} 自填：${opt.label}`));
              } else if (q && q.mode === "multiple" && !isOther) {
                // 多选固定项：勾选框 ☑/☐
                const checked = sel.some((a) => !a.wasCustom && a.index === i + 1);
                const box = checked ? "☑" : "☐";
                const color = cursor ? "accent" : "text";
                addWrappedWithPrefix(prefix, theme.fg(color, `${box} ${num} ${opt.label}`));
              } else if (q && q.mode === "single" && !isOther) {
                // 单选固定项：已选 ✓ 标记
                const checked = sel.some((a) => !a.wasCustom && a.index === i + 1);
                const mark = checked ? theme.fg("success", "✓ ") : "";
                const label = `${mark}${num} ${opt.label}`;
                const color = cursor ? "accent" : "text";
                addWrappedWithPrefix(prefix, theme.fg(color, label));
              } else {
                // 输入其他内容…入口（输入态中光标行带 ✎ 提示）
                const label = `${num} ${opt.label}${inputMode ? " ✎" : ""}`;
                const color = cursor || inputMode ? "accent" : "text";
                addWrappedWithPrefix(prefix, theme.fg(color, label));
              }
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
            addWrappedWithPrefix(
              " ",
              theme.fg("muted", q.mode === "multiple" ? "你的回答（追加）：" : "你的回答："),
            );
            for (const line of editor.render(Math.max(1, renderWidth - 2))) {
              lines.push(` ${line}`);
            }
            lines.push("");
            addWrappedWithPrefix(
              " ",
              theme.fg(
                "dim",
                q.mode === "multiple" ? "回车追加 • Esc 取消" : "回车提交 • Esc 取消",
              ),
            );
            if (inputError) {
              addWrappedWithPrefix(" ", theme.fg("warning", inputError));
            }
          } else if (currentTab === questions.length) {
            addWrappedWithPrefix(" ", theme.fg("accent", theme.bold("准备提交")));
            lines.push("");
            for (const question of questions) {
              const sel = getSelected(question.id);
              if (sel.length > 0) {
                const parts = sel.map((a) => (a.wasCustom ? `（自填）${a.label}` : `${a.label}`));
                const summary = `${theme.fg("muted", `${question.label}: `)}${theme.fg("text", parts.join("、"))}`;
                addWrappedWithPrefix(" ", summary);
              }
            }
            lines.push("");
            if (allAnswered()) {
              addWrappedWithPrefix(" ", theme.fg("success", "按回车提交"));
            } else {
              const missing = questions
                .filter((qq) => !isSatisfied(qq))
                .map((qq) => {
                  const n = getSelected(qq.id).length;
                  if (n < effectiveMin(qq)) {
                    return `${qq.label}（至少选 ${effectiveMin(qq)}）`;
                  }
                  return `${qq.label}（至多选 ${effectiveMax(qq)}）`;
                })
                .join(", ");
              addWrappedWithPrefix(" ", theme.fg("warning", `未满足：${missing}`));
            }
          } else if (q) {
            addWrappedWithPrefix(" ", theme.fg("text", q.prompt));
            lines.push("");
            renderOptions();
          }

          lines.push("");
          if (!inputMode) {
            const curMode = q?.mode;
            let help: string;
            if (isMulti && curMode === "multiple") {
              help = "Tab/←→ 切换 • ↑↓ 移动 • 空格勾选/撤回 • 回车提交本题 • Esc 取消";
            } else if (isMulti) {
              help = "Tab/←→ 切换 • ↑↓ 选择 • 回车确认（自填可回车撤回）• Esc 取消";
            } else if (curMode === "multiple") {
              help = "↑↓ 移动 • 空格勾选/撤回 • 回车提交 • Esc 取消";
            } else {
              help = "↑↓ 选择 • 回车选中（自填可回车撤回）• Esc 取消";
            }
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

      // 返回文本：单选保持原格式，多选逗号分隔（自填项标“自填：”）
      const answerLines = questions.map((q) => {
        const qLabel = q.label;
        const sel = result.answers.filter((a) => a.id === q.id);
        if (q.mode === "single") {
          const [a] = sel;
          if (!a) {
            return `${qLabel}：（未作答）`;
          }
          if (a.wasCustom) {
            return `${qLabel}：用户自填：${a.label}`;
          }
          return `${qLabel}：用户选择：${a.index}. ${a.label}`;
        }
        if (sel.length === 0) {
          return `${qLabel}：（未作答）`;
        }
        const parts = sel.map((a) => (a.wasCustom ? `自填：${a.label}` : `${a.index}. ${a.label}`));
        return `${qLabel}：用户选择：${parts.join(", ")}`;
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

    // eslint-disable-next-line max-params -- Pi renderResult 固定签名
    renderResult(result, { expanded }, theme, _context) {
      const details = result.details as QuestionnaireResult | undefined;
      if (!details) {
        const [text] = result.content;
        return new Text(text?.type === "text" ? text.text : "", 0, 0);
      }
      if (details.cancelled) {
        let text = theme.fg("warning", "已取消");
        if (expanded && details.questions.length > 0) {
          text += `\n${theme.fg("muted", `问卷含 ${details.questions.length} 个问题（用户未提交）`)}`;
        }
        return new Text(text, 0, 0);
      }

      // 按 id 分组（多选同 id 多个 Answer）
      const groupBy = (id: string) => details.answers.filter((a) => a.id === id);

      // 折叠态：紧凑答案摘要 + 展开快捷键提示（多选逗号分隔）
      if (!expanded) {
        const lines = details.questions.map((q) => {
          const sel = groupBy(q.id);
          if (sel.length === 0) {
            return `${theme.fg("warning", "? ")}${theme.fg("accent", q.id)}：${theme.fg("muted", "（未作答）")}`;
          }
          const parts = sel.map((a) => {
            if (a.wasCustom) {
              return `${theme.fg("muted", "（自填）")}${a.label}`;
            }
            const display = a.index ? `${a.index}. ${a.label}` : a.label;
            return display;
          });
          return `${theme.fg("success", "✓ ")}${theme.fg("accent", q.id)}：${theme.fg("text", parts.join(theme.fg("muted", ", ")))}`;
        });
        lines.push(
          `${theme.fg("dim", "(")}${keyHint("app.tools.expand", "展开查看完整问卷")}${theme.fg("dim", ")")}`,
        );
        return new Text(lines.join("\n"), 0, 0);
      }

      // 展开态：还原完整问答，复用问卷弹窗排版（prompt + 编号选项 + description + ✓ 选中标记）
      // 选项顺序须与弹窗 currentOptions() 一致（allowOther 项追加在末尾），answer.index 才能正确匹配
      const blocks: string[] = [];
      for (const q of details.questions) {
        const sel = groupBy(q.id);
        const customs = sel.filter((a) => a.wasCustom);
        const lines: string[] = [
          theme.fg("accent", theme.bold(q.label)),
          theme.fg("text", q.prompt),
        ];

        const opts: RenderOption[] = [...q.options];
        // 自填值项插在 allowOther 前（顺序与弹窗 currentOptions 一致，保证 index 匹配）
        for (const [pos, c] of customs.entries()) {
          opts.push({ label: c.label, isCustom: true, customPos: pos });
        }
        if (q.allowOther) {
          opts.push({ label: "输入其他内容…", isOther: true });
        }
        for (const [i, opt] of opts.entries()) {
          const isOther = opt.isOther === true;
          // 自填值项恒 ✓；isOther 恒不标记（自填值项自身可见）
          let selected: boolean;
          if (opt.isCustom) {
            selected = true;
          } else if (isOther) {
            selected = false;
          } else {
            selected = sel.some((a) => !a.wasCustom && a.index === i + 1);
          }
          const mark = selected ? theme.fg("success", "✓") : theme.fg("dim", "·");
          const color = selected ? "text" : "muted";
          const label = opt.isCustom ? `自填：${opt.label}` : `${i + 1}. ${opt.label}`;
          lines.push(`  ${mark} ${theme.fg(color, label)}`);
          if (opt.description) {
            lines.push(`      ${theme.fg("dim", opt.description)}`);
          }
        }
        blocks.push(lines.join("\n"));
      }
      return new Text(blocks.join("\n\n"), 0, 0);
    },
  });
}

/**
 * Agent Browser Notice（better-skill 子模块）
 *
 * 在模型 read agent-browser 技能的 SKILL.md 后，于 tool_result 末尾追加
 * 两条技能专属提醒（2026-08-31 主人确认）：
 * - skills get 输出完整读取：agent-browser 的 SKILL.md 只是发现桩，真实
 *   工作流内容经 `agent-browser skills get <name>` 输出到终端；输出超 pi
 *   截断线（2000 行/50KB）时须转读截断提示中给出的落盘临时文件，禁止
 *   基于部分内容开工
 * - 默认 --headed：headless 特征（UA 含 HeadlessChrome、
 *   navigator.webdriver=true）会被风控站点识别拒绝（2026-08-31 实测飞书
 *   登录页拒发登录表单），故浏览器操作默认一律加 --headed，仅任务明确
 *   为无风控的抓取、截图时可省略
 *
 * 设计决策（2026-08-31 主人确认）：
 * - 匹配规则：basename 为 SKILL.md 且路径组件含 agent-browser，不锁绝对
 *   路径——技能目录受 npx skills 管理，重装或迁移后仍生效
 * - 专属硬编码不抽象：当前仅 agent-browser 一个目标；第二个技能出现同类
 *   需求时再提炼声明式机制，不预付抽象成本
 * - tool_result handler 为链式中间件（官方文档：每序 handler 看到前序
 *   修改后的最新结果），与 ref-hint/subskill-hint 的追加互不覆盖；本模块
 *   注册在两者之后，提醒落在 tool_result 末尾
 * - 异常安全：非匹配路径与读取失败（isError）静默返回，不影响 read 工具
 * - 用户提示：appendEntry 走包内 inject-notice.ts 的 renderInjectEntry
 *   （customType "skill-ext"，历史名保持不变），与 ref-hint/subskill-hint
 *   各自独立投递
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** 从 read 工具参数中安全提取路径 */
function extractPath(input: Record<string, unknown>): string | null {
  const p = input["path"];
  return typeof p === "string" && p.length > 0 ? p : null;
}

/** 提醒正文（追加进 tool_result 首段 text，进 LLM 上下文） */
const NOTICE = [
  "",
  "---",
  "**agent-browser 专项提醒（自动注入，须遵守）**：",
  "1. 本文件只是发现桩：后续运行 `agent-browser skills get <name>` 获取实际工作流内容时，终端输出必须完整读取；输出被截断（超过 2000 行或 50KB）时，改为完整读取截断提示中给出的落盘临时文件，禁止基于部分内容开工。",
  "2. 启动浏览器默认一律加 `--headed` 全局 flag（如 `agent-browser --headed open <url>`）：headless 特征（UA 含 HeadlessChrome、navigator.webdriver=true）会被风控站点识别拒绝；仅当任务明确为无风控的抓取、截图时才可省略。",
].join("\n");

export function registerAgentBrowserNotice(pi: ExtensionAPI) {
  pi.on("tool_result", async (event) => {
    if (event.toolName !== "read") {
      return;
    }

    const filePath = extractPath(event.input);
    if (!filePath) {
      return;
    }

    // 匹配：basename 为 SKILL.md 且路径组件含 agent-browser（兼容 / 与 \ 分隔符）
    const parts = filePath.split(/[\\/]/);
    if (parts.at(-1) !== "SKILL.md" || !parts.includes("agent-browser")) {
      return;
    }

    // 读取失败的 tool_result 不追加提醒
    if (event.isError) {
      return;
    }

    const first = event.content.at(0);
    if (!first || first.type !== "text") {
      return;
    }

    // TUI-only 用户提示（不进 LLM 上下文）；与 ref-hint/subskill-hint 各自独立投递
    pi.appendEntry("skill-ext", {
      notice: "[自动注入] agent-browser 提醒：skills get 全文读取 + 默认 --headed",
      lines: [
        "1. skills get 输出完整读取，截断时转读落盘临时文件",
        "2. 浏览器操作默认 --headed，仅明确无风控的抓取/截图可省略",
      ],
    });

    // 链式中间件：event.content 已含 ref-hint/subskill-hint 的追加，续接其后
    return {
      content: [{ type: "text" as const, text: first.text + NOTICE }, ...event.content.slice(1)],
    };
  });
}

import type { Plugin } from "@opencode-ai/plugin";

/**
 * RTK OpenCode 插件——重写命令以使用 rtk 节省 token。
 * 需求：rtk >= 0.23.0 于 PATH 中。
 *
 * 此为薄委托插件：所有重写逻辑存于 `rtk rewrite`，
 * 为单一真相来源（src/discover/registry.rs）。
 * 欲增或改重写规则，请编辑 Rust 注册表——非此文件。
 *
 * 参考官方示例：https://github.com/rtk-ai/rtk/blob/master/hooks/opencode/rtk.ts
 * 扩展：首轮注入 nortk 提示 + 连续调用提醒
 */

/** 连续 bash 调用计数（不含 nortk 前缀） */
let bashChainCount = 0;
let pendingRemind = false;

const REMIND_AFTER = 3;
const REMIND_TAG = "INJECTED_NORTK";
const REMIND_AGAIN_TAG = "INJECTED_NORTK_REMIND";

const bootstrap = `<${REMIND_TAG}>
终端输出默认自动简化（rtk rewrite）。如需原始输出，运行命令时加 \`nortk \` 前缀。
</${REMIND_TAG}>`;

const remindAgain = `<${REMIND_AGAIN_TAG}>
你已连续多次使用 bash 命令。若某条命令的输出需要原始格式（不加简化），
在前面加上 \`nortk \` 前缀即可跳过 rtk rewrite。
</${REMIND_AGAIN_TAG}>`;

export const RtkOpenCodePlugin: Plugin = async ({ $ }) => {
  try {
    await $`which rtk`.quiet();
  } catch {
    console.warn("[rtk] rtk binary not found in PATH — plugin disabled");
    return {};
  }

  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      if (!output.messages.length) {
        return;
      }

      const firstUser = output.messages.find((m) => m.info.role === "user");
      if (!firstUser?.parts.length) {
        return;
      }

      // 首轮注入 nortk 提示
      const hasBootstrap = firstUser.parts.some(
        (p) => p.type === "text" && p.text.includes(REMIND_TAG),
      );
      if (!hasBootstrap) {
        firstUser.parts.unshift({ type: "text", text: bootstrap } as never);
      }

      // 连续 3 次触发 → 额外提醒
      if (
        pendingRemind &&
        !firstUser.parts.some((p) => p.type === "text" && p.text.includes(REMIND_AGAIN_TAG))
      ) {
        firstUser.parts.unshift({ type: "text", text: remindAgain } as never);
        pendingRemind = false;
      }
    },

    "tool.execute.before": async (input, output) => {
      const tool = String(input?.tool ?? "").toLowerCase();
      if (tool !== "bash" && tool !== "shell") {
        bashChainCount = 0; // 非 bash 工具 → 重置连续计数
        return;
      }

      const args = output?.args;
      if (!args || typeof args !== "object") {
        return;
      }

      const { command } = args as Record<string, unknown>;
      if (typeof command !== "string" || !command) {
        return;
      }

      const NORTK_PREFIX = "nortk ";

      // Nortk 开头 → 移除前缀，跳过 rewrite，重置计数
      if (command.startsWith(NORTK_PREFIX)) {
        (args as Record<string, unknown>)["command"] = command.slice(NORTK_PREFIX.length);
        bashChainCount = 0;
        return;
      }

      try {
        const result = await $`rtk rewrite ${command}`.quiet().nothrow();
        const rewritten = String(result.stdout).trim();
        if (rewritten && rewritten !== command) {
          (args as Record<string, unknown>)["command"] = rewritten;
        }

        bashChainCount++;
        if (bashChainCount >= REMIND_AFTER) {
          pendingRemind = true;
        }
      } catch {
        // Rtk rewrite 失败——原样传递，不计入连续触发
      }
    },
  };
};

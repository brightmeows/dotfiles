import type { Plugin } from "@opencode-ai/plugin"

// RTK OpenCode 插件——重写命令以使用 rtk 节省 token。
// 需求：rtk >= 0.23.0 于 PATH 中。
//
// 此为薄委托插件：所有重写逻辑存于 `rtk rewrite`，
// 为单一真相来源（src/discover/registry.rs）。
// 欲增或改重写规则，请编辑 Rust 注册表——非此文件。

export const RtkOpenCodePlugin: Plugin = async ({ $ }) => {
  try {
    await $`which rtk`.quiet()
  } catch {
    console.warn("[rtk] 未找到 rtk 二进制于 PATH 中——插件停用")
    return {}
  }

  const bootstrap = `<INJECTED_NORTK>
终端输出默认自动简化（rtk rewrite）。如需原始输出，运行命令时加 \`nortk \` 前缀。
</INJECTED_NORTK>`

  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      if (!output.messages.length) return
      const firstUser = output.messages.find((m) => m.info.role === "user")
      if (!firstUser?.parts.length) return
      if (firstUser.parts.some((p) => p.type === "text" && p.text.includes("INJECTED_NORTK"))) return
      firstUser.parts.unshift({ type: "text", text: bootstrap } as never)
    },
    "tool.execute.before": async (input, output) => {
      const tool = String(input?.tool ?? "").toLowerCase()
      if (tool !== "bash" && tool !== "shell") return
      const args = output?.args
      if (!args || typeof args !== "object") return

      let command = (args as Record<string, unknown>).command
      if (typeof command !== "string" || !command) return

      const NORTK_PREFIX = "nortk "
      // nortk 开头 → 移除前缀，跳过 rewrite
      if (command.startsWith(NORTK_PREFIX)) {
        command = command.slice(NORTK_PREFIX.length)
        ;(args as Record<string, unknown>).command = command
        return
      }

      try {
        const result = await $`rtk rewrite ${command}`.quiet().nothrow()
        const rewritten = String(result.stdout).trim()
        if (rewritten && rewritten !== command) {
          ;(args as Record<string, unknown>).command = rewritten
        }
      } catch {
        // rtk rewrite 失败——原样传递
      }
    },
  }
}

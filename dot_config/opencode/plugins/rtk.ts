import type { Plugin } from "@opencode-ai/plugin"

// RTK OpenCode plugin — rewrites commands to use rtk for token savings.
// Requires: rtk >= 0.23.0 in PATH.
//
// This is a thin delegating plugin: all rewrite logic lives in `rtk rewrite`,
// which is the single source of truth (src/discover/registry.rs).
// To add or change rewrite rules, edit the Rust registry — not this file.

export const RtkOpenCodePlugin: Plugin = async ({ $ }) => {
  try {
    await $`which rtk`.quiet()
  } catch {
    console.warn("[rtk] rtk binary not found in PATH — plugin disabled")
    return {}
  }

  const bootstrap = `<INJECTED_OTK>
终端命令及输出默认被简化（rtk rewrite）。如需原始结果，在命令前加 \`otk \` 前缀即可。
</INJECTED_OTK>`

  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      if (!output.messages.length) return
      const firstUser = output.messages.find((m) => m.info.role === "user")
      if (!firstUser?.parts.length) return
      if (firstUser.parts.some((p) => p.type === "text" && p.text.includes("INJECTED_OTK"))) return
      firstUser.parts.unshift({ type: "text", text: bootstrap })
    },
    "tool.execute.before": async (input, output) => {
      const tool = String(input?.tool ?? "").toLowerCase()
      if (tool !== "bash" && tool !== "shell") return
      const args = output?.args
      if (!args || typeof args !== "object") return

      let command = (args as Record<string, unknown>).command
      if (typeof command !== "string" || !command) return

      const OTK_PREFIX = "otk "
      // otk 开头 → 移除前缀，跳过 rewrite
      if (command.startsWith(OTK_PREFIX)) {
        command = command.slice(OTK_PREFIX.length)
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
        // rtk rewrite failed — pass through unchanged
      }
    },
  }
}

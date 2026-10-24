/**
 * reconcile — mid-session lifecycle reconciliation for ask_user_question.
 *
 * Strips the tool from the active set when the run has no UI, so headless runs
 * never see it. Interactive activation is left to Pi: `model-only` tools are
 * activated when they are registered, and Pi 1.4 restores the branch's active
 * set on resume and `/tree`.
 *
 * The old force-add branch (`hasUI && !hasTool` → add) is gone. It could not
 * distinguish a tool Pi lost from one the user disabled with `--tools`/`-xt`
 * or a toolset-manager extension, so it overrode explicit configuration on
 * every turn (upstream #149). The in-handler guards in `ask-user-question.ts`
 * (`!hasUI`, the `custom()`-undefined backstop, `no_custom_ui`) remain as
 * one-turn backstops if the host cannot render the dialog.
 *
 * RPC hosts (`ctx.mode === "rpc"`) keep the tool: since PR #100 it renders
 * there through the select/input dialog walker (`rpc-fallback.ts`), so
 * `hasUI` is the honest signal.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ASK_USER_QUESTION_TOOL_NAME } from "./ask-user-question.ts";

/**
 * Strip `ask_user_question` from the active set when there is no UI. Idempotent:
 * when the tool is already absent, the active set (and sibling tools) is left
 * untouched.
 */
export function reconcileAskUserQuestionTool(pi: ExtensionAPI, ctx: ExtensionContext): void {
  if (ctx.hasUI) return;
  const active = pi.getActiveTools();
  if (!active.includes(ASK_USER_QUESTION_TOOL_NAME)) return;
  pi.setActiveTools(active.filter((name) => name !== ASK_USER_QUESTION_TOOL_NAME));
}

/**
 * Attach the reconciler to `before_agent_start` so the active set is fixed up
 * before each turn's tool-list snapshot is read. Safe to call once at load.
 */
export function registerAskUserQuestionReconciler(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (_event, ctx) => reconcileAskUserQuestionTool(pi, ctx));
}

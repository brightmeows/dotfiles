/**
 * pi-meow-ask-user-question — vendored from
 * `@juicesharp/rpiv-ask-user-question@2.15.0` (MIT, juicesharp/rpiv-mono),
 * maintained frozen as local source.
 *
 * Local changes vs upstream 2.15.0:
 * - Question-count limit removed: `MAX_QUESTIONS` constant, `maxItems` and
 *   the "1-4 questions" schema copy, the `too_many_questions` runtime guard
 *   and error code, and the "up to N questions" prompt copy are all gone.
 * - `@juicesharp/rpiv-config` dependency inlined at `internal/rpiv-config.ts`,
 *   trimmed to the config-load + guidance-validation surface used here.
 * - TabBar windows the question tabs around the active tab when they overflow
 *   (Submit stays pinned), and the reconciler strips the tool in headless runs
 *   only instead of re-adding it over `--tools`/`-xt` (upstream #149).
 * - Tool guidance states the header and label hard limits (upstream #309).
 * - Check marks use U+2713 (`✓`) instead of U+2714 (`✔`): U+2714 is absent from
 *   ComicShannsMono Nerd Font and fontconfig falls back to Noto Color Emoji, whose
 *   non-scalable bitmap glyph kitty renders blank; U+2713 resolves to a scalable
 *   fallback (JetBrainsMono NF here) and still takes the accent color.
 * - `node:test` suites cover validation, normalization, envelopes, TabBar and
 *   reconciliation; run `pnpm test` from the repo root.
 *
 * Upstream summary: Pi extension registering the `ask_user_question` tool
 * — a structured option selector with an automatically appended
 * `Type something.` custom-answer row.
 *
 * Sentinel labels and TUI chrome strings localize at render time via the i18n
 * bridge. Strings are registered with rpiv-i18n here, once, at module init —
 * but only when the SDK is actually installed. If `@juicesharp/rpiv-i18n` is
 * missing (standalone install of just this package), the dynamic-load shim
 * no-ops and the bridge's `t(key, fallback)` returns the inline English literal
 * at every call site. The extension stays online either way.
 *
 * Adding a locale: drop `locales/<code>.json` next to en.json (mirroring the
 * key set). No edit needed here — `registerLocalesFromDir` iterates
 * `SUPPORTED_LOCALES` from the SDK. See `@juicesharp/rpiv-i18n` README →
 * "Contributing translations" for the full convention.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerAskUserQuestionTool } from "./ask-user-question.ts";
import { registerAskUserQuestionReconciler } from "./reconcile.ts";
import { I18N_NAMESPACE } from "./state/i18n-bridge.ts";

type I18nLoader = {
  registerLocalesFromDir: (
    namespace: string,
    packageUrl: string,
    options?: { label?: string },
  ) => void;
};

// Dynamic import keeps `@juicesharp/rpiv-i18n` a soft optional peer: when the
// SDK is installed alongside this package the strings register and
// `/languages` flips them live; when it isn't, the import rejects here, we
// no-op, and the bridge's English-fallback shim keeps the extension online.
//
// The `/loader` subpath is used instead of the SDK entry so the i18n-ui +
// pi-tui modules are not pulled into our load graph just to register strings.
// Variable specifier keeps this a true dynamic import: `@juicesharp/rpiv-i18n` is
// an optional peer that may be absent at compile time (frozen local source), so
// the module is resolved only at runtime and typed via the cast below.
const loaderSpec = "@juicesharp/rpiv-i18n/loader";
try {
  const sdk = (await import(loaderSpec)) as I18nLoader;
  sdk.registerLocalesFromDir(I18N_NAMESPACE, import.meta.url, { label: "rpiv-ask-user-question" });
} catch {
  // SDK absent — extension still loads with English-only UI.
}

export {
  ASK_USER_ANSWER_EVENT,
  ASK_USER_ANSWER_RESULT_EVENT,
  ASK_USER_BLOCKED_EVENT,
  ASK_USER_PROMPT_EVENT,
  type AskUserAnswerEntry,
  type AskUserAnswerEventPayload,
  type AskUserAnswerRejectCode,
  type AskUserAnswerResultEventPayload,
  type AskUserBlockedEventPayload,
  type AskUserPromptEventPayload,
  type AskUserPromptOption,
  type AskUserPromptQuestion,
} from "./events.ts";

export default function (pi: ExtensionAPI) {
  registerAskUserQuestionTool(pi);
  registerAskUserQuestionReconciler(pi);
}

/**
 * Vendored from `@juicesharp/rpiv-config@2.15.0` (MIT, juicesharp/rpiv-mono),
 * trimmed to the surface this package uses: XDG-aware JSON config loading with
 * legacy-path fallback, and guidance-field validation. Save / model-key /
 * env-var / TypeBox-schema utilities unused here were dropped (see upstream
 * for the full module). Stateless — no module-level singletons, no caches,
 * no side effects.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { Type } from "typebox";

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/**
 * Expand a leading `~` to the user's home directory. Mirrors Pi's
 * `expandTildePath`. Uses `join` (not string concatenation) so the path
 * separator is correct on every platform.
 *
 * Contract: only bare `~` and `~/…` expand. A `~user` form is returned
 * unchanged (the XDG spec defines no `~user` expansion), so it fails the
 * downstream `isAbsolute` check and routes to the default config dir.
 */
function expandTilde(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

/** Default config directory: `~/.config`. Single source of the `.config` literal. */
function defaultConfigDir(): string {
  return join(homedir(), ".config");
}

/**
 * Read an environment variable, trimmed; `undefined` when unset or empty
 * after trimming.
 */
function readEnvVar(key: string): string | undefined {
  return process.env[key]?.trim() || undefined;
}

/**
 * Resolve the config directory honoring `XDG_CONFIG_HOME`.
 *
 * Boundary: `XDG_CONFIG_HOME` governs this package's config layer only.
 * Pi-native paths (`~/.pi/…`, driven by `PI_CODING_AGENT_DIR`) are a separate,
 * orthogonal concern and are intentionally NOT unified here.
 *
 * XDG spec compliance:
 *   - unset / empty-after-trim / whitespace-only → default (`~/.config`)
 *   - relative path → default (XDG mandates absolute)
 *   - `"~"` or `"~/…"` → expand the tilde, then require absolute
 *   - `"~user…"` → NOT expanded (XDG defines no `~user` form); silently
 *     routes to the default like any other relative path
 *   - absolute → used verbatim
 */
function resolveConfigDir(): string {
  const xdg = readEnvVar("XDG_CONFIG_HOME");
  if (!xdg) return defaultConfigDir();
  const expanded = expandTilde(xdg);
  return isAbsolute(expanded) ? expanded : defaultConfigDir();
}

/**
 * Always-legacy config path under `~/.config`. Used by the legacy-fallback
 * reader so a pre-XDG config file is still discovered after an operator sets
 * `XDG_CONFIG_HOME`. Ignores `XDG_CONFIG_HOME` by design.
 */
function legacyConfigPath(name: string, file: string = "config.json"): string {
  return join(defaultConfigDir(), name, file);
}

/**
 * Resolve a config file path under the XDG-aware config directory.
 *
 * `<resolveConfigDir()>/<name>/<file>` — defaults to `~/.config/<name>/config.json`
 * when `XDG_CONFIG_HOME` is unset / empty / whitespace / relative.
 *
 * @param name — package directory name (e.g. "rpiv-ask-user-question")
 * @param file — config filename (defaults to "config.json")
 * @returns absolute path to the config file
 */
export function configPath(name: string, file: string = "config.json"): string {
  return join(resolveConfigDir(), name, file);
}

// ---------------------------------------------------------------------------
// JSON config load
// ---------------------------------------------------------------------------

/**
 * Load and parse a JSON config file.
 *
 * Returns `{}` for missing files, malformed JSON, or non-plain-object values.
 * The typeof guard fixes a latent bug where valid non-object JSON
 * (e.g. `"hello"`, `42`, `null`) passes through the cast. Arrays are also
 * rejected — `typeof [] === "object"` in JavaScript, but config files are
 * always plain objects.
 */
export function loadJsonConfig<T>(path: string): T {
  if (!existsSync(path)) return {} as T;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {} as T;
    return parsed as T;
  } catch (err) {
    // Diagnostic for malformed-JSON path. Silent load otherwise produces an
    // indistinguishable symptom ("never configured" vs "config unreadable") —
    // warning is owner-only since the file lives in the user's HOME.
    console.warn(
      `rpiv-config: invalid JSON at ${path}, using default ({}) — ${(err as Error).message}`,
    );
    return {} as T;
  }
}

/**
 * Load a JSON config, preferring the XDG-resolved path and falling back to the
 * legacy `~/.config/<name>/<file>` location only when the XDG path is missing.
 *
 * - XDG file present (valid or malformed) → its parse result wins. A malformed
 *   XDG file warns and returns `{}` but does NOT silently fall back to legacy —
 *   corruption is surfaced, not masked.
 * - XDG file missing → read the legacy path (which returns `{}` if also missing,
 *   or warns + `{}` if malformed).
 * - Both missing → `{}`.
 *
 * @param name — package directory name (e.g. "rpiv-ask-user-question")
 * @param file — config filename (defaults to "config.json")
 */
export function loadJsonConfigWithLegacyFallback<T>(name: string, file: string = "config.json"): T {
  const xdgPath = configPath(name, file);
  if (existsSync(xdgPath)) {
    return loadJsonConfig<T>(xdgPath);
  }
  return loadJsonConfig<T>(legacyConfigPath(name, file));
}

// ---------------------------------------------------------------------------
// GuidanceFields
// ---------------------------------------------------------------------------

export interface GuidanceFields {
  promptSnippet?: string;
  promptGuidelines?: string[];
  description?: string;
}

// TypeBox form of GuidanceFields. Mirrors the interface 1:1 — same fields,
// same optionality. `additionalProperties: true` lets consumers compose
// wrappers that may carry sibling-specific keys without those leaking back
// into the config. The runtime invariants (string fields must be non-empty,
// the array field must be non-empty and contain only non-empty strings) are
// still enforced by `validateGuidanceFields`; the schema is a structural
// type-narrowing aid for callers that bake guidance into a larger
// TypeBox-validated config object.
export const GuidanceFieldsSchema = Type.Object(
  {
    promptSnippet: Type.Optional(Type.String()),
    promptGuidelines: Type.Optional(Type.Array(Type.String())),
    description: Type.Optional(Type.String()),
  },
  { additionalProperties: true },
);

/**
 * Validate and extract guidance fields from an unknown value.
 *
 * Returns a clean `GuidanceFields` object with only valid entries.
 */
export function validateGuidanceFields(fields: unknown): GuidanceFields {
  if (!fields || typeof fields !== "object") return {};
  const g = fields as Record<string, unknown>;
  const result: GuidanceFields = {};
  if (typeof g["promptSnippet"] === "string" && g["promptSnippet"].length > 0) {
    result.promptSnippet = g["promptSnippet"];
  }
  if (
    Array.isArray(g["promptGuidelines"]) &&
    g["promptGuidelines"].length > 0 &&
    g["promptGuidelines"].every((s) => typeof s === "string" && s.length > 0)
  ) {
    result.promptGuidelines = g["promptGuidelines"];
  }
  if (typeof g["description"] === "string" && g["description"].length > 0) {
    result.description = g["description"];
  }
  return result;
}

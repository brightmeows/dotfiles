/** 路径、标记与插件配置解析。 */

import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface PluginConfig {
  resolvedPath?: string;
  cachePath?: string;
  refreshIntervalMs?: number;
  firstWriteDelayMs?: number;
}

export interface ResolvedPluginConfig {
  dshHome: string;
  resolvedPath: string;
  cachePath: string;
  refreshIntervalMs: number;
  firstWriteDelayMs: number;
}

/** Models.dev 缓存有效期（与 Pi 扩展的 24 小时节奏一致）。 */
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Profile patch 里的生成块标记。 */
export const MARKER_START = "# >>> models-dev 生成块（勿手改）";
export const MARKER_END = "# <<< models-dev 生成块结束";

/** 解析 dsh 配置根：显式 DSH_HOME 优先，否则 ~/.dsh。 */
export function dshHome(): string {
  const fromEnv = process.env["DSH_HOME"]?.trim();
  return fromEnv ? resolve(fromEnv) : join(homedir(), ".dsh");
}

export function resolveConfig(config: PluginConfig | undefined): ResolvedPluginConfig {
  const home = dshHome();
  return {
    dshHome: home,
    resolvedPath:
      config?.resolvedPath ?? join(homedir(), ".agents_meow", "models", "resolved.json"),
    cachePath: config?.cachePath ?? join(home, "cache", "models-dev.json"),
    refreshIntervalMs: config?.refreshIntervalMs ?? CACHE_TTL_MS,
    firstWriteDelayMs: config?.firstWriteDelayMs ?? 5000,
  };
}

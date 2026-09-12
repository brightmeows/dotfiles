/** Dsh 模型域插件：抓取 models.dev、叠加用户配置、写入各 profile 的 patch 生成块。
 *
 * 触发：启动先写（缓存数据）、就绪后确认重写、24 小时周期、resolved.json 变更、
 * 手动 `/models-refresh` 命令。失败保留既有生成块并记日志。
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unwatchFile,
  watchFile,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { CACHE_TTL_MS, resolveConfig, type PluginConfig } from "./config.mts";
import { buildRoutes, renderManagedBlock, validateRoutes } from "./mapping.mts";
import { writeManagedBlock } from "./patch-writer.mts";
import type { MappingStats, ModelsDevData, ResolvedConfig } from "./types.mts";

export const name = "models-dev";

/** Models.dev 目录地址（与 Pi 扩展同一上游）。 */
export const MODELS_DEV_URL = "https://models.dev/api.json";

interface LoggerLike {
  info: (message: string) => void;
  warn: (message: string) => void;
}

type Disposer = () => void;

interface CommandDefinitionLike {
  name: string;
  description: string;
  handler: () => Promise<{ kind: "success" | "error"; text?: string }>;
}

interface CommandsLike {
  register?: (definition: CommandDefinitionLike) => Disposer;
}

interface ContextLike {
  effect?: (callback: () => Disposer | void) => Disposer;
  get?: (name: string) => unknown;
}

interface CacheFile {
  fetchedAt: number;
  data: ModelsDevData;
}

function readCache(path: string, log: LoggerLike): CacheFile | undefined {
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<CacheFile>;
    if (
      typeof parsed.fetchedAt === "number" &&
      typeof parsed.data === "object" &&
      parsed.data !== null
    ) {
      return { fetchedAt: parsed.fetchedAt, data: parsed.data };
    }
    log.warn(`[models-dev] 缓存格式无法识别，忽略：${path}`);
  } catch (error) {
    log.warn(
      `[models-dev] 缓存解析失败，忽略：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return undefined;
}

async function fetchModelsDev(path: string, log: LoggerLike): Promise<ModelsDevData | undefined> {
  try {
    const response = await fetch(MODELS_DEV_URL, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      log.warn(`[models-dev] 拉取失败：HTTP ${response.status}`);
      return undefined;
    }
    const data = (await response.json()) as ModelsDevData;
    if (typeof data !== "object" || data === null) {
      log.warn("[models-dev] 拉取结果不是对象，忽略");
      return undefined;
    }
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify({ fetchedAt: Date.now(), data }), "utf8");
    renameSync(tmp, path);
    log.info(`[models-dev] 已更新缓存：${Object.keys(data).length} 个 provider`);
    return data;
  } catch (error) {
    log.warn(`[models-dev] 拉取失败：${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

function readResolved(path: string, log: LoggerLike): ResolvedConfig {
  if (!existsSync(path)) {
    return {};
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as ResolvedConfig;
    if (typeof parsed === "object" && parsed !== null) {
      return parsed;
    }
    log.warn(`[models-dev] resolved.json 不是对象，按空配置处理：${path}`);
  } catch (error) {
    log.warn(
      `[models-dev] resolved.json 解析失败，按空配置处理：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return {};
}

function listProfilePatches(home: string): string[] {
  const profilesDir = join(home, "profiles");
  if (!existsSync(profilesDir)) {
    return [];
  }
  const out: string[] = [];
  for (const entry of readdirSync(profilesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "node_modules") {
      continue;
    }
    const patch = join(profilesDir, entry.name, "cordis.patch.yml");
    if (existsSync(patch)) {
      out.push(patch);
    }
  }
  return out.toSorted();
}

export function apply(ctx: ContextLike, config?: PluginConfig): void {
  const cfg = resolveConfig(config);
  // Dsh 默认组合未装载日志 exporter，ctx.logger 的记录无处输出；诊断直接走 console。
  const log: LoggerLike = {
    info: (message) => console.log(message),
    warn: (message) => console.error(message),
  };
  let running = false;

  const refresh = async (
    reason: string,
    forceFetch: boolean,
  ): Promise<MappingStats | undefined> => {
    if (running) {
      return undefined;
    }
    running = true;
    try {
      let cache = readCache(cfg.cachePath, log);
      if (forceFetch || cache === undefined) {
        const fetched = await fetchModelsDev(cfg.cachePath, log);
        if (fetched !== undefined) {
          cache = { fetchedAt: Date.now(), data: fetched };
        }
      } else if (Date.now() - cache.fetchedAt > CACHE_TTL_MS) {
        void fetchModelsDev(cfg.cachePath, log);
      }
      if (cache === undefined) {
        log.warn(`[models-dev] ${reason}：无可用 models.dev 数据（缓存缺失且拉取失败）`);
        return undefined;
      }
      const resolved = readResolved(cfg.resolvedPath, log);
      const { routes, stats } = buildRoutes({ modelsDev: cache.data, resolved, env: process.env });
      const problems = validateRoutes(routes);
      if (problems.length > 0) {
        log.warn(
          `[models-dev] ${reason}：生成结果未通过本地校验，保留旧生成块：${problems.slice(0, 5).join("；")}`,
        );
        return undefined;
      }
      const result = writeManagedBlock(listProfilePatches(cfg.dshHome), renderManagedBlock(routes));
      log.info(
        `[models-dev] ${reason}：${stats.providers} 个 provider、${stats.models} 个模型；` +
          `写入 ${result.written.length} 个 profile patch，未变 ${result.unchanged.length} 个`,
      );
      if (stats.skippedProviders.length > 0) {
        log.warn(
          `[models-dev] 跳过 ${stats.skippedProviders.length} 个 provider：${stats.skippedProviders.slice(0, 8).join("、")}`,
        );
      }
      if (stats.skippedModels.length > 0) {
        log.warn(
          `[models-dev] 跳过 ${stats.skippedModels.length} 个模型条目：${stats.skippedModels.slice(0, 6).join("、")}`,
        );
      }
      if (stats.droppedLimits > 0) {
        log.info(
          `[models-dev] 丢弃 ${stats.droppedLimits} 个非正限额（context 或 maxTokens 为 0，dsh 回落默认）`,
        );
      }
      if (stats.shadowed.length > 0) {
        log.info(
          `[models-dev] 本地定义覆盖目录 provider：${stats.shadowed.slice(0, 6).join("、")}`,
        );
      }
      return stats;
    } catch (error) {
      log.warn(
        `[models-dev] ${reason} 失败：${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    } finally {
      running = false;
    }
  };

  void refresh("启动", false);
  const delay = setTimeout(() => {
    void refresh("就绪确认", false);
  }, cfg.firstWriteDelayMs);
  const interval = setInterval(() => {
    void refresh("周期刷新", true);
  }, cfg.refreshIntervalMs);
  watchFile(cfg.resolvedPath, { interval: 3000 }, () => {
    void refresh("配置变更", false);
  });

  const commands = ctx.get?.("commands") as CommandsLike | undefined;
  const unregister = commands?.register?.({
    name: "models-refresh",
    description: "刷新 models.dev 目录并重写模型配置",
    handler: async () => {
      await refresh("手动刷新", true);
      return { kind: "success", text: "models.dev 目录已刷新，模型配置已重写" };
    },
  });

  const dispose = (): void => {
    clearTimeout(delay);
    clearInterval(interval);
    unwatchFile(cfg.resolvedPath);
    unregister?.();
  };
  if (typeof ctx.effect === "function") {
    ctx.effect(() => dispose);
  }
}

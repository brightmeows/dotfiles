#!/usr/bin/env node
/** 干跑 CLI：check（映射统计与跳过报告）与 render（打印 patch 生成块）。
 *
 * 用法：
 *   node cli.mts check  [--models-dev <缓存路径>] [--resolved <resolved.json 路径>]
 *   node cli.mts render [--models-dev <缓存路径>] [--resolved <resolved.json 路径>]
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveConfig } from "./config.mts";
import { buildRoutes, renderManagedBlock, validateRoutes } from "./mapping.mts";
import { writeManagedBlock } from "./patch-writer.mts";
import type { ModelsDevData, ResolvedConfig } from "./types.mts";

function parseArgs(argv: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined || !token.startsWith("--")) {
      continue;
    }
    const value = argv[index + 1];
    if (value !== undefined && !value.startsWith("--")) {
      out.set(token.slice(2), value);
      index += 1;
    }
  }
  return out;
}

function loadJson(path: string, what: string): unknown {
  if (!existsSync(path)) {
    console.error(`缺少${what}：${path}`);
    process.exit(1);
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    console.error(`${what}解析失败：${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

const defaults = resolveConfig({});
const args = parseArgs(process.argv.slice(3));
const cachePath = args.get("models-dev") ?? defaults.cachePath;
const resolvedPath = args.get("resolved") ?? defaults.resolvedPath;

const cache = loadJson(cachePath, "models.dev 缓存") as { data?: ModelsDevData };
const modelsDev = cache.data ?? (cache as ModelsDevData);
const resolved = existsSync(resolvedPath)
  ? (loadJson(resolvedPath, "resolved.json") as ResolvedConfig)
  : ({} as ResolvedConfig);
const { routes, stats } = buildRoutes({ modelsDev, resolved, env: process.env });

switch (process.argv[2]) {
  case "render": {
    process.stdout.write(renderManagedBlock(routes));
    break;
  }
  case "write": {
    const patches: string[] = [];
    const explicit = args.get("patch");
    if (explicit !== undefined) {
      patches.push(explicit);
    } else {
      const profilesDir = join(defaults.dshHome, "profiles");
      if (existsSync(profilesDir)) {
        for (const entry of readdirSync(profilesDir, { withFileTypes: true })) {
          if (!entry.isDirectory() || entry.name === "node_modules") {
            continue;
          }
          const patch = join(profilesDir, entry.name, "cordis.patch.yml");
          if (existsSync(patch)) {
            patches.push(patch);
          }
        }
      }
    }
    const result = writeManagedBlock(patches, renderManagedBlock(routes));
    console.log(
      `写入 ${result.written.length} 个 profile patch，未变 ${result.unchanged.length} 个`,
    );
    break;
  }
  case "check": {
    const definitions = Object.values(resolved.providers ?? {}).filter(
      (entry) => entry.kind === "definition",
    );
    const problems = validateRoutes(routes);
    console.log(`provider 路由：${stats.providers}`);
    console.log(`模型条目：${stats.models}`);
    console.log(`禁用 provider：${(resolved.disabled_providers ?? []).length}`);
    console.log(`定义类 provider：${definitions.length}`);
    console.log(`丢弃非正限额：${stats.droppedLimits}`);
    console.log(
      `跳过 provider：${stats.skippedProviders.length}${stats.skippedProviders.length > 0 ? `（${stats.skippedProviders.slice(0, 10).join("、")}）` : ""}`,
    );
    console.log(
      `跳过模型条目：${stats.skippedModels.length}${stats.skippedModels.length > 0 ? `（${stats.skippedModels.slice(0, 6).join("、")}）` : ""}`,
    );
    console.log(
      `本地定义遮蔽目录：${stats.shadowed.length}${stats.shadowed.length > 0 ? `（${stats.shadowed.slice(0, 6).join("、")}）` : ""}`,
    );
    console.log(
      `本地校验问题：${problems.length}${problems.length > 0 ? `（${problems.slice(0, 5).join("；")}）` : ""}`,
    );
    break;
  }
  default: {
    console.error(
      "用法：node cli.mts check|render|write [--models-dev <路径>] [--resolved <路径>] [--patch <profile patch 路径>]",
    );
    process.exitCode = 2;
  }
}

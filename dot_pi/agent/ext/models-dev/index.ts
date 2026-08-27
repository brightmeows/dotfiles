/**
 * 模型目录导入域扩展合并入口（models-dev）
 *
 * Pi 扩展发现只支持一层子目录 + 单一入口（index.ts），本目录收纳 models.dev
 * provider 注册表导入：
 * - registry.ts：拉取与缓存（models.dev/api.json，24h TTL）
 * - mapping.ts：协议判定（npm→api 映射 + 模型层 shape/api 覆盖）与模型映射
 * - thinking.ts：思考挡位映射（pi 层级含 max）
 *
 * 目录组织（2026-08-27 拆包）：由 tools/ 拆出独立成域并做协议感知改造；
 * 本文件为编排入口（async factory，入口 await 保证顺序）。
 */

import type { ExtensionAPI, ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { fetchWithCache, type RawModel } from "./registry.ts";
import { mapModel, resolveProviderApi } from "./mapping.ts";

export default async function (pi: ExtensionAPI) {
  const registry = await fetchWithCache();
  if (!registry) {
    return;
  }

  const registeredNames: string[] = [];
  for (const [pid, provider] of Object.entries(registry)) {
    // 协议判定：未知 npm / 兼容系缺端点 → 跳过
    const resolved = resolveProviderApi(provider);
    if (!resolved) {
      continue;
    }

    if (!provider.models) {
      continue;
    }
    const rawList = Object.values(provider.models).filter((m): m is RawModel => Boolean(m.id));
    if (rawList.length === 0) {
      continue;
    }

    const models = rawList
      .map((m) => mapModel(m, resolved))
      .filter((m): m is ProviderModelConfig => m !== null);
    if (models.length === 0) {
      continue;
    }

    // ── 环境变量守卫：所有声明的 env var 必须存在且非空 ──
    const envVars = provider.env ?? [];
    const missing = envVars.filter((e) => !process.env[e]);
    if (missing.length > 0) {
      continue;
    }

    const envKey = provider.env?.[0];
    const apiKeyLiteral = envKey ? process.env[envKey] || undefined : undefined;
    pi.registerProvider(pid, {
      name: provider.name ?? pid,
      ...(resolved.baseUrl ? { baseUrl: resolved.baseUrl } : {}),
      ...(apiKeyLiteral ? { apiKey: apiKeyLiteral } : {}),
      api: resolved.api,
      models,
    });
    registeredNames.push(provider.name ?? pid);
  }

  // ── 启动后发一条汇总提示 ──
  if (registeredNames.length > 0) {
    pi.on("session_start", async (event, ctx) => {
      if (event.reason === "startup") {
        ctx.ui.notify(
          `已注册 ${registeredNames.length} 个 models.dev 提供商：${registeredNames.join(", ")}`,
          "info",
        );
      }
    });
  }
}

/**
 * 原生 Provider 构建（M2-hybrid，2026-10-03）
 *
 * pi 1.0 的原生注册是顶层替换：composeProvider 取 nativeExtensionProviders ??
 * builtins，注册原生 provider 会顶掉同名内建（含内建 OAuth 登录与内建目录）。
 * 故只有与内建不重名的 provider 走原生，重名者仍走 legacy registerProvider
 * 路径（与内建 base 合成）；分流见 index.ts。
 *
 * - createProvider + envApiKeyAuth：认证接入 pi 的 auth 流程（存储凭据优先，
 *   否则声明 env；可 /login），可用性与离线过滤由平台统一处理
 * - getApiProvider：复用内建 API 适配器（协议判定结果不变）
 * - fetchModels：接入 pi 刷新生命周期（创建即恢复 + interactive/RPC 后台
 *   网络阶段）；返回值由平台写 ModelsStore（models-store.json）并做离线
 *   恢复，扩展侧不再自持久化映射结果（原始注册表缓存仍由 registry.ts
 *   持有，只作 TTL 门控）
 *
 * 纯工厂模块：不读环境、不注册；编排与配置读取归 index.ts。
 */

import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import {
  createProvider,
  envApiKeyAuth,
  type Api,
  type Model,
  type Provider,
  type ProviderStreams,
  type RefreshModelsContext,
} from "@earendil-works/pi-ai";
// 核心入口不导出 API 注册表访问器，compat 是包含核心的超集（coding-agent 同款用法）
import { getApiProvider } from "@earendil-works/pi-ai/compat";

/** 将 mapModel 输出（chat 形状的 ProviderModelConfig）转换为 pi-ai 原生 Model */
function toNativeModel(providerId: string, config: ProviderModelConfig): Model<Api> {
  // ProviderModelConfig 是 chat/image/classifier 判别联合，此处按 chat 收窄并补 provider
  return { ...config, type: "chat", provider: providerId } as Model<Api>;
}

/**
 * 构建原生 Provider；返回 null 表示协议无可用 API 实现，调用方回退 legacy。
 * fetchModels 返回 legacy 形状的模型配置，本模块转成原生 Model；空列表
 * 回退注册时基线（拉取失败等场景由调用方先行兜底）。
 */
export function buildNativeProvider(args: {
  id: string;
  name: string;
  baseUrl: string | null;
  envVars: readonly string[];
  models: readonly ProviderModelConfig[];
  fetchModels: (context: RefreshModelsContext) => Promise<readonly ProviderModelConfig[]>;
}): Provider | null {
  const baseline = args.models.map((config) => toNativeModel(args.id, config));
  const apiMap: Partial<Record<Api, ProviderStreams>> = {};
  for (const model of baseline) {
    const streams = getApiProvider(model.api);
    if (!streams) {
      return null;
    }
    apiMap[model.api] = streams;
  }
  return createProvider({
    id: args.id,
    name: args.name,
    ...(args.baseUrl ? { baseUrl: args.baseUrl } : {}),
    auth: { apiKey: envApiKeyAuth(args.name, args.envVars) },
    models: baseline,
    api: apiMap,
    fetchModels: async (context) => {
      const refreshed = await args.fetchModels(context);
      const mapped = refreshed.map((config) => toNativeModel(args.id, config));
      return mapped.length > 0 ? mapped : baseline;
    },
  });
}

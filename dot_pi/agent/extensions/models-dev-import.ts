/**
 * Models.dev Provider Import Extension
 *
 * 启动时从 https://models.dev/api.json 拉取 provider 注册表，
 * 自动将其中所有 OpenAI 兼容 provider 注册至 pi。
 *
 * 效果：/model 列表中出现数百个新模型，按 provider 分组。
 *
 * 跳过 pi 内建 provider（deepseek / openrouter / xiaomi 等），
 * 因 pi 已有原生支持，不覆盖。
 *
 * 缓存：注册表缓存 1 小时至 ~/.pi/agent/cache/models-dev-registry.json，
 * TTL 内跳过网络请求。网络失败时回退至过期缓存。
 *
 * 环境变量：各 provider 以 api.json 中 env[0] 为 API key 名，
 * 使用前需 export 对应变量（如 DEEPINFRA_API_KEY=xxx）。
 */

import type { ExtensionAPI, ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

// ── pi 已原生支持的 provider，不覆盖 ──
const BUILTIN_PROVIDERS = new Set([
	"deepseek",
	"openrouter",
	"fireworks-ai",
	"minimax",
	"minimax-cn",
	"zai",
	"zai-coding-plan",
	"kimi-for-coding",
	"huggingface",
	"cloudflare-workers-ai",
	"github-copilot",
	"opencode",
	"opencode-go",
	"xiaomi",
	"xiaomi-token-plan-cn",
	"xiaomi-token-plan-ams",
	"xiaomi-token-plan-sgp",
	"siliconflow",
	"siliconflow-cn",
	"tencent-tokenhub",
]);

const MODELS_DEV_URL = "https://models.dev/api.json";
const CACHE_DIR = join(homedir(), ".pi", "agent", "cache");
const CACHE_FILE = join(CACHE_DIR, "models-dev-registry.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 小时

// ── Raw JSON types (subset of what api.json provides) ──
interface RawModel {
	id: string;
	name?: string;
	reasoning?: boolean;
	modalities?: { input?: string[] };
	limit?: { context?: number; output?: number };
	cost?: {
		input?: number;
		output?: number;
		cache_read?: number;
		cache_write?: number;
	};
}

interface RawProvider {
	id: string;
	env?: string[];
	api?: string;
	name?: string;
	models?: Record<string, RawModel>;
}

interface CacheEntry {
	fetchedAt: number;
	data: Record<string, RawProvider>;
}

// ── 实现 ──
export default async function (pi: ExtensionAPI) {
	const registry = await fetchWithCache();
	if (!registry) return;

	let registered = 0;
	for (const [pid, provider] of Object.entries(registry)) {
		if (!provider.api) continue; // 非 OpenAI 兼容 provider（内建引用）
		if (BUILTIN_PROVIDERS.has(pid)) continue; // pi 已有原生支持
		if (!provider.models) continue;

		const rawList = Object.values(provider.models).filter(
			(m): m is RawModel => !!m.id,
		);
		if (rawList.length === 0) continue;

		const models = rawList
			.map(mapModel)
			.filter((m): m is ProviderModelConfig => m !== null);
		if (models.length === 0) continue;

		const envKey = provider.env?.[0];
		pi.registerProvider(pid, {
			name: provider.name ?? pid,
			baseUrl: normalizeBaseUrl(provider.api),
			...(envKey ? { apiKey: envKey } : {}),
			api: "openai-completions",
			models,
		});
		registered++;
	}

}

// 静默注册成功。仅出错时提示。

// ── 缓存管理 ──

function fetchWithCache(): Promise<Record<string, RawProvider> | null> {
	// 先尝试读缓存
	const cached = readCache();
	if (cached) {
		const age = Date.now() - cached.fetchedAt;
		if (age < CACHE_TTL_MS) {
			return Promise.resolve(cached.data); // TTL 内，直接用
		}
		// 缓存过期，后台异步刷新，但先用过期数据
		refreshCacheAsync();
		return Promise.resolve(cached.data);
	}

	// 无缓存，同步拉取
	return fetchAndSave();
}

function readCache(): CacheEntry | null {
	try {
		const raw = readFileSync(CACHE_FILE, "utf-8");
		const entry = JSON.parse(raw) as CacheEntry;
		if (entry && typeof entry.fetchedAt === "number" && entry.data) {
			return entry;
		}
	} catch {
		// 文件不存在 / 解析失败，忽略
	}
	return null;
}

async function refreshCacheAsync(): Promise<void> {
	try {
		const res = await fetch(MODELS_DEV_URL);
		if (!res.ok) return;
		const data = await res.json() as Record<string, RawProvider>;
		saveCache(data);
		console.error("[models-dev] Cache updated");
	} catch {
		// 后台刷新失败不报错——stale 数据已用
	}
}

async function fetchAndSave(): Promise<Record<string, RawProvider> | null> {
	try {
		const res = await fetch(MODELS_DEV_URL);
		if (!res.ok) {
			console.error(`[models-dev] Fetch failed: ${res.status}`);
			return null;
		}
		const data = await res.json() as Record<string, RawProvider>;
		saveCache(data);
		return data;
	} catch (e) {
		console.error(`[models-dev] Fetch failed: ${e instanceof Error ? e.message : e}`);
		return null; // 首次拉取失败，不阻塞启动
	}
}

function saveCache(data: Record<string, RawProvider>): void {
	try {
		mkdirSync(CACHE_DIR, { recursive: true });
		const entry: CacheEntry = { fetchedAt: Date.now(), data };
		writeFileSync(CACHE_FILE, JSON.stringify(entry), "utf-8");
	} catch (e) {
		console.error(`[models-dev] Cache write failed: ${e instanceof Error ? e.message : e}`);
	}
}

// ── 辅助函数 ──

/** 标准化 baseUrl：去掉 pi 会追加的路径段 */
function normalizeBaseUrl(url: string): string {
	return url
		.replace(/\/chat\/completions\/?$/, "") // pi 追加 /chat/completions
		.replace(/\/$/, ""); // 去尾斜杠
}

/** 映射 models.dev 模型格式 → pi ProviderModelConfig */
function mapModel(raw: RawModel): ProviderModelConfig | null {
	if (!raw.id) return null;

	const input: ("text" | "image")[] = ["text"];
	if (raw.modalities?.input?.includes("image")) {
		input.push("image");
	}

	return {
		id: raw.id,
		name: raw.name ?? raw.id,
		reasoning: raw.reasoning ?? false,
		input,
		contextWindow: raw.limit?.context ?? 128000,
		maxTokens: raw.limit?.output ?? 16384,
		cost: {
			input: raw.cost?.input ?? 0,
			output: raw.cost?.output ?? 0,
			cacheRead: raw.cost?.cache_read ?? 0,
			cacheWrite: raw.cost?.cache_write ?? 0,
		},
	};
}

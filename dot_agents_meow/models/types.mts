/** 模型域类型：models.dev 原始数据与 gen-models.py 产出的中立配置。 */

export interface RawReasoningOption {
  type?: string;
  values?: string[];
}

export interface RawModel {
  id: string;
  name?: string;
  reasoning?: boolean;
  reasoning_options?: RawReasoningOption[];
  modalities?: { input?: string[] };
  limit?: { context?: number; output?: number };
  provider?: { npm?: string; api?: string; shape?: string };
}

export interface RawProvider {
  id?: string;
  name?: string;
  api?: string;
  npm?: string;
  env?: string[];
  models?: Record<string, RawModel>;
}

export type ModelsDevData = Record<string, RawProvider>;

export interface ResolvedModel {
  name?: string;
  disabled?: boolean;
  api?: string;
  base_url?: string;
  reasoning?: boolean;
  input?: string[];
  context_window?: number;
  max_tokens?: number;
  cost?: { input: number; output: number; cache_read: number; cache_write: number };
  thinking_levels?: string[];
  thinking_wire?: Record<string, string>;
  compat?: Record<string, unknown>;
}

export interface ResolvedProvider {
  kind: "override" | "definition";
  name?: string;
  api?: string;
  base_url?: string;
  api_key?: string;
  compat?: Record<string, unknown>;
  models: Record<string, ResolvedModel>;
}

export interface ResolvedConfig {
  disabled_providers?: string[];
  providers?: Record<string, ResolvedProvider>;
}

export interface RouteModel {
  id: string;
  name: string;
  contextWindow?: number;
  maxTokens?: number;
  input?: string[];
  reasoningEfforts?: false | Record<string, string>;
  compat?: Record<string, unknown>;
}

export interface Route {
  apiKeyEnv?: string;
  displayName: string;
  api: string;
  baseURL?: string;
  compat?: Record<string, unknown>;
  models: RouteModel[];
}

export interface MappingStats {
  providers: number;
  models: number;
  skippedProviders: string[];
  skippedModels: string[];
  shadowed: string[];
  droppedLimits: number;
}

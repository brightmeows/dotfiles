/** Mapping 的合成规则测试：node --test dot_agents_meow/models/mapping.test.mts */

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRoutes, expandEnvUrl } from "./mapping.mts";
import type { ModelsDevData, ResolvedConfig } from "./types.mts";

const env: Record<string, string | undefined> = { TOKEN: "abc" };

function gateway(): ModelsDevData {
  return {
    gateway: {
      id: "gateway",
      name: "Gateway",
      npm: "@ai-sdk/openai-compatible",
      api: "https://gw.example/v1",
      env: ["GATEWAY_KEY"],
      models: {
        plain: { id: "plain", name: "Plain", limit: { context: 1000, output: 100 } },
        shaped: {
          id: "shaped",
          name: "Shaped",
          limit: { context: 2000, output: 200 },
          provider: { shape: "responses" },
        },
        zero: { id: "zero", name: "Zero", limit: { context: 0, output: 0 } },
      },
    },
  };
}

test("npm 映射与未知 npm 跳过", () => {
  const modelsDev: ModelsDevData = {
    known: { id: "known", npm: "@ai-sdk/anthropic", models: { m1: { id: "m1" } } },
    unknown: { id: "unknown", npm: "some-unknown-sdk", models: { m1: { id: "m1" } } },
    compatNoApi: {
      id: "compatNoApi",
      npm: "@ai-sdk/openai-compatible",
      models: { m1: { id: "m1" } },
    },
  };
  const { routes, stats } = buildRoutes({ modelsDev, resolved: {}, env });
  assert.equal(routes["known"]?.api, "anthropic-messages");
  assert.equal(routes["unknown"], undefined);
  assert.equal(routes["compatNoApi"], undefined);
  assert.equal(stats.skippedProviders.length, 2);
});

test("零限额被丢弃且计数", () => {
  const { routes, stats } = buildRoutes({ modelsDev: gateway(), resolved: {}, env });
  const models = routes["gateway"]?.models ?? [];
  const zero = models.find((model) => model.id === "zero");
  assert.ok(zero);
  assert.equal(zero.contextWindow, undefined);
  assert.equal(zero.maxTokens, undefined);
  assert.equal(stats.droppedLimits, 1);
});

test("按协议分组拆分路由", () => {
  const { routes } = buildRoutes({ modelsDev: gateway(), resolved: {}, env });
  assert.equal(routes["gateway"]?.api, "openai-completions");
  assert.deepEqual(
    routes["gateway"]?.models.map((model) => model.id),
    ["plain", "zero"],
  );
  assert.equal(routes["gateway-2"]?.api, "openai-responses");
  assert.deepEqual(
    routes["gateway-2"]?.models.map((model) => model.id),
    ["shaped"],
  );
});

test("effort 取值映射（none 转 off）", () => {
  const modelsDev: ModelsDevData = {
    gateway: {
      id: "gateway",
      npm: "@ai-sdk/openai-compatible",
      api: "https://gw.example/v1",
      models: {
        thinker: {
          id: "thinker",
          reasoning: true,
          reasoning_options: [{ type: "effort", values: ["none", "low", "high"] }],
        },
        toggleOnly: { id: "toggleOnly", reasoning: true, reasoning_options: [{ type: "toggle" }] },
        nonReasoning: { id: "nonReasoning", reasoning: false },
      },
    },
  };
  const { routes } = buildRoutes({ modelsDev, resolved: {}, env });
  const models = routes["gateway"]?.models ?? [];
  assert.deepEqual(models.find((model) => model.id === "thinker")?.reasoningEfforts, {
    off: "none",
    low: "low",
    high: "high",
  });
  assert.equal(models.find((model) => model.id === "toggleOnly")?.reasoningEfforts, undefined);
  assert.equal(models.find((model) => model.id === "nonReasoning")?.reasoningEfforts, false);
});

test("禁用清单与模型级禁用", () => {
  const resolved: ResolvedConfig = {
    disabled_providers: ["offlimits"],
    providers: {
      gateway: { kind: "override", models: { plain: { disabled: true } } },
      offlimits: { kind: "override", models: {} },
    },
  };
  const modelsDev = gateway();
  modelsDev["offlimits"] = {
    id: "offlimits",
    npm: "@ai-sdk/openai-compatible",
    api: "https://off.example/v1",
    models: { m: { id: "m" } },
  };
  const { routes } = buildRoutes({ modelsDev, resolved, env });
  assert.equal(routes["offlimits"], undefined);
  assert.ok(!routes["gateway"]?.models.some((model) => model.id === "plain"));
});

test("定义类 provider 直接构造", () => {
  const resolved: ResolvedConfig = {
    providers: {
      custom: {
        kind: "definition",
        name: "Custom",
        api: "openai-completions",
        base_url: "https://custom.example/v1",
        api_key: "CUSTOM_KEY",
        compat: { supportsDeveloperRole: false },
        models: {
          "custom/model": {
            reasoning: true,
            input: ["text", "image"],
            context_window: 1000,
            max_tokens: 100,
            thinking_levels: ["low", "high"],
          },
        },
      },
    },
  };
  const { routes } = buildRoutes({ modelsDev: {}, resolved, env });
  const route = routes["custom"];
  assert.ok(route);
  assert.equal(route.apiKeyEnv, "CUSTOM_KEY");
  assert.equal(route.baseURL, "https://custom.example/v1");
  assert.deepEqual(route.compat, { supportsDeveloperRole: false });
  assert.deepEqual(route.models[0]?.reasoningEfforts, { low: "low", high: "high" });
});

test("定义遮蔽目录 provider 时记入统计", () => {
  const resolved: ResolvedConfig = {
    providers: {
      gateway: {
        kind: "definition",
        api: "openai-completions",
        base_url: "https://local.example/v1",
        models: {
          local: {
            context_window: 10,
            max_tokens: 10,
            cost: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
          },
        },
      },
    },
  };
  const { routes, stats } = buildRoutes({ modelsDev: gateway(), resolved, env });
  assert.deepEqual(stats.shadowed, ["gateway"]);
  assert.deepEqual(
    routes["gateway"]?.models.map((model) => model.id),
    ["local"],
  );
});

test("环境变量占位符展开", () => {
  // oxlint-disable-next-line no-template-curly-in-string -- 刻意断言字面占位符
  assert.equal(expandEnvUrl("https://gw.example/${TOKEN}/v1", env), "https://gw.example/abc/v1");
  // oxlint-disable-next-line no-template-curly-in-string -- 刻意断言缺变量占位符
  assert.equal(expandEnvUrl("https://gw.example/${MISSING}/v1", env), undefined);
  assert.equal(expandEnvUrl("https://gw.example/v1", env), "https://gw.example/v1");
});

test("不支持协议被跳过", () => {
  const modelsDev: ModelsDevData = {
    goog: { id: "goog", npm: "@ai-sdk/google", models: { m: { id: "m" } } },
    vert: { id: "vert", npm: "@ai-sdk/google-vertex", models: { m: { id: "m" } } },
  };
  const { routes, stats } = buildRoutes({ modelsDev, resolved: {}, env });
  assert.equal(routes["goog"], undefined);
  assert.equal(routes["vert"], undefined);
  assert.equal(stats.skippedProviders.length, 2);
});

test("非法凭据名被跳过", () => {
  const modelsDev: ModelsDevData = {
    bad: {
      id: "bad",
      npm: "@ai-sdk/openai-compatible",
      api: "https://bad.example/v1",
      env: ["302AI_API_KEY"],
      models: { m: { id: "m" } },
    },
  };
  const { routes, stats } = buildRoutes({ modelsDev, resolved: {}, env });
  assert.equal(routes["bad"], undefined);
  assert.ok(stats.skippedProviders[0]?.includes("凭据名非法"));
});

import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_CONFIG } from "./config.ts";
import { buildAttribution, isAttributionDisabled, withGitConfig } from "./trailers.ts";

const CO_AUTHOR = "Co-Authored-By: 白小喵 <noreply@pi.dev>";
const GENERATED_BY = "Generated-By: pi 1.4.0 (deepseek-v4.1-flash @ opencode-go, reasoning=max)";

test("写入身份、模型、provider 与 reasoning", () => {
  assert.deepEqual(
    buildAttribution(
      {
        PI_MODEL: "deepseek-v4.1-flash",
        PI_PROVIDER: "opencode-go",
        PI_REASONING_LEVEL: "max",
      },
      "1.4.0",
      DEFAULT_CONFIG,
    ),
    {
      coAuthor: CO_AUTHOR,
      coAuthorEmail: "noreply@pi.dev",
      generatedBy: GENERATED_BY,
    },
  );
});

test("去掉 provider 前缀与 thinking 后缀", () => {
  assert.deepEqual(
    buildAttribution(
      {
        PI_MODEL: "opencode-go/deepseek-v4.1-flash:high",
        PI_PROVIDER: "opencode-go",
        PI_REASONING_LEVEL: "max",
      },
      "1.4.0",
      DEFAULT_CONFIG,
    ),
    {
      coAuthor: CO_AUTHOR,
      coAuthorEmail: "noreply@pi.dev",
      generatedBy: GENERATED_BY,
    },
  );
});

test("保留非 provider 前缀的模型命名空间", () => {
  assert.equal(
    buildAttribution(
      {
        PI_MODEL: "deepseek/deepseek-v4.1-flash",
        PI_PROVIDER: "command-code",
        PI_REASONING_LEVEL: "max",
      },
      "1.4.0",
      DEFAULT_CONFIG,
    ).generatedBy,
    "Generated-By: pi 1.4.0 (deepseek/deepseek-v4.1-flash @ command-code, reasoning=max)",
  );
});

test("模型缺失时只留 reasoning", () => {
  assert.equal(
    buildAttribution(
      { PI_PROVIDER: "opencode-go", PI_REASONING_LEVEL: "max" },
      "1.4.0",
      DEFAULT_CONFIG,
    ).generatedBy,
    "Generated-By: pi 1.4.0 (reasoning=max)",
  );
  assert.equal(
    buildAttribution({ PI_MODEL: "unknown" }, "1.4.0", DEFAULT_CONFIG).coAuthor,
    CO_AUTHOR,
  );
});

test("provider 缺失时省略 @ provider", () => {
  assert.equal(
    buildAttribution(
      { PI_MODEL: "deepseek-v4.1-flash", PI_REASONING_LEVEL: "max" },
      "1.4.0",
      DEFAULT_CONFIG,
    ).generatedBy,
    "Generated-By: pi 1.4.0 (deepseek-v4.1-flash, reasoning=max)",
  );
});

test("reasoning 缺失或非法时省略", () => {
  assert.equal(
    buildAttribution(
      { PI_MODEL: "deepseek-v4.1-flash", PI_PROVIDER: "opencode-go" },
      "1.4.0",
      DEFAULT_CONFIG,
    ).generatedBy,
    "Generated-By: pi 1.4.0 (deepseek-v4.1-flash @ opencode-go)",
  );
  assert.equal(
    buildAttribution(
      {
        PI_MODEL: "deepseek-v4.1-flash",
        PI_PROVIDER: "opencode-go",
        PI_REASONING_LEVEL: "turbo",
      },
      "1.4.0",
      DEFAULT_CONFIG,
    ).generatedBy,
    "Generated-By: pi 1.4.0 (deepseek-v4.1-flash @ opencode-go)",
  );
});

test("全部字段缺失时只留版本", () => {
  assert.equal(buildAttribution({}, "1.4.0", DEFAULT_CONFIG).generatedBy, "Generated-By: pi 1.4.0");
});

test("清洗换行、尖括号与空白", () => {
  assert.equal(
    buildAttribution(
      {
        PI_MODEL: " deepseek\n<v4.1>\tflash ",
        PI_PROVIDER: " opencode\n-go ",
        PI_REASONING_LEVEL: " MAX ",
      },
      "1.4.0",
      DEFAULT_CONFIG,
    ).generatedBy,
    "Generated-By: pi 1.4.0 (deepseek v4.1 flash @ opencode -go, reasoning=max)",
  );
});

test("使用配置里的姓名与邮箱", () => {
  assert.deepEqual(
    buildAttribution(
      {
        PI_MODEL: "deepseek-v4.1-flash",
        PI_PROVIDER: "opencode-go",
        PI_REASONING_LEVEL: "max",
      },
      "1.4.0",
      { coAuthor: { name: "猫猫", email: "<meow@example.com>" } },
    ),
    {
      coAuthor: "Co-Authored-By: 猫猫 <meow@example.com>",
      coAuthorEmail: "meow@example.com",
      generatedBy: GENERATED_BY,
    },
  );
});

test("识别退出值", () => {
  for (const value of ["0", "false", "no", "off", " FALSE "]) {
    assert.equal(isAttributionDisabled(value), true);
  }
  for (const value of [undefined, "", "1", "true", "yes", "on"]) {
    assert.equal(isAttributionDisabled(value), false);
  }
});

test("在现有 git 配置后追加 hooksPath 与署名变量", () => {
  const env = withGitConfig(
    {
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "advice.detachedHead",
      GIT_CONFIG_VALUE_0: "false",
      GIT_CONFIG_KEY_1: "core.pager",
      GIT_CONFIG_VALUE_1: "cat",
    },
    "/tmp/pi-hooks",
    {
      coAuthor: CO_AUTHOR,
      coAuthorEmail: "noreply@pi.dev",
      generatedBy: GENERATED_BY,
    },
  );
  assert.equal(env["GIT_CONFIG_COUNT"], "3");
  assert.equal(env["GIT_CONFIG_KEY_2"], "core.hooksPath");
  assert.equal(env["GIT_CONFIG_VALUE_2"], "/tmp/pi-hooks");
  assert.equal(env["PI_GIT_ATTRIBUTION_CO_AUTHOR"], CO_AUTHOR);
  assert.equal(env["PI_GIT_ATTRIBUTION_CO_AUTHOR_EMAIL"], "noreply@pi.dev");
  assert.equal(env["PI_GIT_ATTRIBUTION_GENERATED_BY"], GENERATED_BY);
});

test("git 配置计数非法时原样返回", () => {
  const input = {
    GIT_CONFIG_COUNT: "not-a-number",
    PI_MODEL: "deepseek-v4.1-flash",
  };
  assert.equal(
    withGitConfig(input, "/tmp/pi-hooks", {
      coAuthor: CO_AUTHOR,
      coAuthorEmail: "noreply@pi.dev",
      generatedBy: GENERATED_BY,
    }),
    input,
  );
});

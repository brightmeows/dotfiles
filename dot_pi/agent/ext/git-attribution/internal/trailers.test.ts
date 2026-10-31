import assert from "node:assert/strict";
import test from "node:test";

import { buildAttribution, isAttributionDisabled, withGitConfig } from "./trailers.ts";

const CO_AUTHOR = "Co-Authored-By: 白小喵（deepseek-v4.1-flash @ opencode-go） <noreply@pi.dev>";
const GENERATED_BY = "Generated-By: pi 1.4.0";

test("写入模型、provider 与版本", () => {
  assert.deepEqual(
    buildAttribution(
      {
        PI_MODEL: "deepseek-v4.1-flash",
        PI_PROVIDER: "opencode-go",
      },
      "1.4.0",
    ),
    { coAuthor: CO_AUTHOR, generatedBy: GENERATED_BY },
  );
});

test("去掉 provider 前缀与 thinking 后缀", () => {
  assert.deepEqual(
    buildAttribution(
      {
        PI_MODEL: "opencode-go/deepseek-v4.1-flash:high",
        PI_PROVIDER: "opencode-go",
      },
      "1.4.0",
    ),
    { coAuthor: CO_AUTHOR, generatedBy: GENERATED_BY },
  );
});

test("保留非 provider 前缀的模型命名空间", () => {
  assert.equal(
    buildAttribution(
      {
        PI_MODEL: "deepseek/deepseek-v4.1-flash",
        PI_PROVIDER: "command-code",
      },
      "1.4.0",
    ).coAuthor,
    "Co-Authored-By: 白小喵（deepseek/deepseek-v4.1-flash @ command-code） <noreply@pi.dev>",
  );
});

test("模型缺失时只写名字", () => {
  assert.equal(
    buildAttribution({ PI_PROVIDER: "opencode-go" }, "1.4.0").coAuthor,
    "Co-Authored-By: 白小喵 <noreply@pi.dev>",
  );
  assert.equal(
    buildAttribution({ PI_MODEL: "unknown" }, "1.4.0").coAuthor,
    "Co-Authored-By: 白小喵 <noreply@pi.dev>",
  );
});

test("provider 缺失时省略 @ provider", () => {
  assert.equal(
    buildAttribution({ PI_MODEL: "deepseek-v4.1-flash" }, "1.4.0").coAuthor,
    "Co-Authored-By: 白小喵（deepseek-v4.1-flash） <noreply@pi.dev>",
  );
});

test("清洗换行、尖括号与空白", () => {
  assert.equal(
    buildAttribution(
      {
        PI_MODEL: " deepseek\n<v4.1>\tflash ",
        PI_PROVIDER: " opencode\n-go ",
      },
      "1.4.0",
    ).coAuthor,
    "Co-Authored-By: 白小喵（deepseek v4.1 flash @ opencode -go） <noreply@pi.dev>",
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

test("在现有 git 配置后追加 hooksPath", () => {
  const env = withGitConfig(
    {
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "advice.detachedHead",
      GIT_CONFIG_VALUE_0: "false",
      GIT_CONFIG_KEY_1: "core.pager",
      GIT_CONFIG_VALUE_1: "cat",
    },
    "/tmp/pi-hooks",
    { coAuthor: CO_AUTHOR, generatedBy: GENERATED_BY },
  );
  assert.equal(env["GIT_CONFIG_COUNT"], "3");
  assert.equal(env["GIT_CONFIG_KEY_2"], "core.hooksPath");
  assert.equal(env["GIT_CONFIG_VALUE_2"], "/tmp/pi-hooks");
  assert.equal(env["PI_GIT_ATTRIBUTION_CONFIG_INDEX"], "2");
  assert.equal(env["PI_GIT_ATTRIBUTION_CO_AUTHOR"], CO_AUTHOR);
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
      generatedBy: GENERATED_BY,
    }),
    input,
  );
});

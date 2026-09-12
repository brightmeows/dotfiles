#!/usr/bin/env python3
"""一次性导入器：把 Pi 的 models.json 转成模型域 TOML 初稿。

用法：
    python3 import-pi-models.py [--input <models.json>] [--output <models.toml>]

映射规则（snake_case 化的字段见 dot_agents_meow/models/AGENTS.md）：
- provider.baseUrl  -> base_url
- provider.apiKey 的 "$VAR" -> api_key 的 "VAR"（去掉 $ 前缀）
- provider.api      -> api
- provider.compat   -> compat（键名经映射表；未知键报错）
- models[]          -> [providers.<id>.models.<模型 id>] 子表
- thinkingLevelMap  -> thinking_levels（非空项档位列表）
                    + thinking_wire（线上拼写非档位名时的覆盖）
- 未声明 thinkingLevelMap 的模型不写档位字段

初稿另含顶层 disabled_providers 建议值（openrouter 与 opencode 体量最大）。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Pi compat 键 -> TOML 键（与 gen-models.py 的映射表保持一致）
COMPAT_TO_TOML = {
    "supportsDeveloperRole": "supports_developer_role",
    "supportsReasoningEffort": "supports_reasoning_effort",
    "supportsStore": "supports_store",
    "supportsUsageInStreaming": "supports_usage_in_streaming",
    "supportsFinishReason": "supports_finish_reason",
    "maxTokensField": "max_tokens_field",
    "requiresToolResultName": "requires_tool_result_name",
    "requiresAssistantAfterToolResult": "requires_assistant_after_tool_result",
    "requiresThinkingAsText": "requires_thinking_as_text",
    "requiresReasoningContentOnAssistantMessages": "requires_reasoning_content_on_assistant_messages",
    "thinkingFormat": "thinking_format",
    "supportsThinkingTokenBudget": "supports_thinking_token_budget",
    "thinkingTokenBudgetField": "thinking_token_budget_field",
    "supportsStrictMode": "supports_strict_mode",
    "cacheControlFormat": "cache_control_format",
    "supportsLongCacheRetention": "supports_long_cache_retention",
    "supportsMaxOutputTokens": "supports_max_output_tokens",
    "supportsTemperature": "supports_temperature",
}

THINKING_LEVELS = ("minimal", "low", "medium", "high", "xhigh", "max")

PROVIDER_FIELD_ORDER = ("name", "api", "base_url", "api_key", "compat")
MODEL_FIELD_ORDER = (
    "name",
    "disabled",
    "api",
    "base_url",
    "reasoning",
    "input",
    "context_window",
    "max_tokens",
    "cost",
    "thinking_levels",
    "thinking_wire",
    "compat",
)


def toml_value(value: object) -> str:
    """把 Python 值序列化为 TOML 字面量（字符串走 JSON 转义，二者兼容）。"""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return repr(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        return "[" + ", ".join(toml_value(item) for item in value) + "]"
    if isinstance(value, dict):
        parts = [f"{key} = {toml_value(item)}" for key, item in value.items()]
        return "{ " + ", ".join(parts) + " }"
    raise TypeError(f"无法序列化为 TOML：{value!r}")


def convert_compat(raw: object) -> dict[str, object]:
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise TypeError(f"compat 必须是对象：{raw!r}")
    out: dict[str, object] = {}
    for key, value in raw.items():
        toml_key = COMPAT_TO_TOML.get(key)
        if toml_key is None:
            sys.exit(f"未知 compat 键：{key}（需先登记到映射表）")
        out[toml_key] = value
    return out


def convert_model(model: dict) -> tuple[str, dict[str, object]]:
    entry: dict[str, object] = {}
    if model.get("name"):
        entry["name"] = model["name"]
    if "reasoning" in model:
        entry["reasoning"] = bool(model["reasoning"])
    if "input" in model:
        entry["input"] = list(model["input"])
    if "contextWindow" in model:
        entry["context_window"] = model["contextWindow"]
    if "maxTokens" in model:
        entry["max_tokens"] = model["maxTokens"]
    if "cost" in model:
        cost = model["cost"]
        entry["cost"] = {
            "input": cost.get("input", 0.0),
            "output": cost.get("output", 0.0),
            "cache_read": cost.get("cacheRead", 0.0),
            "cache_write": cost.get("cacheWrite", 0.0),
        }
    mapping = model.get("thinkingLevelMap")
    if isinstance(mapping, dict):
        levels: list[str] = []
        wire: dict[str, str] = {}
        for level in THINKING_LEVELS:
            value = mapping.get(level)
            if value is None:
                continue
            levels.append(level)
            if value != level:
                wire[level] = value
        if levels:
            entry["thinking_levels"] = levels
        if wire:
            entry["thinking_wire"] = wire
    if model.get("compat"):
        entry["compat"] = convert_compat(model["compat"])
    return model["id"], entry


def to_toml(models_json: dict) -> str:
    lines: list[str] = []
    lines.append("# 由 dot_agents_meow/models/import-pi-models.py 从 Pi models.json 生成；")
    lines.append("# 这是模型配置的唯一编辑入口，规则与字段见同目录 AGENTS.md。")
    lines.append("# models.dev 同名 provider 的条目表示覆盖外部数据；未收录者表示完整定义。")
    lines.append("")
    lines.append('disabled_providers = ["openrouter", "opencode"]')
    lines.append("")

    for provider_id, provider in models_json["providers"].items():
        provider_table: dict[str, object] = {}
        if provider.get("baseUrl"):
            provider_table["base_url"] = provider["baseUrl"]
        if provider.get("apiKey"):
            api_key = provider["apiKey"]
            provider_table["api_key"] = api_key[1:] if api_key.startswith("$") else api_key
        if provider.get("api"):
            provider_table["api"] = provider["api"]
        if provider.get("compat"):
            provider_table["compat"] = convert_compat(provider["compat"])

        lines.append(f"[providers.{provider_id}]")
        for field in PROVIDER_FIELD_ORDER:
            if field in provider_table:
                lines.append(f"{field} = {toml_value(provider_table[field])}")
        lines.append("")

        for model in provider["models"]:
            model_id, entry = convert_model(model)
            lines.append(f'[providers.{provider_id}.models."{model_id}"]')
            for field in MODEL_FIELD_ORDER:
                if field in entry:
                    lines.append(f"{field} = {toml_value(entry[field])}")
            lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def default_input() -> Path:
    return Path.cwd() / "dot_pi" / "agent" / "models.json"


def default_output() -> Path:
    return Path.cwd() / "dot_agents_meow" / "models" / "models.toml"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", help="Pi models.json 路径")
    parser.add_argument("--output", help="TOML 输出路径")
    args = parser.parse_args()

    source = Path(args.input) if args.input else default_input()
    target = Path(args.output) if args.output else default_output()
    if not source.is_file():
        sys.exit(f"找不到输入文件：{source}")

    with source.open(encoding="utf-8") as handle:
        models_json = json.load(handle)

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(to_toml(models_json), encoding="utf-8")
    count = sum(len(provider["models"]) for provider in models_json["providers"].values())
    print(f"已生成 {target}（{len(models_json['providers'])} 个 provider、{count} 个模型）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""模型配置生成器：校验 models.toml，并生成 Pi 侧两份 JSON 与 dsh 插件用的 resolved.json。

产物（默认写入仓库与本地）：
- dot_pi/agent/models-dev.json          Pi models-dev 扩展的编辑配置（覆盖类条目与禁用清单，随仓库提交）
- dot_pi/agent/models.json              Pi 原生自定义模型文件（定义类条目，随仓库提交）
- ~/.agents_meow/models/resolved.json   dsh 插件消费的中立配置（本机生成，不入库）

用法：
    python3 gen-models.py                        # 生成仓库产物与本地 resolved.json
    python3 gen-models.py --check                # 校验 TOML 并比对已存在的目标
    python3 gen-models.py --pi-out ~/.pi/agent   # apply 脚本：另写部署副本（Linux）

规则与字段说明见同目录 AGENTS.md。
"""

from __future__ import annotations

import argparse
import difflib
import json
import re
import sys
import tomllib
from pathlib import Path

PROVIDER_FIELDS = ("name", "api", "base_url", "api_key", "compat", "models")
MODEL_FIELDS = (
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
# 出现任一字段即视为「完整定义」而非「覆盖」
DEFINITION_FIELDS = (
    "reasoning",
    "input",
    "context_window",
    "max_tokens",
    "cost",
    "thinking_levels",
    "thinking_wire",
    "compat",
)
OVERRIDE_MODEL_FIELDS = ("name", "disabled", "api", "base_url")
THINKING_LEVELS = ("minimal", "low", "medium", "high", "xhigh", "max")
MODALITIES = ("text", "image")
COST_KEYS = ("input", "output", "cache_read", "cache_write")

CREDENTIAL_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

COMPAT_TO_TARGET = {
    "supports_developer_role": "supportsDeveloperRole",
    "supports_reasoning_effort": "supportsReasoningEffort",
    "supports_store": "supportsStore",
    "supports_usage_in_streaming": "supportsUsageInStreaming",
    "supports_finish_reason": "supportsFinishReason",
    "max_tokens_field": "maxTokensField",
    "requires_tool_result_name": "requiresToolResultName",
    "requires_assistant_after_tool_result": "requiresAssistantAfterToolResult",
    "requires_thinking_as_text": "requiresThinkingAsText",
    "requires_reasoning_content_on_assistant_messages": "requiresReasoningContentOnAssistantMessages",
    "thinking_format": "thinkingFormat",
    "supports_thinking_token_budget": "supportsThinkingTokenBudget",
    "thinking_token_budget_field": "thinkingTokenBudgetField",
    "supports_strict_mode": "supportsStrictMode",
    "cache_control_format": "cacheControlFormat",
    "supports_long_cache_retention": "supportsLongCacheRetention",
    "supports_max_output_tokens": "supportsMaxOutputTokens",
    "supports_temperature": "supportsTemperature",
}


class ConfigError(Exception):
    """TOML 不符合模型域 schema。"""


def fail(message: str) -> None:
    raise ConfigError(message)


def check_keys(where: str, value: dict, allowed: tuple[str, ...]) -> None:
    unknown = [key for key in value if key not in allowed]
    if unknown:
        fail(f"{where} 含未知键：{', '.join(map(str, unknown))}（允许：{', '.join(allowed)}）")


def check_string(where: str, value: object) -> str:
    if not isinstance(value, str) or not value:
        fail(f"{where} 必须是非空字符串")
    return value


def check_bool(where: str, value: object) -> bool:
    if not isinstance(value, bool):
        fail(f"{where} 必须是布尔值")
    return value


def check_int(where: str, value: object) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        fail(f"{where} 必须是正整数")
    return value


def check_compat(where: str, value: object) -> dict[str, object]:
    if not isinstance(value, dict):
        fail(f"{where} 必须是内联表")
    out: dict[str, object] = {}
    for key, item in value.items():
        if key not in COMPAT_TO_TARGET:
            fail(f"{where} 含未知 compat 键：{key}")
        out[key] = item
    return out


def parse_cost(where: str, value: object) -> dict[str, float]:
    if not isinstance(value, dict):
        fail(f"{where} 必须是内联表")
    unknown = [key for key in value if key not in COST_KEYS]
    if unknown:
        fail(f"{where} 含未知键：{', '.join(unknown)}")
    missing = [key for key in COST_KEYS if key not in value]
    if missing:
        fail(f"{where} 缺少键：{', '.join(missing)}")
    for key in COST_KEYS:
        item = value[key]
        if not isinstance(item, (int, float)) or isinstance(item, bool) or item < 0:
            fail(f"{where}.{key} 必须是非负数")
    return {key: float(value[key]) for key in COST_KEYS}


def parse_thinking(where: str, model: dict) -> tuple[list[str] | None, dict[str, str]]:
    levels = model.get("thinking_levels")
    wire = model.get("thinking_wire")
    if levels is None:
        if wire is not None:
            fail(f"{where}.thinking_wire 需要同时给出 thinking_levels")
        return None, {}
    if not isinstance(levels, list):
        fail(f"{where}.thinking_levels 必须是数组")
    out_levels: list[str] = []
    for item in levels:
        if item not in THINKING_LEVELS:
            fail(f"{where}.thinking_levels 含未知档位：{item}")
        if item in out_levels:
            fail(f"{where}.thinking_levels 含重复档位：{item}")
        out_levels.append(item)
    out_wire: dict[str, str] = {}
    if wire is not None:
        if not isinstance(wire, dict):
            fail(f"{where}.thinking_wire 必须是内联表")
        for level, value in wire.items():
            if level not in out_levels:
                fail(f"{where}.thinking_wire 的档位 {level} 不在 thinking_levels 中")
            out_wire[level] = check_string(f"{where}.thinking_wire.{level}", value)
    return out_levels, out_wire


def parse_model(where: str, model_id: str, model: dict) -> dict[str, object]:
    check_keys(where, model, MODEL_FIELDS)
    entry: dict[str, object] = {"id": model_id}
    if "name" in model:
        entry["name"] = check_string(f"{where}.name", model["name"])
    if "disabled" in model:
        entry["disabled"] = check_bool(f"{where}.disabled", model["disabled"])
    if "api" in model:
        entry["api"] = check_string(f"{where}.api", model["api"])
    if "base_url" in model:
        entry["base_url"] = check_string(f"{where}.base_url", model["base_url"])
    if "reasoning" in model:
        entry["reasoning"] = check_bool(f"{where}.reasoning", model["reasoning"])
    if "input" in model:
        raw_input = model["input"]
        if not isinstance(raw_input, list) or not raw_input:
            fail(f"{where}.input 必须是非空数组")
        for item in raw_input:
            if item not in MODALITIES:
                fail(f"{where}.input 含未知模态：{item}")
        entry["input"] = list(raw_input)
    for key in ("context_window", "max_tokens"):
        if key in model:
            entry[key] = check_int(f"{where}.{key}", model[key])
    if "cost" in model:
        entry["cost"] = parse_cost(f"{where}.cost", model["cost"])
    levels, wire = parse_thinking(where, model)
    if levels is not None:
        entry["thinking_levels"] = levels
    if wire:
        entry["thinking_wire"] = wire
    if "compat" in model:
        entry["compat"] = check_compat(f"{where}.compat", model["compat"])
    return entry


def load_config(toml_path: Path) -> tuple[list[str], dict[str, dict]]:
    with toml_path.open("rb") as handle:
        raw = tomllib.load(handle)
    check_keys("顶层", raw, ("disabled_providers", "providers"))

    raw_disabled = raw.get("disabled_providers", [])
    if not isinstance(raw_disabled, list):
        fail("disabled_providers 必须是数组")
    disabled: list[str] = []
    for item in raw_disabled:
        item = check_string("disabled_providers 条目", item)
        if item in disabled:
            fail(f"disabled_providers 含重复项：{item}")
        disabled.append(item)

    raw_providers = raw.get("providers")
    if raw_providers is None:
        fail("缺少 [providers] 段")
    if not isinstance(raw_providers, dict):
        fail("[providers] 必须是表")

    providers: dict[str, dict] = {}
    for provider_id, provider in raw_providers.items():
        where = f"providers.{provider_id}"
        if not isinstance(provider, dict):
            fail(f"[{where}] 必须是表")
        check_keys(where, provider, PROVIDER_FIELDS)
        if "disabled" in provider:
            fail(f"[{where}] 不接受 disabled；provider 级禁用请写进顶层 disabled_providers")
        entry: dict[str, object] = {"id": provider_id}
        if "name" in provider:
            entry["name"] = check_string(f"{where}.name", provider["name"])
        if "api" in provider:
            entry["api"] = check_string(f"{where}.api", provider["api"])
        if "base_url" in provider:
            entry["base_url"] = check_string(f"{where}.base_url", provider["base_url"])
        if "api_key" in provider:
            api_key = check_string(f"{where}.api_key", provider["api_key"])
            if not CREDENTIAL_RE.match(api_key):
                fail(f"{where}.api_key 必须是合法环境变量名（字母或下划线开头，只含字母数字下划线）")
            entry["api_key"] = api_key
        if "compat" in provider:
            entry["compat"] = check_compat(f"{where}.compat", provider["compat"])

        raw_models = provider.get("models")
        models: list[dict[str, object]] = []
        if raw_models is not None:
            if not isinstance(raw_models, dict):
                fail(f"[{where}.models] 必须是表")
            for model_id, model in raw_models.items():
                models.append(parse_model(f"{where}.models.{model_id}", check_string("模型 id", model_id), model))
        if not models and not any(key in entry for key in ("name", "api", "base_url", "api_key", "compat")):
            fail(f"[{where}] 是空条目；覆盖或定义都要至少一个字段")

        entry["models"] = models
        providers[provider_id] = entry

    for provider_id, provider in providers.items():
        is_definition = any(
            any(field in model for field in DEFINITION_FIELDS) for model in provider["models"]
        )
        provider["kind"] = "definition" if is_definition else "override"
        if is_definition:
            for required in ("api", "base_url"):
                if required not in provider:
                    fail(f"[providers.{provider_id}] 是完整定义，缺少必填字段 {required}")
            if not provider["models"]:
                fail(f"[providers.{provider_id}] 是完整定义，但没有任何模型")
            for model in provider["models"]:
                where = f"providers.{provider_id}.models.{model['id']}"
                for required in ("context_window", "max_tokens", "cost"):
                    if required not in model:
                        fail(f"[{where}] 是完整定义的一部分，缺少必填字段 {required}")
    return disabled, providers


def to_pi_models_dev(disabled: list[str], providers: dict[str, dict]) -> dict:
    out: dict[str, dict] = {}
    for provider_id in disabled:
        out[provider_id] = {"disabled": True}
    for provider_id, provider in providers.items():
        if provider["kind"] != "override" or provider_id in disabled:
            continue
        entry: dict[str, object] = {}
        if "api" in provider:
            entry["api"] = provider["api"]
        if "base_url" in provider:
            entry["baseUrl"] = provider["base_url"]
        models: dict[str, dict] = {}
        for model in provider["models"]:
            model_entry: dict[str, object] = {}
            if "disabled" in model:
                model_entry["disabled"] = model["disabled"]
            if "api" in model:
                model_entry["api"] = model["api"]
            if "base_url" in model:
                model_entry["baseUrl"] = model["base_url"]
            if "name" in model:
                model_entry["name"] = model["name"]
            if model_entry:
                models[str(model["id"])] = model_entry
        if models:
            entry["models"] = models
        if entry:
            out[provider_id] = entry
    return {"providers": out}


def to_pi_models(disabled: list[str], providers: dict[str, dict]) -> dict:
    out: dict[str, dict] = {}
    for provider_id, provider in providers.items():
        if provider["kind"] != "definition" or provider_id in disabled:
            continue
        entry: dict[str, object] = {}
        if "base_url" in provider:
            entry["baseUrl"] = provider["base_url"]
        if "api_key" in provider:
            entry["apiKey"] = f"${provider['api_key']}"
        if "api" in provider:
            entry["api"] = provider["api"]
        if "compat" in provider:
            entry["compat"] = to_target_compat(provider["compat"])
        models: list[dict] = []
        for model in provider["models"]:
            model_entry: dict[str, object] = {
                "id": model["id"],
                "name": model.get("name", model["id"]),
                "reasoning": model.get("reasoning", False),
                "input": model.get("input", ["text"]),
                "contextWindow": model["context_window"],
                "maxTokens": model["max_tokens"],
                "cost": {
                    "input": model["cost"]["input"],
                    "output": model["cost"]["output"],
                    "cacheRead": model["cost"]["cache_read"],
                    "cacheWrite": model["cost"]["cache_write"],
                },
            }
            if "thinking_levels" in model:
                wire = model.get("thinking_wire", {})
                model_entry["thinkingLevelMap"] = {
                    level: (wire.get(level, level) if level in model["thinking_levels"] else None)
                    for level in THINKING_LEVELS
                }
            if "compat" in model:
                model_entry["compat"] = to_target_compat(model["compat"])
            models.append(model_entry)
        entry["models"] = models
        out[provider_id] = entry
    return {"providers": out}


def to_target_compat(compat: dict[str, object]) -> dict[str, object]:
    return {COMPAT_TO_TARGET[key]: value for key, value in compat.items()}


def to_resolved(disabled: list[str], providers: dict[str, dict]) -> dict:
    out: dict[str, dict] = {}
    for provider_id, provider in providers.items():
        entry: dict[str, object] = {"kind": provider["kind"]}
        for key in ("name", "api", "base_url", "api_key"):
            if key in provider:
                entry[key] = provider[key]
        if "compat" in provider:
            # resolved.json 给 dsh 插件消费，compat 直接给目标键名（camelCase）
            entry["compat"] = to_target_compat(provider["compat"])
        models: dict[str, dict] = {}
        for model in provider["models"]:
            model_entry: dict[str, object] = {}
            for key in MODEL_FIELDS:
                if key in model:
                    model_entry[key] = model[key]
            compat = model_entry.get("compat")
            if isinstance(compat, dict):
                # resolved.json 给 dsh 插件消费，compat 直接给目标键名（camelCase）
                model_entry["compat"] = to_target_compat(compat)
            models[str(model["id"])] = model_entry
        entry["models"] = models
        out[provider_id] = entry
    return {"disabled_providers": disabled, "providers": out}


def dump_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2) + "\n"


def write_or_check(target: Path, content: str, check: bool) -> bool:
    if check:
        if not target.is_file():
            print(f"跳过比对（目标不存在）：{target}")
            return True
        actual = target.read_text(encoding="utf-8")
        if actual != content:
            diff = difflib.unified_diff(
                actual.splitlines(),
                content.splitlines(),
                fromfile=str(target),
                tofile="（重新生成的结果）",
                lineterm="",
            )
            print(f"生成物与 models.toml 不一致：{target}", file=sys.stderr)
            print("\n".join(diff), file=sys.stderr)
            return False
        print(f"一致：{target}")
        return True
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    print(f"已生成：{target}")
    return True


def find_repo_root() -> Path:
    """从 cwd 与脚本位置向上找仓库根（含 dot_agents_meow/models/models.toml 与 .git）。"""
    for start in (Path.cwd().resolve(), Path(__file__).resolve().parent):
        for candidate in (start, *start.parents):
            if (candidate / "dot_agents_meow" / "models" / "models.toml").is_file() and (candidate / ".git").exists():
                return candidate
    sys.exit("找不到仓库根；请在仓库内运行，或用 --toml/--pi-out/--models-out 显式指定路径")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--toml", help="models.toml 路径（默认仓库源）")
    parser.add_argument("--pi-out", help="Pi 两个 JSON 的输出目录（默认 <仓库>/dot_pi/agent）")
    parser.add_argument("--models-out", help="resolved.json 输出目录（默认 ~/.agents_meow/models）")
    parser.add_argument("--check", action="store_true", help="只校验与比对，不写入")
    args = parser.parse_args()

    repo = find_repo_root()
    toml_path = Path(args.toml) if args.toml else repo / "dot_agents_meow" / "models" / "models.toml"
    if not toml_path.is_file():
        sys.exit(f"找不到 {toml_path}")
    pi_dir = Path(args.pi_out) if args.pi_out else repo / "dot_pi" / "agent"
    models_dir = Path(args.models_out) if args.models_out else Path.home() / ".agents_meow" / "models"

    try:
        disabled, providers = load_config(toml_path)
    except ConfigError as error:
        print(f"models.toml 校验失败：{error}", file=sys.stderr)
        return 1

    outputs = (
        (pi_dir / "models-dev.json", dump_json(to_pi_models_dev(disabled, providers))),
        (pi_dir / "models.json", dump_json(to_pi_models(disabled, providers))),
        (models_dir / "resolved.json", dump_json(to_resolved(disabled, providers))),
    )
    ok = True
    for target, content in outputs:
        if args.check and not target.is_file():
            print(f"跳过比对（目标不存在）：{target}")
            continue
        ok = write_or_check(target, content, args.check) and ok
    if args.check:
        print(
            f"校验通过：{len(providers)} 个 provider、"
            f"{sum(len(p['models']) for p in providers.values())} 个模型条目、{len(disabled)} 项禁用"
        )
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())

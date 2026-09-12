#!/usr/bin/env python3
"""从 .pi 的 models.json 生成 dsh 的 llm-pi-ai 路由片段。

源：dot_pi/agent/models.json 的 command-code provider（Pi 自定义模型源）。
产物：dot_dsh/generated/llm-pi-ai.route.yml，被 dot_dsh/cordis.patch.yml.tmpl
include 进 home 级 cordis patch，不直接部署。

字段映射：
- provider 级：api / baseUrl / compat 直映；apiKeyEnv 固定为 COMMAND_CODE_API_KEY。
- 模型级：id / name / contextWindow / maxTokens / input 直映；
  thinkingLevelMap 非空项转 reasoningEfforts；
  reasoning=false 写 reasoningEfforts: false；
  reasoning=true 且无映射时省略 reasoningEfforts（不做档位外推）。
- cost 价格元数据在 dsh 无对应字段，不迁移。

用法：
  python3 dot_agents_meow/scripts/gen-dsh-llm-route.py            # 重新生成
  python3 dot_agents_meow/scripts/gen-dsh-llm-route.py --check    # 只校验一致性
"""

from __future__ import annotations

import argparse
import difflib
import json
import sys
from pathlib import Path

try:
    import yaml
except ImportError:  # pragma: no cover - 环境缺依赖时的明确报错
    sys.exit("需要 PyYAML：请先安装（如 python3-yaml / pip install pyyaml）后重试")

PROVIDER_KEY = "command-code"
ROUTE_KEY = "command-code"
PROVIDER_LABEL = "Command Code"
API_KEY_ENV = "COMMAND_CODE_API_KEY"
SRC_REL = Path("dot_pi/agent/models.json")
OUT_REL = Path("dot_dsh/generated/llm-pi-ai.route.yml")

LEVEL_ORDER = ("off", "minimal", "low", "medium", "high", "xhigh", "max")

HEADER = """\
# 本文件由 dot_agents_meow/scripts/gen-dsh-llm-route.py 生成，请勿手改。
# 源：dot_pi/agent/models.json 的 command-code provider。
# 已知差异：cost 价格元数据在 dsh 无对应字段，不迁移；
# reasoning=true 且无 thinkingLevelMap 的模型省略 reasoningEfforts。
"""


def find_repo_root(explicit: str | None) -> Path:
    """定位仓库根：显式参数优先，其次从 cwd 向上找源文件。"""
    candidates: list[Path] = []
    if explicit:
        candidates.append(Path(explicit).expanduser().resolve())
    candidates.append(Path.cwd().resolve())
    candidates.append(Path(__file__).resolve().parent)
    for start in candidates:
        for candidate in (start, *start.parents):
            if (candidate / SRC_REL).is_file() and (candidate / ".git").exists():
                return candidate
    sys.exit(
        f"未找到仓库根（需同时含 {SRC_REL} 与 .git）；请在仓库内运行，"
        "或用 --repo 指定仓库路径"
    )


def convert_model(model: dict) -> dict:
    """把一条 Pi 模型条目转换为 dsh route 模型条目。"""
    entry: dict = {"id": model["id"]}
    if model.get("name"):
        entry["name"] = model["name"]
    for key in ("contextWindow", "maxTokens"):
        if key in model:
            entry[key] = model[key]
    if "input" in model:
        entry["input"] = list(model["input"])

    if model.get("reasoning") is False:
        entry["reasoningEfforts"] = False
    else:
        mapping = model.get("thinkingLevelMap") or {}
        efforts = {
            level: value for level, value in mapping.items() if value is not None
        }
        if efforts:
            ordered = {
                level: efforts[level]
                for level in LEVEL_ORDER
                if level in efforts
            }
            entry["reasoningEfforts"] = ordered
    return entry


def build_document(models_json: dict) -> str:
    """生成完整的 YAML 片段文本（含头注释）。"""
    source = models_json["providers"][PROVIDER_KEY]
    route: dict = {"apiKeyEnv": API_KEY_ENV, "displayName": PROVIDER_LABEL}
    for key in ("api", "baseUrl"):
        if key in source:
            # dsh 侧拼写为 baseURL
            route["baseURL" if key == "baseUrl" else key] = source[key]
    if source.get("compat"):
        route["compat"] = source["compat"]
    route["models"] = [convert_model(model) for model in source["models"]]

    document = [{"id": "llm-pi-ai", "config": {"providers": {ROUTE_KEY: route}}}]
    body = yaml.safe_dump(
        document,
        sort_keys=False,
        allow_unicode=True,
        default_flow_style=False,
        width=4096,
    )
    text = HEADER + body
    if "{{" in text:
        sys.exit("生成内容包含 chezmoi 模板定界符 {{，需调整生成器或源数据")
    return text


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", help="仓库根路径（默认从 cwd 向上探测）")
    parser.add_argument("--check", action="store_true", help="只校验，不写入")
    args = parser.parse_args()

    root = find_repo_root(args.repo)
    src = root / SRC_REL
    out = root / OUT_REL

    with src.open(encoding="utf-8") as handle:
        models_json = json.load(handle)
    expected = build_document(models_json)
    count = len(models_json["providers"][PROVIDER_KEY]["models"])

    if args.check:
        if not out.is_file():
            print(f"缺少生成物：{OUT_REL}；请运行生成器后重新提交", file=sys.stderr)
            return 1
        actual = out.read_text(encoding="utf-8")
        if actual != expected:
            diff = difflib.unified_diff(
                actual.splitlines(),
                expected.splitlines(),
                fromfile=str(out.relative_to(root)),
                tofile="（重新生成的结果）",
                lineterm="",
            )
            print(
                "生成物与 models.json 不一致；请运行 "
                "python3 dot_agents_meow/scripts/gen-dsh-llm-route.py 后重新提交",
                file=sys.stderr,
            )
            print("\n".join(diff), file=sys.stderr)
            return 1
        print(f"生成物一致（{count} 个模型）")
        return 0

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(expected, encoding="utf-8")
    print(f"已生成 {OUT_REL}（{count} 个模型）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

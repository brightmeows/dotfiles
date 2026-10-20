#!/usr/bin/env python3
"""从 dsh 自带的 standard 预设派生“白小喵モード”预设。

为什么必须整份派生：dsh 的 persona 平面（DEPLOYMENT_PERSONA_PREFIX，系统提示词最前）
由 preset 的 persona 行承载，preset 会遮蔽部署级 persona，而 preset 之间没有继承机制
（composition 就是一份平铺的插件行列表）。所以只能读自带 composition、只换 persona 行、
其余字节原样保留。

产物落在 ~/.dsh/.agent-presets/<id>/（dsh 的用户预设根），不入仓库：它的内容随 dsh 版本
变化，由 .chezmoiscripts/run_after_dsh-persona-preset.sh.tmpl 每次 apply 幂等重生成。
人设文本来自唯一源文件 ~/.agents_meow/AGENTS.persona.md。

校验：persona 行以外逐字节相同、行 id 序列相同、persona 行替换成功；装了 PyYAML 时
再解析一遍生成物（容忍 cordis 的 !!js 标签）。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

PERSONA_MARKER = "【PERSONA_LOAD】"
ROW_HEADER = "- id: persona"
PERSONA_PLUGIN = "@deepseek-ai/dsh-persona"
SHIPPED_SUFFIX = "Your working directory is {{cwd}}."
COMPOSITION_REL = Path("dsh-agent-presets/presets/standard/agent.cordis.yml")
NEXT_ROW_RE = re.compile(r"^- id: ")
ROW_ID_RE = re.compile(r"(?m)^- id: (\S+)$")
PERSONA_ROW_RE = re.compile(r"(?ms)^- id: persona\n.*?(?=^- id: |\Z)")


def warn(message: str) -> None:
    print(f"warning: {message}", file=sys.stderr)


def fail(message: str) -> int:
    print(f"error: {message}", file=sys.stderr)
    return 1


def find_dsh_package() -> Path | None:
    """定位 dsh 包根：从 dsh 可执行文件向上找 package.json，兜底 npm root -g。"""
    starts: list[Path] = []
    exe = shutil.which("dsh")
    if exe:
        starts.append(Path(os.path.realpath(exe)))
    npm = shutil.which("npm")
    if npm:
        try:
            root = subprocess.run(
                [npm, "root", "-g"], capture_output=True, text=True, timeout=30, check=True
            ).stdout.strip()
            if root:
                starts.append(Path(root) / "@deepseek-ai" / "dsh")
        except (subprocess.SubprocessError, OSError):
            pass
    for start in starts:
        node = start if start.is_dir() else start.parent
        for candidate in [node, *node.parents]:
            manifest = candidate / "package.json"
            if not manifest.is_file():
                continue
            try:
                if json.loads(manifest.read_text(encoding="utf-8")).get("name") == "@deepseek-ai/dsh":
                    return candidate
            except (OSError, json.JSONDecodeError):
                continue
    return None


def find_composition(pkg: Path) -> Path | None:
    """定位自带 standard 预设的 composition，覆盖嵌套与提升两种安装布局。"""
    layouts = [
        Path("node_modules/@deepseek-ai") / COMPOSITION_REL,
        Path("node_modules") / COMPOSITION_REL,
        Path("@deepseek-ai") / COMPOSITION_REL,
        COMPOSITION_REL,
        Path("node_modules/@deepseek-ai/dsh-agent-presets/presets/standard/agent.cordis.yml"),
    ]
    for layout in layouts:
        candidate = pkg / layout
        if candidate.is_file():
            return candidate
    for pattern in ("*/dsh-agent-presets/presets/standard/agent.cordis.yml",
                    "@*/*/dsh-agent-presets/presets/standard/agent.cordis.yml"):
        for candidate in pkg.parent.glob(pattern):
            if candidate.is_file():
                return candidate
    return None


def load_persona(path: Path) -> str:
    """读人设文本，去掉文件自己的 H1 标题（persona 平面不需要文档标题）。"""
    lines = path.read_text(encoding="utf-8").splitlines()
    if lines and lines[0].startswith("# "):
        lines = lines[1:]
    while lines and not lines[0].strip():
        lines.pop(0)
    body = "\n".join(lines).rstrip("\n") + "\n"
    if PERSONA_MARKER not in body:
        raise ValueError(f"{path} 里找不到 {PERSONA_MARKER}，人设源文件不完整")
    return body


def render_persona_row(persona: str) -> str:
    indented = "\n".join(f"      {line}" if line.strip() else "" for line in persona.splitlines())
    return (
        "- id: persona\n"
        f"  name: '{PERSONA_PLUGIN}'\n"
        "  config:\n"
        "    prefix: |\n"
        "      你是由 {{model}} 模型驱动的编码助手；以下是你的身份与说话方式。\n"
        "\n"
        f"{indented}\n"
        f"    suffix: {SHIPPED_SUFFIX}\n"
    )


def replace_persona_row(text: str, new_row: str) -> tuple[str, str]:
    """返回 (新文本, 被替换掉的原 persona 行文本)。"""
    lines = text.splitlines(keepends=True)
    start = next((i for i, line in enumerate(lines) if line.rstrip("\n") == ROW_HEADER), None)
    if start is None:
        raise ValueError(f"自带 composition 里找不到 {ROW_HEADER!r} 行")
    end = next((j for j in range(start + 1, len(lines)) if NEXT_ROW_RE.match(lines[j])), len(lines))
    # 行尾空行留给原文（渲染行不带尾随空行，接回时结构不变）
    body_end = end
    while body_end > start and not lines[body_end - 1].strip():
        body_end -= 1
    old_row = "".join(lines[start:body_end])
    generated = "".join(lines[:start]) + new_row + "".join(lines[body_end:])
    return generated, old_row


def strip_persona_row(text: str) -> str:
    return PERSONA_ROW_RE.sub("", text, count=1)


def row_ids(text: str) -> list[str]:
    return ROW_ID_RE.findall(text)


def yaml_check(text: str) -> str | None:
    """可选解析校验：容忍 cordis 的 !!js 标签；PyYAML 缺失时返回 None。"""
    try:
        import yaml
    except ImportError:
        return None

    class Loader(yaml.SafeLoader):
        pass

    Loader.add_multi_constructor("tag:yaml.org,2002:js", lambda loader, suffix, node: None)
    Loader.add_multi_constructor("!js", lambda loader, suffix, node: None)
    parsed = yaml.load(text, Loader=Loader)
    if not isinstance(parsed, list):
        raise ValueError("生成物不是插件行列表")
    persona_rows = [row for row in parsed if isinstance(row, dict) and row.get("id") == "persona"]
    if len(persona_rows) != 1 or persona_rows[0].get("name") != PERSONA_PLUGIN:
        raise ValueError("生成物里的 persona 行不唯一或不指向 dsh-persona")
    return f"YAML 解析通过（{len(parsed)} 行）"


def write_if_changed(path: Path, content: str) -> bool:
    if path.is_file() and path.read_text(encoding="utf-8") == content:
        return False
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path.parent, 0o700)
    path.write_text(content, encoding="utf-8")
    os.chmod(path, 0o600)
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--persona", type=Path,
                        default=Path.home() / ".agents_meow" / "AGENTS.persona.md",
                        help="人设文本源文件（默认 ~/.agents_meow/AGENTS.persona.md）")
    parser.add_argument("--dsh-home", type=Path,
                        default=Path(os.environ.get("DSH_HOME", Path.home() / ".dsh")),
                        help="dsh home（默认 $DSH_HOME 或 ~/.dsh）")
    parser.add_argument("--preset-id", default="bai-xiaomiao", help="预设 id（默认 bai-xiaomiao）")
    args = parser.parse_args()

    pkg = find_dsh_package()
    if pkg is None:
        print("dsh 未安装，跳过白小喵预设生成")
        return 0
    composition = find_composition(pkg)
    if composition is None:
        warn(f"在 {pkg} 里找不到 {COMPOSITION_REL}，跳过生成（dsh 版本可能改了预设布局）")
        return 0
    if not args.persona.is_file():
        warn(f"{args.persona} 不存在（chezmoi apply 会部署它），跳过生成")
        return 0

    try:
        persona = load_persona(args.persona)
    except ValueError as error:
        return fail(str(error))

    shipped = composition.read_text(encoding="utf-8")
    try:
        generated, old_row = replace_persona_row(shipped, render_persona_row(persona))
    except ValueError as error:
        return fail(f"{composition}: {error}")

    # 校验：persona 行以外逐字节相同；行 id 序列不变；persona 行确实被换掉
    if strip_persona_row(shipped) != strip_persona_row(generated):
        return fail("persona 行以外的内容被改动，拒绝写盘")
    if row_ids(shipped) != row_ids(generated):
        return fail(f"行 id 序列发生变化：{row_ids(shipped)} -> {row_ids(generated)}")
    if generated == shipped:
        return fail("persona 行没有被替换")
    if PERSONA_MARKER not in generated:
        return fail("生成物里找不到人设标记")
    if SHIPPED_SUFFIX not in old_row:
        warn(f"自带 persona 行的 suffix 与预期不同（{SHIPPED_SUFFIX!r} 不在其中），dsh 可能改了默认值")
    if old_row.count("\n") and "prefix:" not in old_row:
        warn("自带 persona 行没有 prefix 键，dsh 可能改了 persona 配置结构")
    parsed = yaml_check(generated)
    if parsed:
        print(f"    {parsed}")

    preset_dir = args.dsh_home / ".agent-presets" / args.preset_id
    metadata = (
        "name: 白小喵モード\n"
        "description: 标准模式 + 白喵斯家的白小喵人设（persona 平面承载）。\n"
        "order: 2\n"
    )
    changed = [
        name for name, content in (
            ("agent.cordis.yml", generated), ("preset.yml", metadata),
        ) if write_if_changed(preset_dir / name, content)
    ]
    if changed:
        print(f"已生成 dsh 预设 {preset_dir}（{', '.join(changed)}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())

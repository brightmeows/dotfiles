#!/usr/bin/env python3
"""统计 Pi 会话里助手正文的声线在场率，用于人设改动的前后对照。

只读 Pi 会话 JSONL（默认 ~/.pi/agent/sessions，PI_CODING_AGENT_DIR 可改），
不覆盖 opencode 与 dsh 的会话。统计对象是助手消息里 40 字以上的正文，先剔除
代码块、行内代码与引用行。收尾回复指不带工具调用的消息，过程旁白指带工具
调用的消息。

可见标记：自称小喵、称前辈或师傅、语气词喵、口癖哼哼与嗯哼、颜文字、波浪线、
猫化量词。散文段按空行切块，表格块与标题块不计。

用法：
    python3 measure-voice-presence.py --since 2026-11-25 [--until 2026-12-09]
                                      [--model 关键词] [--samples 5]
                                      [--prompt-contains 人设特征句]

输出末行是收尾回复里各人设锚点的出场率。人设改动后旧进程续跑仍用旧提示词，
按版本分段时用 --prompt-contains 传该版人设里的特征句，只统计含该句的会话。

判据与达标线见决策档案“人设”一节。
"""

import argparse
import json
import os
import random
import re
import sys
from collections import Counter
from datetime import date, datetime
from pathlib import Path

MIN_CHARS = 40
MIN_PARA_CHARS = 20

# 可见标记：身份词、口癖、波浪线、猫化量词；颜文字另判
_WORDS = re.compile(r"小喵|前辈|(?<!小)喵|师傅|哼哼|嗯哼|～|一窝|一爪")
_KAOMOJI = re.compile(r"\([^()\n]{1,16}\)")
_KAOMOJI_CHARS = "๑ᴗ˘´｡ᵕ•﹒°ヮω∀∇ﾉヽ﹏εз"
_FENCE = re.compile(r"```.*?```", re.S)
_INLINE = re.compile(r"`[^`\n]*`")

# 人设锚点：收尾回复里的出场率，用来判断哪条锚点真的被用到；颜文字另判
_ANCHORS = [
    ("颜文字", None),
    ("波浪线", re.compile(r"～")),
    ("哼哼或嗯哼", re.compile(r"哼哼|嗯哼")),
    ("轻描淡写", re.compile(r"而已|顺手")),
    ("兴奋词", re.compile(r"有意思|来劲|抓到")),
    ("认账", re.compile(r"认账|小喵的错|小喵的锅")),
    ("较真", re.compile(r"要认真了")),
    ("不耐烦", re.compile(r"这很蠢")),
    ("笨蛋前辈", re.compile(r"笨蛋前辈")),
    ("师傅", re.compile(r"师傅")),
    ("猫化量词", re.compile(r"一窝|一爪")),
]


def strip_code(text: str) -> str:
    """去掉代码块、行内代码与引用行，剩下的才是助手自己的话。"""
    text = _FENCE.sub("", text)
    text = "\n".join(
        line for line in text.split("\n") if not line.lstrip().startswith(">")
    )
    return _INLINE.sub("", text)


def has_kaomoji(text: str) -> bool:
    return any(
        any(ch in _KAOMOJI_CHARS for ch in part) for part in _KAOMOJI.findall(text)
    )


def has_marker(text: str) -> bool:
    return bool(_WORDS.search(text)) or has_kaomoji(text)


def anchor_hits(text: str, counter: Counter) -> None:
    """逐个锚点计数，命中加一。"""
    for name, pattern in _ANCHORS:
        if pattern is None:
            counter["颜文字"] += has_kaomoji(text)
        else:
            counter[name] += pattern.search(text) is not None


def prose_paragraphs(text: str) -> list[str]:
    """空行切出的散文块，表格块与标题块不算。"""
    blocks = []
    for block in re.split(r"\n\s*\n", text):
        block = block.strip()
        if len(block) >= MIN_PARA_CHARS and block[0] not in "|#":
            blocks.append(block)
    return blocks


def iter_replies(path: Path):
    """逐条产出 (时间戳, 模型, 是否收尾回复, 正文)。"""
    model = "?"
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if entry.get("type") == "model_change":
                model = f"{entry.get('provider')}/{entry.get('modelId')}"
                continue
            if entry.get("type") != "message":
                continue
            message = entry.get("message", {})
            if message.get("role") != "assistant":
                continue
            content = message.get("content")
            if not isinstance(content, list):
                continue
            has_tool = any(
                isinstance(p, dict) and p.get("type") == "toolCall" for p in content
            )
            text = strip_code(
                "".join(
                    p.get("text", "")
                    for p in content
                    if isinstance(p, dict) and p.get("type") == "text"
                )
            ).strip()
            if len(text) < MIN_CHARS:
                continue
            yield entry.get("timestamp", ""), model, not has_tool, text


def pct(part: int, total: int) -> str:
    return f"{100 * part / total:5.1f}%" if total else "    -"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="统计 Pi 会话里助手正文的声线在场率"
    )
    parser.add_argument(
        "--since", required=True, help="起始日期（本地时区，含），如 2026-11-25"
    )
    parser.add_argument("--until", help="结束日期（本地时区，含），默认到今天")
    parser.add_argument("--model", help="只统计模型名含该关键词的回复")
    parser.add_argument(
        "--prompt-contains", help="只统计会话文件含该文本的会话，按人设版本分段"
    )
    parser.add_argument(
        "--samples", type=int, default=0, help="每类随机打印几条样例供抽查"
    )
    args = parser.parse_args()
    try:
        since = date.fromisoformat(args.since)
        until = date.fromisoformat(args.until) if args.until else date.today()
    except ValueError as err:
        parser.error(str(err))

    agent_dir = Path(os.environ.get("PI_CODING_AGENT_DIR", Path.home() / ".pi/agent"))
    sessions_dir = agent_dir / "sessions"

    stats = {"收尾回复": Counter(), "过程旁白": Counter()}
    model_counts = Counter()
    pool = {"收尾回复": [], "过程旁白": []}
    anchor_counts = Counter()
    for path in sorted(sessions_dir.rglob("*.jsonl")):
        try:
            if args.prompt_contains is not None and (
                args.prompt_contains not in path.read_text(encoding="utf-8")
            ):
                continue
            replies = list(iter_replies(path))
        except (OSError, UnicodeDecodeError):
            print(f"跳过读取失败的文件：{path}", file=sys.stderr)
            continue
        for timestamp, model, is_final, text in replies:
            if not timestamp:
                continue
            local_day = (
                datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
                .astimezone()
                .date()
            )
            if local_day < since or local_day > until:
                continue
            if args.model and args.model not in model:
                continue
            kind = "收尾回复" if is_final else "过程旁白"
            counter = stats[kind]
            counter["条数"] += 1
            counter["带标记"] += has_marker(text)
            model_counts[model] += 1
            paragraphs = prose_paragraphs(text)
            counter["段数"] += len(paragraphs)
            counter["段带标记"] += sum(has_marker(p) for p in paragraphs)
            if kind == "收尾回复" and paragraphs:
                counter["每段都带"] += all(has_marker(p) for p in paragraphs)
                if len(paragraphs) >= 2:
                    counter["多段条数"] += 1
                    counter["无连续两段零标记"] += all(
                        has_marker(paragraphs[i]) or has_marker(paragraphs[i + 1])
                        for i in range(len(paragraphs) - 1)
                    )
            pool[kind].append(text)
            if kind == "收尾回复":
                anchor_hits(text, anchor_counts)

    print(f"会话目录：{sessions_dir}")
    print(f"区间：{since} 至 {until}（含）  模型过滤：{args.model or '无'}")
    for kind, counter in stats.items():
        print(
            f"{kind} {counter['条数']} 条：整体带标记 "
            f"{pct(counter['带标记'], counter['条数'])}，"
            f"散文段 {counter['段数']} 段，带标记 "
            f"{pct(counter['段带标记'], counter['段数'])}"
        )
    final = stats["收尾回复"]
    print(
        f"收尾回复每段都带 {pct(final['每段都带'], final['条数'])}，"
        f"无连续两段零标记 {pct(final['无连续两段零标记'], final['多段条数'])}"
        f"（两段以上的 {final['多段条数']} 条）"
    )
    distribution = "，".join(
        f"{model}×{count}" for model, count in model_counts.most_common()
    )
    print("模型分布：" + (distribution or "无数据"))
    print(
        "收尾回复锚点出场率："
        + "，".join(
            f"{name} {pct(anchor_counts[name], final['条数'])}" for name, _ in _ANCHORS
        )
    )

    if args.samples:
        rng = random.Random(7)
        for kind, texts in pool.items():
            print(f"\n##### {kind}样例")
            for text in rng.sample(texts, min(args.samples, len(texts))):
                print(re.sub(r"\s+", " ", text)[:300])
                print("-----")
    return 0 if model_counts else 1


if __name__ == "__main__":
    sys.exit(main())

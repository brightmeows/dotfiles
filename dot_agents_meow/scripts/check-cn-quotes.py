#!/usr/bin/env python3
"""检查简体中文 Markdown 文本的引号规范（GB/T 15834-2011）。

扫描非代码块、非行内代码中的直引号、全角无向引号与直角引号——
这些字符在简体中文横排中均不合规（规则见 AGENTS.main.md「中文引号」节）。

用法：
    python3 check-cn-quotes.py 文件.md [更多文件.md ...]
"""

import re
import sys

# 违规字符：直引号 U+0022/U+0027、全角无向引号 U+FF02、直角引号 U+300C-300F
_BAD_QUOTES = "[\u0022\u0027\uFF02\u300C\u300D\u300E\u300F]"


def check_file(path: str) -> int:
    in_code = False
    violations = 0
    with open(path, encoding="utf-8") as fh:
        for i, line in enumerate(fh, 1):
            if re.match(r"^(```|~~~)", line):
                in_code = not in_code
                continue
            if in_code:
                continue
            # 行内代码（反引号包裹）视为代码字符串，跳过
            text = re.sub(r"`[^`]*`", "", line)
            if re.search(_BAD_QUOTES, text):
                print(f"{path}:{i}: {line.rstrip()}")
                violations += 1
    return violations


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    total = sum(check_file(path) for path in sys.argv[1:])
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main())

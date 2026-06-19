#!/usr/bin/env python3
"""
Clippy lint information query tool.

Parses the Clippy lint documentation HTML page and filters by
name, group, level, version, and applicability.

Cache is auto-managed at /tmp/clippy-lints-<VER>.html.

  # First run auto-downloads and caches (~3s)
  python3 clippy-lint-query.py --group pedantic

  # Subsequent queries reuse cache (instant)
  python3 clippy-lint-query.py --search needless_return --docs

  # Force re-download
  python3 clippy-lint-query.py --fetch --group correctness --table

Usage:
  # All pedantic lints
  python3 clippy-lint-query.py --group pedantic --table

  # Search + full docs
  python3 clippy-lint-query.py --search needless_return --docs

  # Combined with version filter
  python3 clippy-lint-query.py --group correctness --level deny --since 1.60

  # Specific clippy version docs
  python3 clippy-lint-query.py --version 1.80 --search vec_box

  # JSON output
  python3 clippy-lint-query.py --group suspicious --level warn --json

  # Custom cache path
  python3 clippy-lint-query.py --cache ./my-copy.html --list

  # Force re-download
  python3 clippy-lint-query.py --fetch --group pedantic
"""

import argparse
import json
import os
import re
import sys
import urllib.request
from html.parser import HTMLParser

BASE_URL = "https://rust-lang.github.io/rust-clippy"
DEFAULT_CACHE_DIR = "/tmp"


def resolve_url(version):
    """Convert a version string to a full URL."""
    if not version or version == "stable":
        return f"{BASE_URL}/stable/"
    elif version == "master":
        return f"{BASE_URL}/master/"
    elif version.startswith("rust-"):
        return f"{BASE_URL}/{version}/"
    else:
        # Normalize version like "1.80" or "1.80.0"
        v = version.strip().lstrip("v")
        if re.match(r'^\d+\.\d+(\.\d+)?$', v):
            return f"{BASE_URL}/rust-{v}/"
        else:
            raise ValueError(f"Unknown version: {version!r}")


def default_cache_path(version):
    """Return default cache path for a given version."""
    v = version or "stable"
    safe = v.replace("/", "_").replace(".", "_")
    return os.path.join(DEFAULT_CACHE_DIR, f"clippy-lints-{safe}.html")


def fetch_html(url):
    """Download the Clippy lint page."""
    print(f"Downloading {url} ...", file=sys.stderr)
    req = urllib.request.Request(url, headers={
        "User-Agent": "clippy-lint-query/2.0",
        "Accept": "text/html",
    })
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8")


def read_html(path):
    """Read HTML from a local file."""
    with open(path, "r") as f:
        return f.read()


def save_cache(html, path):
    """Save HTML to cache file."""
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w") as f:
        f.write(html)
    print(f"Cached to {path}", file=sys.stderr)


# ── Parser ──────────────────────────────────────────────────────────

class ClippyLint:
    """Represents a single Clippy lint with all its metadata."""

    def __init__(self):
        self.id = ""
        self.group = ""
        self.level = ""
        self.version = ""
        self.applicability = ""
        self.docs_text = ""

    def matches(self, search=None, group=None, level=None,
                applicability=None, since=None, until=None):
        """Check if this lint matches all specified filters."""
        if search:
            s = search.lower().replace("-", "_")
            if s not in self.id.lower():
                return False
        if group and self.group.lower() != group.lower():
            return False
        if level and self.level.lower() != level.lower():
            return False
        if applicability and self.applicability.lower() != applicability.lower():
            return False
        if since:
            ver = self._version_num()
            if ver is not None and ver < since:
                return False
        if until:
            ver = self._version_num()
            if ver is not None and ver > until:
                return False
        return True

    def _version_num(self):
        m = re.search(r'(\d+)\.(\d+)', self.version)
        if m:
            return float(f"{m.group(1)}.{m.group(2)}")
        return None

    def to_dict(self, include_docs=False):
        d = {
            "id": self.id,
            "group": self.group,
            "level": self.level,
            "version": self.version,
            "applicability": self.applicability,
        }
        if include_docs:
            d["docs"] = self.docs_text
        return d

    def format_short(self):
        return f"{self.id:<40} {self.level:<8} {self.group:<14} {self.version:<10} {self.applicability}"

    def format_docs(self):
        lines = [
            f"{'=' * 60}",
            f"  {self.id}",
            f"{'=' * 60}",
            f"  Group:         {self.group}",
            f"  Level:         {self.level}",
            f"  Version:       {self.version}",
            f"  Applicability: {self.applicability}",
            f"{'-' * 60}",
            self.docs_text,
            f"{'=' * 60}",
        ]
        return "\n".join(lines)


class ClippyPageParser(HTMLParser):
    """Parses the Clippy lint documentation HTML page."""

    def __init__(self):
        super().__init__()
        self.lints = []
        self._current = None
        self._in_article = False
        self._in_lint_docs = False
        self._in_doc_md = False
        self._in_additional_info = False
        self._tag_stack = []
        self._skip_tags = {"script", "style", "noscript"}

    def handle_starttag(self, tag, attrs):
        attrs_dict = dict(attrs)

        if tag in self._skip_tags:
            self._tag_stack.append(tag)
        if self._tag_stack:
            return

        if tag == "article" and "id" in attrs_dict:
            self._current = ClippyLint()
            self._current.id = attrs_dict["id"]
            self._in_article = True
        elif self._in_article and tag == "div" and "class" in attrs_dict:
            classes = attrs_dict["class"].split()
            if "lint-docs" in classes:
                self._in_lint_docs = True
            elif self._in_lint_docs and "lint-doc-md" in classes:
                self._in_doc_md = True
            elif self._in_lint_docs and "lint-additional-info" in classes:
                self._in_additional_info = True
        elif self._in_article and tag == "span" and "class" in attrs_dict:
            classes = attrs_dict["class"].split()
            for cls in classes:
                if cls.startswith("group-"):
                    self._current.group = cls[len("group-"):]
                elif cls.startswith("level-"):
                    self._current.level = cls[len("level-"):]
                elif cls == "applicability":
                    self._tag_stack.append("applicability_val")
                elif cls == "label-version":
                    self._tag_stack.append("version_val")

    def handle_endtag(self, tag):
        if self._tag_stack:
            top = self._tag_stack.pop()
            if top == tag or tag in self._skip_tags or top in ("version", "version_val", "applicability_val"):
                pass
            else:
                self._tag_stack.append(top)
            return

        if self._in_article and tag == "article":
            if self._current:
                self._current.docs_text = self._current.docs_text.strip()
                self.lints.append(self._current)
            self._current = None
            self._in_article = False
            self._in_lint_docs = False
            self._in_doc_md = False
            self._in_additional_info = False
        elif self._in_doc_md and tag == "div":
            self._in_doc_md = False
        elif self._in_lint_docs and tag == "div":
            if self._in_additional_info:
                self._in_additional_info = False
            else:
                self._in_lint_docs = False

    def handle_data(self, data):
        if self._tag_stack:
            tag_ctx = self._tag_stack[-1]
            if tag_ctx == "applicability_val":
                stripped = data.strip()
                if stripped:
                    self._current.applicability = stripped
            elif tag_ctx == "version_val":
                stripped = data.strip()
                if stripped:
                    self._current.version = stripped
            return
        if self._in_doc_md:
            self._current.docs_text += data

    def handle_entityref(self, name):
        if self._in_doc_md:
            char = {"amp": "&", "lt": "<", "gt": ">",
                    "quot": '"', "apos": "'"}.get(name, f"&{name};")
            self._current.docs_text += char


def parse_lints(html):
    parser = ClippyPageParser()
    parser.feed(html)
    return parser.lints


# ── CLI ─────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Query Clippy lint information from the official documentation page.")

    # Input source (priority: --cache > default cache > download)
    parser.add_argument("--version", metavar="VER", default="stable",
                        help="Clippy docs version: 'stable', 'master', or '1.80' (default: stable)")
    parser.add_argument("--cache", metavar="FILE",
                        help=f"Cache file path (default: {DEFAULT_CACHE_DIR}/clippy-lints-<VER>.html)")
    parser.add_argument("--fetch", action="store_true",
                        help="Force re-download and update cache")

    # Filters
    parser.add_argument("--search", metavar="NAME",
                        help="Filter by lint name (substring match)")
    parser.add_argument("--group", metavar="GROUP",
                        help="Filter by group (pedantic, correctness, etc.)")
    parser.add_argument("--level", metavar="LEVEL",
                        help="Filter by level (allow, warn, deny, none)")
    parser.add_argument("--applicability", metavar="VAL",
                        help="Filter by applicability (MachineApplicable, etc.)")
    parser.add_argument("--since", type=float, metavar="VER",
                        help="Minimum version (e.g. 1.60)")
    parser.add_argument("--until", type=float, metavar="VER",
                        help="Maximum version (e.g. 1.70)")

    # Output
    parser.add_argument("--docs", action="store_true",
                        help="Show full documentation")
    parser.add_argument("--table", action="store_true",
                        help="Output as text table")
    parser.add_argument("--json", action="store_true",
                        help="Output as JSON lines")
    parser.add_argument("--list", action="store_true",
                        help="List all matching lints (alias for --table)")

    args = parser.parse_args()

    # ── Step 1: Get HTML ────────────────────────────────────────
    url = resolve_url(args.version)
    cache_path = args.cache or default_cache_path(args.version)

    # Priority: --cache > default cache > download
    html = None
    source = ""

    if args.cache or (os.path.exists(cache_path) and not args.fetch):
        path = args.cache if args.cache else cache_path
        html = read_html(path)
        source = path
    else:
        html = fetch_html(url)
        source = url
        save_cache(html, cache_path)

    print(f"Reading from {source}", file=sys.stderr)

    # ── Step 2: Parse ───────────────────────────────────────────
    lints = parse_lints(html)
    print(f"Parsed {len(lints)} lints", file=sys.stderr)

    # ── Step 3: Filter ──────────────────────────────────────────
    matched = [
        l for l in lints
        if l.matches(
            search=args.search,
            group=args.group,
            level=args.level,
            applicability=args.applicability,
            since=args.since,
            until=args.until,
        )
    ]
    print(f"Matched {len(matched)} lints", file=sys.stderr)

    # ── Step 4: Output ──────────────────────────────────────────
    if not matched:
        sys.exit(1)

    use_table = args.table or args.list or not (args.json or args.docs)

    if args.json:
        for lint in matched:
            print(json.dumps(lint.to_dict(include_docs=args.docs)))
    elif args.docs:
        for lint in matched:
            print(lint.format_docs())
            print()
    elif use_table:
        print(f"{'Lint':<40} {'Level':<8} {'Group':<14} {'Version':<10} {'Applicability'}")
        print("-" * 90)
        for lint in matched:
            print(lint.format_short())


if __name__ == "__main__":
    main()

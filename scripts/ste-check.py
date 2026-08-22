#!/usr/bin/env python3
"""Check Markdown prose against the writing rules in AGENTS.md.

The rules come from ASD-STE100 Simplified Technical English. This checker
covers the mechanical subset only: word bans, sentence length, and paragraph
length. It does not judge vocabulary, because the approved word list lives in
the paid standard and a guess produces false positives.

Exempt from every check: fenced code blocks, indented code, headings, tables,
link reference definitions, and HTML comments.

To exempt one line, put this on the line before it:

    <!-- ste-ignore-next-line -->

Usage: scripts/ste-check.py [path ...]
Default paths: AGENTS.md CLAUDE.md .omp/RULES.md .omp/AGENTS.md .omp/agents .omp/commands
Exit code 0 means no violation. Exit code 1 means at least one violation.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

DESCRIPTIVE_MAX_WORDS = 25
PROCEDURAL_MAX_WORDS = 20
PARAGRAPH_MAX_SENTENCES = 6

IGNORE_MARKER = "<!-- ste-ignore-next-line -->"

# Each pattern carries the reason and the replacement to write instead.
BANNED = [
    (r"\bshould\b", "banned modal: write must, or delete the sentence"),
    (r"\bwould\b", "banned modal: write will"),
    (r"\bmay\b", "banned modal: write can or must"),
    (r"\bmight\b", "banned modal: write can"),
    (r"\bcould\b", "banned modal: write can"),
    (r"\bhas been\b", "present perfect: write the simple past"),
    (r"\bhave been\b", "present perfect: write the simple past"),
    (r"\bhad been\b", "past perfect: write the simple past"),
    (r"\bis being\b", "progressive: write the simple present"),
    (r"\bare being\b", "progressive: write the simple present"),
    (r", making\b", "-ing clause: write a new sentence"),
    (r", allowing\b", "-ing clause: write a new sentence"),
    (r", ensuring\b", "-ing clause: write a new sentence"),
    (r", enabling\b", "-ing clause: write a new sentence"),
    (r"\bsimply\b", "empty word: delete it"),
    (r"\bseamless", "empty word: delete it"),
    (r"\brobust\b", "empty word: name the property instead"),
    (r"\bpowerful\b", "empty word: delete it"),
    (r"\bcomprehensive\b", "empty word: delete it"),
    (r"\bleverage\b", "write use"),
    (r"\bin order to\b", "write to"),
    (r"\bit is worth noting\b", "delete it and state the fact"),
    (r"\butiliz", "write use"),
    (r"\bprior to\b", "write before"),
    (r"\bin the event that\b", "write if"),
    (r"\be\.g\.", "write for example"),
    (r"\bi\.e\.", "write that is"),
    (r"\b\w+n't\b", "contraction: write the full form"),
    (r"\b(?:it|that|there|he|she|who|what)'s\b",
     "contraction: write the full form"),
    (r"\b(?:we|you|they|I)'(?:re|ve|ll|d)\b",
     "contraction: write the full form"),
]

# A sentence that starts with one of these is an instruction, so the shorter
# limit applies. The list holds the verbs this repo's documents actually use.
IMPERATIVE_VERBS = {
    "add", "always", "attach", "build", "call", "change", "check", "choose",
    "copy", "create", "delete", "do", "edit", "fix", "give", "install",
    "keep", "list", "make", "move", "name", "never", "open", "pick", "point",
    "put", "read", "register", "remove", "rename", "repoint", "replace",
    "restore", "return", "run", "set", "start", "stop", "use", "verify",
    "wipe", "write",
}

CODE_FENCE = re.compile(r"^\s*(?:```|~~~)")
HEADING = re.compile(r"^\s*#")
TABLE_ROW = re.compile(r"^\s*\|")
LINK_DEF = re.compile(r"^\s*\[[^\]]+\]:")
LIST_MARKER = re.compile(r"^\s*(?:[-*+]|\d+\.)\s+")
INLINE_CODE = re.compile(r"`[^`]*`")
LINK_TEXT = re.compile(r"\[([^\]]*)\]\([^)]*\)")
SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")


def prose_lines(text: str) -> list[tuple[int, str]]:
    """Return the prose lines of a Markdown file, with 1-based line numbers."""
    out: list[tuple[int, str]] = []
    in_fence = False
    skip_next = False
    for number, raw in enumerate(text.split("\n"), start=1):
        if CODE_FENCE.match(raw):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        if IGNORE_MARKER in raw:
            skip_next = True
            continue
        if skip_next:
            skip_next = False
            continue
        if HEADING.match(raw) or TABLE_ROW.match(raw) or LINK_DEF.match(raw):
            continue
        if raw.startswith("    ") or raw.startswith("\t"):
            continue
        if raw.strip().startswith("<!--"):
            continue
        out.append((number, raw))
    return out


def strip_code(line: str) -> str:
    """Remove inline code and link targets, which are exempt."""
    line = INLINE_CODE.sub(" CODE ", line)
    return LINK_TEXT.sub(r"\1", line)


def count_words(sentence: str) -> int:
    return len([w for w in sentence.split() if w.strip()])


def is_imperative(sentence: str) -> bool:
    words = sentence.split()
    if not words:
        return False
    first = words[0].strip("`*_\"'(").lower()
    return first in IMPERATIVE_VERBS


def check_file(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    problems: list[str] = []
    lines = prose_lines(text)

    for number, raw in lines:
        line = strip_code(raw)
        for pattern, reason in BANNED:
            match = re.search(pattern, line, re.IGNORECASE)
            if match:
                problems.append(
                    f"{path}:{number}: {reason} (found {match.group(0)!r})"
                )
        if ";" in line:
            problems.append(
                f"{path}:{number}: semicolon in prose: write two sentences"
            )

    # Sentence length. A list item is one instruction, so it is measured on
    # its own rather than joined with its neighbours.
    for number, raw in lines:
        body = strip_code(LIST_MARKER.sub("", raw)).strip()
        if not body:
            continue
        for sentence in SENTENCE_SPLIT.split(body):
            sentence = sentence.strip()
            if not sentence:
                continue
            words = count_words(sentence)
            if is_imperative(sentence):
                if words > PROCEDURAL_MAX_WORDS:
                    problems.append(
                        f"{path}:{number}: instruction of {words} words, "
                        f"limit {PROCEDURAL_MAX_WORDS}: split it"
                    )
            elif words > DESCRIPTIVE_MAX_WORDS:
                problems.append(
                    f"{path}:{number}: description of {words} words, "
                    f"limit {DESCRIPTIVE_MAX_WORDS}: split it"
                )

    # Paragraph length, counted over runs of plain prose lines.
    numbers = [n for n, _ in lines]
    paragraph: list[str] = []
    start = 0
    previous = None
    for number, raw in lines:
        body = raw.strip()
        breaks = (
            previous is not None and number != previous + 1
        ) or not body or LIST_MARKER.match(raw) or body.startswith(">")
        if breaks:
            if paragraph:
                joined = " ".join(paragraph)
                total = len(
                    [s for s in SENTENCE_SPLIT.split(joined) if s.strip()]
                )
                if total > PARAGRAPH_MAX_SENTENCES:
                    problems.append(
                        f"{path}:{start}: paragraph of {total} sentences, "
                        f"limit {PARAGRAPH_MAX_SENTENCES}: split it"
                    )
            paragraph = []
        if body and not LIST_MARKER.match(raw) and not body.startswith(">"):
            if not paragraph:
                start = number
            paragraph.append(strip_code(body))
        previous = number
    if paragraph:
        joined = " ".join(paragraph)
        total = len([s for s in SENTENCE_SPLIT.split(joined) if s.strip()])
        if total > PARAGRAPH_MAX_SENTENCES:
            problems.append(
                f"{path}:{start}: paragraph of {total} sentences, "
                f"limit {PARAGRAPH_MAX_SENTENCES}: split it"
            )

    _ = numbers
    return problems


def collect(paths: list[str]) -> list[Path]:
    files: list[Path] = []
    for name in paths:
        path = Path(name)
        if path.is_dir():
            files.extend(sorted(path.rglob("*.md")))
        elif path.is_file():
            files.append(path)
    return files


def main() -> int:
    paths = sys.argv[1:] or ["AGENTS.md", "CLAUDE.md", ".omp/RULES.md", ".omp/AGENTS.md", ".omp/agents", ".omp/commands"]
    files = collect(paths)
    if not files:
        print("ste-check: no Markdown file found", file=sys.stderr)
        return 1

    problems: list[str] = []
    for path in files:
        problems.extend(check_file(path))

    for problem in problems:
        print(problem)

    checked = len(files)
    if problems:
        print(
            f"\nste-check: {len(problems)} violations in {checked} files",
            file=sys.stderr,
        )
        return 1
    print(f"ste-check: {checked} files clean")
    return 0


if __name__ == "__main__":
    sys.exit(main())

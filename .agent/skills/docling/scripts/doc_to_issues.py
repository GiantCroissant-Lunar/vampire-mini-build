#!/usr/bin/env python3
"""Convert a document to structured markdown sections suitable for GitHub issues.

Usage:
    python doc_to_issues.py <input-path-or-url> [--output-dir DIR] [--min-section-lines N]

Converts the document via Docling, splits by top-level headings, and writes
each section as a separate markdown file ready to be used as issue body text.
"""

import argparse
import re
import subprocess
import sys
from pathlib import Path


def ensure_docling():
    """Install docling if not available."""
    try:
        import docling  # noqa: F401
    except ImportError:
        print("Installing docling...")
        subprocess.check_call(
            [sys.executable, "-m", "pip", "install", "--quiet", "docling"]
        )


def convert_to_markdown(source: str) -> str:
    """Convert a document source to markdown."""
    from docling.document_converter import DocumentConverter

    converter = DocumentConverter()
    doc = converter.convert(source).document
    return doc.export_to_markdown()


def split_sections(markdown: str, min_lines: int = 3) -> list[dict]:
    """Split markdown into sections by top-level headings."""
    sections = []
    current_title = "Untitled"
    current_lines = []

    for line in markdown.split("\n"):
        heading_match = re.match(r"^(#{1,2})\s+(.+)$", line)
        if heading_match:
            # Save previous section
            if current_lines and len(current_lines) >= min_lines:
                sections.append(
                    {"title": current_title, "body": "\n".join(current_lines).strip()}
                )
            current_title = heading_match.group(2).strip()
            current_lines = []
        else:
            current_lines.append(line)

    # Save last section
    if current_lines and len(current_lines) >= min_lines:
        sections.append(
            {"title": current_title, "body": "\n".join(current_lines).strip()}
        )

    return sections


def slugify(text: str) -> str:
    """Convert text to a filename-safe slug."""
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower())
    return slug.strip("-")[:60]


def main():
    parser = argparse.ArgumentParser(description="Convert document to issue-ready sections")
    parser.add_argument("source", help="File path or URL to convert")
    parser.add_argument("--output-dir", default="/tmp/docling-issues", help="Output directory")
    parser.add_argument("--min-section-lines", type=int, default=3, help="Minimum lines per section")
    args = parser.parse_args()

    ensure_docling()

    print(f"Converting: {args.source}")
    markdown = convert_to_markdown(args.source)

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Write full markdown
    full_path = output_dir / "full.md"
    full_path.write_text(markdown, encoding="utf-8")
    print(f"Full markdown: {full_path}")

    # Split into sections
    sections = split_sections(markdown, args.min_section_lines)
    print(f"Found {len(sections)} sections")

    for i, section in enumerate(sections):
        slug = slugify(section["title"])
        path = output_dir / f"{i:02d}-{slug}.md"
        content = f"# {section['title']}\n\n{section['body']}"
        path.write_text(content, encoding="utf-8")
        print(f"  [{i}] {section['title']} -> {path.name}")

    print(f"\nDone. Files in: {output_dir}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Extract Li Lu PDFs, split into ~3000-char chunks, save as GBrain-compatible markdown files."""
import re
import os
import sys
import pymupdf  # fitz

LILU_DIR = os.path.join(os.path.dirname(__file__), "../data/documents/raw/master/lilu")
OUT_DIR = "/tmp/lilu_import"

PDF_META = {
    "civilization-modernization-value-investing-china.pdf": {
        "slug_prefix": "lilu_book",
        "title": "文明、现代化、价值投资与中国",
        "year": "2020",
        "type": "book",
    },
    "global-value-investing-2024.pdf": {
        "slug_prefix": "lilu_gvi2024",
        "title": "全球价值投资演讲 2024",
        "year": "2024",
        "type": "speech",
    },
    "modernization-full-2014.pdf": {
        "slug_prefix": "lilu_mod2014",
        "title": "现代化演讲全文 2014",
        "year": "2014",
        "type": "speech",
    },
    "modernization-us-china.pdf": {
        "slug_prefix": "lilu_modcn",
        "title": "现代化与中美关系",
        "year": "2021",
        "type": "speech",
    },
    "value-investing-china-2015.pdf": {
        "slug_prefix": "lilu_vi2015",
        "title": "价值投资在中国 2015",
        "year": "2015",
        "type": "speech",
    },
}

CHUNK_SIZE = 3000
CHUNK_OVERLAP = 0


def extract_text(pdf_path: str) -> str:
    doc = pymupdf.open(pdf_path)
    pages = []
    for page in doc:
        text = page.get_text("text")
        if text.strip():
            pages.append(text)
    return "\n\n".join(pages)


def split_chunks(text: str, size: int = CHUNK_SIZE) -> list[str]:
    # Split on paragraph boundaries first
    paragraphs = re.split(r"\n[ \t]*\n", text)
    chunks = []
    current = ""
    for para in paragraphs:
        para = para.strip()
        if not para:
            continue
        if len(current) + len(para) + 2 <= size:
            current = (current + "\n\n" + para).strip() if current else para
        else:
            if current:
                chunks.append(current)
            # If single para exceeds size, split by sentence/char
            if len(para) > size:
                while len(para) > size:
                    chunks.append(para[:size])
                    para = para[size:]
                if para:
                    current = para
            else:
                current = para
    if current:
        chunks.append(current)
    return [c for c in chunks if len(c.strip()) > 50]


def frontmatter(meta: dict, title_suffix: str = "") -> str:
    title = meta["title"] + (f" — {title_suffix}" if title_suffix else "")
    return (
        "---\n"
        f'title: "{title}"\n'
        f'master: lilu\n'
        f'year: "{meta["year"]}"\n'
        f'type: {meta["type"]}\n'
        "---\n\n"
    )


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    total_files = 0

    for filename, meta in PDF_META.items():
        pdf_path = os.path.join(LILU_DIR, filename)
        if not os.path.exists(pdf_path):
            print(f"SKIP (not found): {filename}", file=sys.stderr)
            continue

        print(f"Extracting {filename}...")
        text = extract_text(pdf_path)
        chunks = split_chunks(text)
        print(f"  → {len(chunks)} chunks")

        prefix = meta["slug_prefix"]
        for i, chunk in enumerate(chunks, 1):
            fname = f"{prefix}_{i:03d}.md"
            path = os.path.join(OUT_DIR, fname)
            part_label = f"第 {i} 部分，共 {len(chunks)} 部分"
            with open(path, "w", encoding="utf-8") as f:
                f.write(frontmatter(meta, part_label if len(chunks) > 1 else ""))
                f.write(chunk)
            total_files += 1

    print(f"\nDone: {total_files} files → {OUT_DIR}")


if __name__ == "__main__":
    main()

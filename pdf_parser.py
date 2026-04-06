"""PDF Parser — extract text and metadata from PDF files."""

import argparse
import json
import sys
from pathlib import Path

from PyPDF2 import PdfReader


def extract_text(pdf_path: str) -> str:
    """Extract all text from a PDF file.

    Args:
        pdf_path: Path to the PDF file.

    Returns:
        The concatenated text of every page.
    """
    reader = PdfReader(pdf_path)
    pages_text = []
    for page in reader.pages:
        text = page.extract_text()
        if text:
            pages_text.append(text)
    return "\n".join(pages_text)


def extract_text_by_page(pdf_path: str) -> list[str]:
    """Extract text from a PDF file, returning a list with one entry per page.

    Args:
        pdf_path: Path to the PDF file.

    Returns:
        A list of strings, one per page.
    """
    reader = PdfReader(pdf_path)
    return [page.extract_text() or "" for page in reader.pages]


def extract_metadata(pdf_path: str) -> dict:
    """Extract metadata from a PDF file.

    Args:
        pdf_path: Path to the PDF file.

    Returns:
        A dictionary of metadata fields (title, author, subject, etc.).
    """
    reader = PdfReader(pdf_path)
    meta = reader.metadata
    if meta is None:
        return {}
    return {
        "title": meta.title,
        "author": meta.author,
        "subject": meta.subject,
        "creator": meta.creator,
        "producer": meta.producer,
        "num_pages": len(reader.pages),
    }


def get_num_pages(pdf_path: str) -> int:
    """Return the number of pages in a PDF file.

    Args:
        pdf_path: Path to the PDF file.

    Returns:
        The page count.
    """
    reader = PdfReader(pdf_path)
    return len(reader.pages)


def _validate_pdf_path(pdf_path: str) -> None:
    """Raise an error if the path does not point to a readable PDF."""
    path = Path(pdf_path)
    if not path.exists():
        raise FileNotFoundError(f"File not found: {pdf_path}")
    if not path.is_file():
        raise ValueError(f"Not a file: {pdf_path}")
    if path.suffix.lower() != ".pdf":
        raise ValueError(f"File does not have a .pdf extension: {pdf_path}")


def main() -> None:
    """CLI entry-point for the PDF parser."""
    parser = argparse.ArgumentParser(
        description="Parse a PDF file and extract text or metadata."
    )
    parser.add_argument("pdf", help="Path to the PDF file")
    parser.add_argument(
        "--metadata",
        action="store_true",
        help="Print metadata instead of text",
    )
    parser.add_argument(
        "--pages",
        action="store_true",
        help="Print text separated by page",
    )
    args = parser.parse_args()

    try:
        _validate_pdf_path(args.pdf)
    except (FileNotFoundError, ValueError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)

    if args.metadata:
        meta = extract_metadata(args.pdf)
        print(json.dumps(meta, indent=2, default=str))
    elif args.pages:
        for i, text in enumerate(extract_text_by_page(args.pdf), start=1):
            print(f"--- Page {i} ---")
            print(text)
            print()
    else:
        print(extract_text(args.pdf))


if __name__ == "__main__":
    main()

# TESTPDF

A simple Python utility to parse PDF files and extract text and metadata.

## Setup

```bash
pip install -r requirements.txt
```

## Usage

### Command Line

```bash
# Extract all text from a PDF
python pdf_parser.py document.pdf

# Extract text page by page
python pdf_parser.py document.pdf --pages

# Extract metadata (title, author, page count, etc.)
python pdf_parser.py document.pdf --metadata
```

### As a Library

```python
from pdf_parser import extract_text, extract_text_by_page, extract_metadata, get_num_pages

# Get all text as a single string
text = extract_text("document.pdf")

# Get text as a list (one entry per page)
pages = extract_text_by_page("document.pdf")

# Get metadata dictionary
meta = extract_metadata("document.pdf")

# Get page count
num_pages = get_num_pages("document.pdf")
```

## API

| Function | Description |
|---|---|
| `extract_text(pdf_path)` | Returns all text from the PDF as a single string |
| `extract_text_by_page(pdf_path)` | Returns a list of strings, one per page |
| `extract_metadata(pdf_path)` | Returns a dict with title, author, subject, creator, producer, and page count |
| `get_num_pages(pdf_path)` | Returns the number of pages |
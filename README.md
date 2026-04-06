# TESTPDF — ICC Profile Checker

A Python tool that reads PDF metadata and detects embedded ICC color profiles.

## Requirements

- Python 3.10+
- [pikepdf](https://pikepdf.readthedocs.io/) (`pip install pikepdf`)

## Usage

```bash
pip install pikepdf
python check_icc_profile.py <path_to_pdf>
```

### Example output (PDF with ICC profile)

```
============================================================
PDF Metadata for: sample.pdf
============================================================
  /Title: My Document
  /Producer: pikepdf
  Pages: 3
  PDF version: 1.7

============================================================
ICC Profile Check
============================================================
  ✅ Found 1 embedded ICC profile(s):

  Profile #1
    Source          : page_resource
    Page            : 1
    ColorSpace name : /CS1
    Components (/N) : 3
    Stream length   : 3144 bytes

============================================================
```

### Example output (PDF without ICC profile)

```
============================================================
ICC Profile Check
============================================================
  ❌ No embedded ICC profiles found in this PDF.
============================================================
```

## What it checks

| Location | Description |
|---|---|
| Page `/ColorSpace` resources | `/ICCBased` arrays on each page |
| Document root `/ColorSpace` | Rare but valid location for shared color spaces |
| `/OutputIntents` | ICC profiles in PDF/X and PDF/A output intents |
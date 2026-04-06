#!/usr/bin/env python3
"""
Read PDF metadata and check whether the PDF contains embedded ICC profiles.

Usage:
    python check_icc_profile.py <path_to_pdf>

This script:
  1. Extracts and prints general PDF metadata (title, author, creator, etc.).
  2. Scans all pages and resources for embedded ICC profile color spaces
     (/ICCBased entries in /ColorSpace resources).
  3. Reports whether any ICC profiles were found, along with details
     (number of color components, stream length).
"""

import sys
import os

import pikepdf


def get_metadata(pdf: pikepdf.Pdf) -> dict:
    """Return a dict of document-level metadata from the PDF Info dictionary."""
    info: dict = {}
    if pdf.docinfo:
        for key, value in pdf.docinfo.items():
            info[key] = str(value)
    return info


def find_icc_profiles(pdf: pikepdf.Pdf) -> list[dict]:
    """Walk every page's resources looking for /ICCBased color-space streams.

    Returns a list of dicts, each describing one embedded ICC profile found.
    """
    profiles: list[dict] = []
    seen_objgen: set[tuple[int, int]] = set()  # avoid reporting the same stream twice

    for page_num, page in enumerate(pdf.pages, start=1):
        resources = page.get("/Resources")
        if resources is None:
            continue

        color_spaces = resources.get("/ColorSpace")
        if color_spaces is None:
            continue

        for cs_name, cs_value in color_spaces.items():
            _collect_icc(cs_value, page_num, str(cs_name), profiles, seen_objgen)

    # Also scan the root /ColorSpace in the document catalog (rare but possible)
    root_cs = pdf.Root.get("/ColorSpace")
    if root_cs is not None:
        for cs_name, cs_value in root_cs.items():
            _collect_icc(cs_value, 0, str(cs_name), profiles, seen_objgen)

    # Scan /OutputIntents for ICC profiles (common in PDF/X, PDF/A)
    output_intents = pdf.Root.get("/OutputIntents")
    if output_intents is not None:
        for idx, intent in enumerate(output_intents):
            dest_profile = intent.get("/DestOutputProfile")
            if dest_profile is not None and isinstance(dest_profile, pikepdf.Stream):
                objgen = (dest_profile.objgen[0], dest_profile.objgen[1])
                if objgen not in seen_objgen:
                    seen_objgen.add(objgen)
                    n = int(intent.get("/N")) if "/N" in intent else None
                    length = len(dest_profile.read_bytes())
                    profiles.append({
                        "source": f"OutputIntent[{idx}]",
                        "page": "document-level",
                        "color_space_name": str(intent.get("/OutputConditionIdentifier", "N/A")),
                        "num_components": n,
                        "stream_length": length,
                    })

    return profiles


def _collect_icc(
    cs_value,
    page_num: int,
    cs_name: str,
    profiles: list[dict],
    seen_objgen: set[tuple[int, int]],
) -> None:
    """If *cs_value* is (or contains) an /ICCBased array, record the profile."""
    if not isinstance(cs_value, pikepdf.Array):
        return
    if len(cs_value) < 2:
        return
    if str(cs_value[0]) != "/ICCBased":
        return

    stream = cs_value[1]
    if not isinstance(stream, pikepdf.Stream):
        return

    objgen = (stream.objgen[0], stream.objgen[1])
    if objgen in seen_objgen:
        return
    seen_objgen.add(objgen)

    n = int(stream.get("/N", 0))
    length = len(stream.read_bytes())
    profiles.append({
        "source": "page_resource",
        "page": page_num,
        "color_space_name": cs_name,
        "num_components": n,
        "stream_length": length,
    })


def main() -> None:
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <path_to_pdf>")
        sys.exit(1)

    pdf_path = sys.argv[1]
    if not os.path.isfile(pdf_path):
        print(f"Error: file not found: {pdf_path}")
        sys.exit(1)

    with pikepdf.open(pdf_path) as pdf:
        # ── Metadata ──────────────────────────────────────────────
        print("=" * 60)
        print(f"PDF Metadata for: {pdf_path}")
        print("=" * 60)

        metadata = get_metadata(pdf)
        if metadata:
            for key, value in metadata.items():
                print(f"  {key}: {value}")
        else:
            print("  (no document-info metadata found)")

        print(f"  Pages: {len(pdf.pages)}")
        print(f"  PDF version: {pdf.pdf_version}")

        # ── ICC Profiles ──────────────────────────────────────────
        print()
        print("=" * 60)
        print("ICC Profile Check")
        print("=" * 60)

        profiles = find_icc_profiles(pdf)

        if profiles:
            print(f"  ✅ Found {len(profiles)} embedded ICC profile(s):\n")
            for i, p in enumerate(profiles, start=1):
                print(f"  Profile #{i}")
                print(f"    Source          : {p['source']}")
                print(f"    Page            : {p['page']}")
                print(f"    ColorSpace name : {p['color_space_name']}")
                if p["num_components"] is not None:
                    print(f"    Components (/N) : {p['num_components']}")
                print(f"    Stream length   : {p['stream_length']} bytes")
                print()
        else:
            print("  ❌ No embedded ICC profiles found in this PDF.")

        print("=" * 60)


if __name__ == "__main__":
    main()

/**
 * PDF Deep Analyzer
 *
 * Parses raw PDF bytes to extract detailed metadata including:
 * - Embedded fonts (name, type, encoding, subset status)
 * - ICC color profiles (version, color space, description)
 * - Spot / separation colors
 * - Color spaces used in the document
 */

"use strict";

const zlib = require("zlib");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read a big-endian uint32 from a buffer at the given offset.
 */
function readUint32BE(buf, offset) {
  return (
    ((buf[offset] << 24) |
      (buf[offset + 1] << 16) |
      (buf[offset + 2] << 8) |
      buf[offset + 3]) >>>
    0
  );
}

/**
 * Convert a 4-byte signature to an ASCII string.
 */
function sig(buf, offset) {
  return String.fromCharCode(
    buf[offset],
    buf[offset + 1],
    buf[offset + 2],
    buf[offset + 3]
  );
}

// ---------------------------------------------------------------------------
// ICC Profile parser (minimal – extracts header fields + description tag)
// ---------------------------------------------------------------------------

function parseICCProfile(buf) {
  if (buf.length < 128) return null;

  const profileSize = readUint32BE(buf, 0);
  const preferredCMM = sig(buf, 4).trim();
  const versionMajor = buf[8];
  const versionMinor = (buf[9] >> 4) & 0xf;
  const versionBugfix = buf[9] & 0xf;
  const deviceClass = sig(buf, 12).trim();
  const colorSpace = sig(buf, 16).trim();
  const pcs = sig(buf, 20).trim();
  const platform = sig(buf, 40).trim();
  const manufacturer = sig(buf, 48).trim();
  const model = sig(buf, 52).trim();
  const renderingIntent = readUint32BE(buf, 64);

  const intentNames = [
    "Perceptual",
    "Media-Relative Colorimetric",
    "Saturation",
    "ICC-Absolute Colorimetric",
  ];

  const colorSpaceNames = {
    XYZ: "CIE XYZ",
    Lab: "CIE Lab",
    Luv: "CIE Luv",
    YCbr: "YCbCr",
    Yxy: "CIE Yxy",
    RGB: "RGB",
    GRAY: "Grayscale",
    HSV: "HSV",
    HLS: "HLS",
    CMYK: "CMYK",
    CMY: "CMY",
    "2CLR": "2 Color",
    "3CLR": "3 Color",
    "4CLR": "4 Color",
    "5CLR": "5 Color",
    "6CLR": "6 Color",
    "7CLR": "7 Color",
    "8CLR": "8 Color",
  };

  const classNames = {
    scnr: "Input (Scanner)",
    mntr: "Display (Monitor)",
    prtr: "Output (Printer)",
    link: "Device Link",
    spac: "Color Space Conversion",
    abst: "Abstract",
    nmcl: "Named Color",
  };

  // Try to read the 'desc' tag for a human-readable description
  let description = "";
  const tagCount = readUint32BE(buf, 128);
  for (let i = 0; i < tagCount && 132 + i * 12 + 12 <= buf.length; i++) {
    const tagSig = sig(buf, 132 + i * 12);
    const tagOffset = readUint32BE(buf, 132 + i * 12 + 4);
    const tagSize = readUint32BE(buf, 132 + i * 12 + 8);

    if (tagSig === "desc" && tagOffset + 12 < buf.length) {
      const typeSig = sig(buf, tagOffset);
      if (typeSig === "desc") {
        const strLen = readUint32BE(buf, tagOffset + 8);
        const end = Math.min(tagOffset + 12 + strLen - 1, buf.length);
        description = buf.slice(tagOffset + 12, end).toString("ascii").replace(/\0/g, "");
      } else if (typeSig === "mluc") {
        // Multi-localized Unicode
        const recCount = readUint32BE(buf, tagOffset + 8);
        if (recCount > 0 && tagOffset + 28 < buf.length) {
          const strLength = readUint32BE(buf, tagOffset + 20);
          const strOffset = readUint32BE(buf, tagOffset + 24);
          const start = tagOffset + strOffset;
          const end = Math.min(start + strLength, buf.length);
          const raw = buf.slice(start, end);
          description = "";
          for (let j = 1; j < raw.length; j += 2) {
            const c = raw[j];
            if (c > 0) description += String.fromCharCode(c);
          }
        }
      }
    }
  }

  return {
    profileSize,
    version: `${versionMajor}.${versionMinor}.${versionBugfix}`,
    preferredCMM: preferredCMM || undefined,
    deviceClass: classNames[deviceClass] || deviceClass,
    colorSpace: colorSpaceNames[colorSpace] || colorSpace,
    pcs: colorSpaceNames[pcs] || pcs,
    platform: platform || undefined,
    manufacturer: manufacturer || undefined,
    model: model || undefined,
    renderingIntent: intentNames[renderingIntent] || `Unknown (${renderingIntent})`,
    description: description || undefined,
  };
}

// ---------------------------------------------------------------------------
// Raw PDF token scanner
// ---------------------------------------------------------------------------

/**
 * Decompress all FlateDecode streams in the PDF and return a combined text
 * representation that includes both the raw PDF text and the decompressed
 * stream contents.  This allows regex scanning to find objects that live
 * inside compressed object streams (ObjStm).
 */
function decompressStreams(buffer) {
  const latin1 = buffer.toString("latin1");
  const parts = [latin1]; // start with the raw text

  // Find all stream…endstream blocks
  const streamRe = /stream\r?\n/g;
  let match;
  while ((match = streamRe.exec(latin1)) !== null) {
    const dataStart = match.index + match[0].length;
    // Look backwards for /Filter /FlateDecode (within ~500 chars of dict)
    const dictSnippet = latin1.substring(Math.max(0, match.index - 500), match.index);
    const isFlate = /\/Filter\s*(?:\/FlateDecode|\[\s*\/FlateDecode\s*\])/.test(dictSnippet);
    if (!isFlate) continue;

    // Find the endstream marker
    const endIdx = latin1.indexOf("endstream", dataStart);
    if (endIdx === -1) continue;

    // Extract the raw bytes (latin1 preserves byte values)
    const raw = Buffer.from(latin1.substring(dataStart, endIdx), "latin1");
    try {
      const inflated = zlib.inflateSync(raw);
      parts.push(inflated.toString("latin1"));
    } catch {
      // Some streams may use other filters or be corrupt – skip
    }
  }

  return parts.join("\n");
}

/**
 * Scan the raw PDF text for font references, ICC streams, and spot colours.
 *
 * This is a *pragmatic* approach: instead of fully parsing the cross-reference
 * table and object tree, we use regex patterns that reliably match the way
 * popular PDF producers emit these structures.  It covers the vast majority of
 * real-world PDFs while keeping the code small and dependency-free.
 */
function analyzePDFBuffer(buffer) {
  const text = decompressStreams(buffer);

  /**
   * Decode PDF hex-encoded name tokens (#XX → character).
   * Does NOT use decodeURIComponent to avoid throwing on invalid sequences.
   */
  function decodePDFName(raw) {
    return raw.replace(/#([0-9A-Fa-f]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
  }

  // ---- Fonts ---------------------------------------------------------------
  const fonts = [];
  const fontsSeen = new Set();

  // Pattern: /BaseFont /SomeName  or  /BaseFont (SomeName)
  // Use indexOf-based scanning to avoid ReDoS with regex alternation
  const BASEFONT_MARKER = "/BaseFont";
  let searchPos = 0;
  let m;
  while (true) {
    const idx = text.indexOf(BASEFONT_MARKER, searchPos);
    if (idx === -1) break;
    searchPos = idx + BASEFONT_MARKER.length;

    // Skip optional whitespace (0 or 1 char) and optional leading /
    let pos = searchPos;
    if (pos < text.length && (text[pos] === " " || text[pos] === "\t" || text[pos] === "\n" || text[pos] === "\r")) pos++;
    if (pos < text.length && text[pos] === "/") pos++;

    // Read the font name token
    let name;
    if (pos < text.length && text[pos] === "(") {
      // Parenthesized name
      const end = text.indexOf(")", pos + 1);
      if (end === -1) continue;
      name = text.substring(pos + 1, end);
    } else {
      // Regular name token – read until delimiter
      const start = pos;
      while (pos < text.length && !/[\s/<>\[\]()]/.test(text[pos])) pos++;
      if (pos === start) continue;
      name = text.substring(start, pos);
    }

    name = name.replace(/^\//, "");
    if (!name || fontsSeen.has(name)) continue;
    fontsSeen.add(name);

    const isSubset = /^[A-Z]{6}\+/.test(name);
    const baseName = isSubset ? name.replace(/^[A-Z]{6}\+/, "") : name;

    // Determine type by looking nearby for /Subtype
    let type = "Unknown";
    const nearby = text.substring(
      Math.max(0, idx - 300),
      Math.min(text.length, idx + 300)
    );
    if (/\/Subtype\s*\/Type1C?\b/.test(nearby)) type = "Type 1";
    else if (/\/Subtype\s*\/TrueType\b/.test(nearby)) type = "TrueType";
    else if (/\/Subtype\s*\/CIDFontType0\b/.test(nearby)) type = "CIDFont (Type 1)";
    else if (/\/Subtype\s*\/CIDFontType2\b/.test(nearby)) type = "CIDFont (TrueType)";
    else if (/\/Subtype\s*\/Type3\b/.test(nearby)) type = "Type 3";
    else if (/\/Subtype\s*\/OpenType\b/.test(nearby)) type = "OpenType";
    else if (/\/Subtype\s*\/Type0\b/.test(nearby)) type = "Type 0 (Composite)";

    // Encoding
    let encoding = "Default";
    const encMatch = nearby.match(/\/Encoding\s*\/?([^\s/<>\[\]]+)/);
    if (encMatch) encoding = encMatch[1];

    // Embedded?
    const embedded =
      /\/FontDescriptor\b/.test(nearby) &&
      (/\/FontFile\b/.test(nearby) ||
        /\/FontFile2\b/.test(nearby) ||
        /\/FontFile3\b/.test(nearby));

    fonts.push({
      name,
      baseName,
      type,
      encoding,
      subset: isSubset,
      embedded,
    });
  }

  // ---- ICC Profiles --------------------------------------------------------
  const iccProfiles = [];

  // ICC profiles live inside stream objects whose dictionary contains /N and
  // often /Filter /FlateDecode.  We try to decompress and parse them.
  const iccStreamRe = /\/ICCBased\s+(\d+)\s+(\d+)\s+R/g;
  const iccRefIds = new Set();
  while ((m = iccStreamRe.exec(text)) !== null) {
    iccRefIds.add(`${m[1]} ${m[2]}`);
  }

  // Scan the *original* (non-decompressed) buffer for stream objects containing ICC data.
  // Use indexOf-based scanning instead of a single greedy regex to avoid ReDoS.
  const rawText = buffer.toString("latin1");
  {
    let objSearch = 0;
    const OBJ_MARKER = " obj";
    while (true) {
      const objIdx = rawText.indexOf(OBJ_MARKER, objSearch);
      if (objIdx === -1) break;
      objSearch = objIdx + OBJ_MARKER.length;

      // Extract the object number pair before " obj"
      const lineStart = rawText.lastIndexOf("\n", objIdx);
      const prefix = rawText.substring(lineStart + 1, objIdx).trim();
      const idMatch = prefix.match(/^(\d+)\s+(\d+)$/);
      if (!idMatch) continue;

      // Find the matching endobj
      const endIdx = rawText.indexOf("endobj", objSearch);
      if (endIdx === -1) break;

      const objText = rawText.substring(lineStart + 1, endIdx + 6);
      objSearch = endIdx + 6;

      const objId = `${idMatch[1]} ${idMatch[2]}`;
      const isICC = iccRefIds.has(objId) || /\/ICCBased/.test(objText);
      if (!isICC) continue;

      // Try to extract and optionally decompress the stream
      const streamStart = objText.indexOf("stream");
      if (streamStart === -1) continue;

      let dataStart = streamStart + 6;
      if (
        objText.charCodeAt(dataStart) === 0x0d &&
        objText.charCodeAt(dataStart + 1) === 0x0a
      )
        dataStart += 2;
      else if (
        objText.charCodeAt(dataStart) === 0x0a ||
        objText.charCodeAt(dataStart) === 0x0d
      )
        dataStart += 1;

      const endStream = objText.indexOf("endstream", dataStart);
      if (endStream === -1) continue;

      let raw = Buffer.from(objText.substring(dataStart, endStream), "latin1");

      // Try decompression if FlateDecode
      if (/\/Filter\s*(?:\/FlateDecode|\[\s*\/FlateDecode\s*\])/.test(objText)) {
        try {
          raw = zlib.inflateSync(raw);
        } catch {
          // fall through to try parsing as-is
        }
      }

      // Check for ICC magic: bytes 36-39 should be 'acsp'
      if (raw.length >= 128 && sig(raw, 36) === "acsp") {
        const profile = parseICCProfile(raw);
        if (profile) {
          iccProfiles.push(profile);
          continue;
        }
      }

      // If we couldn't parse the profile binary, report what we can from the dict
      const nMatch = objText.match(/\/N\s+(\d+)/);
      if (nMatch) {
        const components = parseInt(nMatch[1], 10);
        const csMap = { 1: "Grayscale", 3: "RGB", 4: "CMYK" };
        iccProfiles.push({
          colorSpace: csMap[components] || `${components}-component`,
          note: "Profile stream could not be fully parsed",
        });
      }
    }
  }

  // ---- Spot / Separation Colors -------------------------------------------
  const spotColors = [];
  const spotSeen = new Set();

  // /Separation /ColorName /AlternateCS ...
  const sepRe = /\/Separation\s*\/([^\s/<>\[\]]+)/g;
  while ((m = sepRe.exec(text)) !== null) {
    let name = decodePDFName(m[1]);
    if (!spotSeen.has(name)) {
      spotSeen.add(name);

      // Look for the alternate color space nearby
      const nearby = text.substring(m.index, Math.min(text.length, m.index + 500));
      let alternate = "Unknown";
      const altMatch = nearby.match(
        /\/Separation\s*\/[^\s]+\s*\/?(DeviceCMYK|DeviceRGB|DeviceGray|ICCBased|Lab)/
      );
      if (altMatch) alternate = altMatch[1];

      spotColors.push({ name, alternateSpace: alternate });
    }
  }

  // /DeviceN [ /Color1 /Color2 ... ]
  // Use indexOf-based scanning to avoid ReDoS
  {
    const DN_MARKER = "/DeviceN";
    let dnSearch = 0;
    while (true) {
      const dnIdx = text.indexOf(DN_MARKER, dnSearch);
      if (dnIdx === -1) break;
      dnSearch = dnIdx + DN_MARKER.length;

      // Find the opening bracket
      const bracketOpen = text.indexOf("[", dnSearch);
      if (bracketOpen === -1 || bracketOpen > dnSearch + 5) continue;
      const bracketClose = text.indexOf("]", bracketOpen + 1);
      if (bracketClose === -1) continue;

      const content = text.substring(bracketOpen + 1, bracketClose);
      const names = content
        .split(/\s+/)
        .filter((n) => n.startsWith("/"))
        .map((n) => n.substring(1))
        .map((n) => decodePDFName(n));
      for (const name of names) {
        if (!spotSeen.has(name)) {
          spotSeen.add(name);
          spotColors.push({ name, alternateSpace: "DeviceN component" });
        }
      }
      dnSearch = bracketClose + 1;
    }
  }

  // ---- Color Spaces -------------------------------------------------------
  const colorSpaces = new Set();
  const csRe =
    /\/(DeviceRGB|DeviceCMYK|DeviceGray|CalRGB|CalGray|ICCBased|Indexed|Separation|DeviceN|Lab|Pattern)\b/g;
  while ((m = csRe.exec(text)) !== null) {
    colorSpaces.add(m[1]);
  }

  return {
    fonts,
    iccProfiles,
    spotColors,
    colorSpaces: [...colorSpaces],
  };
}

module.exports = { analyzePDFBuffer, parseICCProfile };

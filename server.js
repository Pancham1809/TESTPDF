"use strict";

const express = require("express");
const multer = require("multer");
const path = require("path");
const { PDFDocument } = require("pdf-lib");
const pdfParse = require("pdf-parse");
const { analyzePDFBuffer } = require("./pdf-analyzer");

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Multer – accept PDF uploads up to 50 MB, stored in memory
// ---------------------------------------------------------------------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (file.mimetype === "application/pdf" || path.extname(file.originalname).toLowerCase() === ".pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are allowed"));
    }
  },
});

// Serve the static frontend
app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------------------
// POST /api/analyze – upload a PDF and get back its metadata
// ---------------------------------------------------------------------------
app.post("/api/analyze", upload.single("pdf"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No PDF file uploaded" });
    }

    const buffer = req.file.buffer;
    const result = {};

    // ---- File-level info ---------------------------------------------------
    result.file = {
      name: req.file.originalname,
      size: buffer.length,
      sizeFormatted: formatBytes(buffer.length),
    };

    // ---- pdf-lib: document-level metadata ----------------------------------
    try {
      const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });

      result.general = {
        title: pdfDoc.getTitle() || undefined,
        author: pdfDoc.getAuthor() || undefined,
        subject: pdfDoc.getSubject() || undefined,
        keywords: pdfDoc.getKeywords() || undefined,
        creator: pdfDoc.getCreator() || undefined,
        producer: pdfDoc.getProducer() || undefined,
        creationDate: safeDate(pdfDoc.getCreationDate()),
        modificationDate: safeDate(pdfDoc.getModificationDate()),
        pageCount: pdfDoc.getPageCount(),
      };

      // Page dimensions
      const pages = pdfDoc.getPages();
      result.pages = pages.map((p, i) => {
        const { width, height } = p.getSize();
        return {
          page: i + 1,
          widthPt: round(width),
          heightPt: round(height),
          widthIn: round(width / 72, 2),
          heightIn: round(height / 72, 2),
          widthMm: round((width / 72) * 25.4, 1),
          heightMm: round((height / 72) * 25.4, 1),
        };
      });
    } catch (err) {
      result.general = { error: "Could not parse document structure: " + err.message };
    }

    // ---- pdf-parse: XMP / Info dict ----------------------------------------
    try {
      const parsed = await pdfParse(buffer);
      result.info = parsed.info || {};
      result.xmp = parsed.metadata ? parsed.metadata._metadata || {} : {};
      result.pdfVersion = parsed.version || undefined;
      result.textLength = parsed.text ? parsed.text.length : 0;
    } catch {
      // Some encrypted / malformed PDFs fail here – that's OK
    }

    // ---- Deep analysis: fonts, ICC, spot colors ----------------------------
    const deep = analyzePDFBuffer(buffer);
    result.fonts = deep.fonts;
    result.iccProfiles = deep.iccProfiles;
    result.spotColors = deep.spotColors;
    result.colorSpaces = deep.colorSpaces;

    res.json(result);
  } catch (err) {
    console.error("Analysis error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Error handler for multer / other middleware errors
// ---------------------------------------------------------------------------
app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatBytes(bytes) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function round(n, decimals = 0) {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}

function safeDate(d) {
  if (!d) return undefined;
  try {
    return d instanceof Date ? d.toISOString() : String(d);
  } catch {
    return String(d);
  }
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`PDF Metadata Analyzer running at http://localhost:${PORT}`);
  });
}

module.exports = app;

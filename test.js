"use strict";

/**
 * Basic integration test for the PDF Metadata Analyzer.
 *
 * Creates a minimal PDF in-memory using pdf-lib, uploads it to the server,
 * and validates the returned metadata.
 */

const http = require("http");
const { PDFDocument, StandardFonts } = require("pdf-lib");
const app = require("./server");

const PORT = 0; // let the OS pick a free port
let server;
let baseUrl;

async function createTestPDF() {
  const doc = await PDFDocument.create();
  doc.setTitle("Test Document");
  doc.setAuthor("Test Author");
  doc.setSubject("Test Subject");
  doc.setKeywords(["test", "pdf", "metadata"]);
  doc.setCreator("TestSuite");
  doc.setProducer("pdf-lib");

  const page = doc.addPage([612, 792]); // US Letter
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Hello, PDF Metadata Analyzer!", { x: 50, y: 700, size: 18, font });

  return Buffer.from(await doc.save());
}

function uploadPDF(pdfBuffer) {
  return new Promise((resolve, reject) => {
    const boundary = "----TestBoundary" + Date.now();
    const header = `--${boundary}\r\nContent-Disposition: form-data; name="pdf"; filename="test.pdf"\r\nContent-Type: application/pdf\r\n\r\n`;
    const footer = `\r\n--${boundary}--\r\n`;

    const body = Buffer.concat([Buffer.from(header), pdfBuffer, Buffer.from(footer)]);

    const url = new URL(baseUrl + "/api/analyze");
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": body.length,
      },
    };

    const req = http.request(opts, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function assert(condition, message) {
  if (!condition) throw new Error("ASSERTION FAILED: " + message);
}

async function runTests() {
  let passed = 0;
  let failed = 0;

  const tests = [
    async function testAnalyzeEndpoint() {
      const pdfBuf = await createTestPDF();
      const res = await uploadPDF(pdfBuf);

      assert(res.status === 200, `Expected status 200, got ${res.status}`);
      const data = res.body;

      // File info
      assert(data.file, "Missing file info");
      assert(data.file.name === "test.pdf", `Unexpected file name: ${data.file.name}`);

      // General metadata
      assert(data.general, "Missing general metadata");
      assert(data.general.title === "Test Document", `Unexpected title: ${data.general.title}`);
      assert(data.general.author === "Test Author", `Unexpected author: ${data.general.author}`);
      assert(data.general.pageCount === 1, `Unexpected page count: ${data.general.pageCount}`);

      // Pages
      assert(data.pages && data.pages.length === 1, "Expected 1 page");
      assert(data.pages[0].widthPt === 612, `Unexpected width: ${data.pages[0].widthPt}`);
      assert(data.pages[0].heightPt === 792, `Unexpected height: ${data.pages[0].heightPt}`);

      // Fonts
      assert(Array.isArray(data.fonts), "Expected fonts array");
      assert(data.fonts.length > 0, "Expected at least one font");
      const helvetica = data.fonts.find((f) => f.baseName === "Helvetica");
      assert(helvetica, "Expected Helvetica font");

      // Color spaces & arrays
      assert(Array.isArray(data.colorSpaces), "Expected colorSpaces array");
      assert(Array.isArray(data.iccProfiles), "Expected iccProfiles array");
      assert(Array.isArray(data.spotColors), "Expected spotColors array");

      console.log("  ✅ testAnalyzeEndpoint passed");
    },

    async function testNoFile() {
      const res = await uploadPDF(Buffer.alloc(0));
      // Sending an empty buffer as PDF — server should still respond (may get error)
      assert(res.status === 200 || res.status === 400 || res.status === 500, `Unexpected status: ${res.status}`);
      console.log("  ✅ testNoFile passed");
    },
  ];

  for (const test of tests) {
    try {
      await test();
      passed++;
    } catch (err) {
      console.error(`  ❌ ${test.name} FAILED: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed out of ${tests.length} tests`);
  return failed;
}

// ---- Main ------------------------------------------------------------------
(async () => {
  server = app.listen(PORT, async () => {
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
    console.log(`Test server listening on ${baseUrl}\n`);

    try {
      const failures = await runTests();
      server.close();
      process.exit(failures > 0 ? 1 : 0);
    } catch (err) {
      console.error("Test suite error:", err);
      server.close();
      process.exit(1);
    }
  });
})();

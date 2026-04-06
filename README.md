# PDF Metadata Analyzer

A web application that extracts detailed metadata from PDF files, including embedded fonts, ICC color profiles, spot/separation colors, and more.

## Features

- **General Metadata** – Title, author, subject, keywords, creator, producer, creation/modification dates
- **Page Information** – Dimensions in points, inches, and millimeters for every page
- **Font Analysis** – Lists all fonts with type, encoding, subset status, and embedding info
- **ICC Color Profiles** – Parses embedded ICC profile headers (version, color space, device class, rendering intent, description)
- **Spot / Separation Colors** – Identifies Separation and DeviceN color names with their alternate spaces
- **Color Spaces** – Lists all color spaces used in the document (DeviceRGB, DeviceCMYK, ICCBased, etc.)
- **Drag & Drop Upload** – Modern dark-themed UI with progress indicator

## Quick Start

```bash
npm install
npm start
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

1. Open the app in a browser
2. Drag & drop a PDF file onto the upload area (or click to browse)
3. Click **Analyze PDF**
4. View the extracted metadata organized in collapsible sections

## Tech Stack

- **Backend** – Node.js, Express, Multer (file upload), pdf-lib, pdf-parse
- **Frontend** – Vanilla HTML/CSS/JavaScript (no build step)
- **PDF Analysis** – Custom stream decompression and regex-based parser for deep metadata extraction

## API

### `POST /api/analyze`

Upload a PDF file as `multipart/form-data` with the field name `pdf`.

**Response** (JSON):
```json
{
  "file": { "name": "...", "size": 12345, "sizeFormatted": "12.06 KB" },
  "general": { "title": "...", "author": "...", "pageCount": 5, "..." : "..." },
  "pages": [{ "page": 1, "widthPt": 612, "heightPt": 792, "..." : "..." }],
  "fonts": [{ "name": "...", "type": "TrueType", "embedded": true, "..." : "..." }],
  "iccProfiles": [{ "description": "...", "colorSpace": "CMYK", "..." : "..." }],
  "spotColors": [{ "name": "PANTONE 186 C", "alternateSpace": "DeviceCMYK" }],
  "colorSpaces": ["DeviceCMYK", "ICCBased", "Separation"]
}
```

## Testing

```bash
npm test
```

## License

ISC

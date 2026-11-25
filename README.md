# DocClear

A lightweight, **100% on-prem**, Docker-ready browser tool that removes shadows and uneven lighting from photographed documents (PNG / JPG / WebP) to deliver crisp, CamScanner-grade results.

## Privacy Guarantee

- **Zero third-party calls:** No external CDNs, analytics, fonts, or APIs.
- **Zero server uploads:** All shadow removal, tone mapping, and ZIP packaging run directly inside your browser via HTML5 Canvas and a Web Worker.
- **Strict CSP:** The Nginx Docker image enforces `connect-src 'none'` at the HTTP header level so the browser is prevented from making any outbound network requests.

---

## Features

- **Drag & Drop, File Picker, or `Ctrl+V` Paste** for single or multi-page document photos
- **Multi-Scale Morphological Illumination Normalization** that eliminates broad phone/hand shadows while preserving faint seals, watermarks, thin table borders, signatures, and colored stamps
- **4 CamScanner-Style Presets + Original:**
  - **Magic Color** *(default)* — lifts shadows to uniform white, deepens ink, and preserves vibrant stamp & signature colors
  - **Natural Lighten** — gentler shadow removal that keeps subtle paper texture and watermarks intact
  - **Crisp Grayscale** — clean monochrome scan for archival or OCR
  - **B&W Document** — high-contrast photocopy look with smooth anti-aliased edges
- **Live Fine-Tuning:** Shadow Removal, Paper Whiteness, Ink Contrast, Sharpness, and Shadow Radius (`Small` / `Medium` / `Large`)
- **Interactive Before / After Comparison:** Draggable split slider, `Split` / `Cleaned` / `Original` modes, zoom & pan, and hold `Space` to peek Original
- **Flexible Export:** Lossless **PNG** or size-tuned **JPG** per document, plus zero-dependency batch **`.zip`** export

---

## Quick Start

### 1. Docker Compose (Recommended for On-Prem Hosting)
```bash
docker compose up -d --build
```
Then open `http://localhost:8080` (override port with `PORT=3000 docker compose up -d`).

The image is built on `nginx:1.27-alpine` (~25 MB) and runs with a read-only root filesystem.

### 2. Docker CLI
```bash
docker build -t docclear .
docker run -d --name docclear -p 8080:80 --read-only \
  --tmpfs /var/cache/nginx --tmpfs /var/run docclear
```

### 3. Local Without Docker
Double-click **`run.bat`** (Windows) or open **`index.html`** directly in any modern browser. Everything works offline with zero build steps.

---

## Running Tests

Requires Node.js >= 18:

```bash
npm test
```

## Project Structure

```text
DocClear/
├── index.html          # Single-page workbench UI
├── styles.css          # Light & dark studio styling
├── src/
│   ├── processor.js    # Morphological shadow-removal & tone-mapping engine
│   ├── worker.js       # Web Worker wrapper for non-blocking processing
│   ├── zip.js          # Zero-dependency PKZIP STORE + CRC32 builder
│   └── app.js          # UI controller, split view, zoom/pan, export
├── tests/
│   ├── processor.test.js
│   ├── zip.test.js
│   └── verify_sample.mjs
├── Dockerfile
├── docker-compose.yml
├── nginx.conf
└── run.bat
```

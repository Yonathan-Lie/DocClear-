# DocClear — Design Specification

## Goal
Build **DocClear**, a lightweight, 100% on-prem, Docker-ready (`nginx:alpine`) browser web app that removes shadows and uneven lighting from PNG/JPG document photos to produce clean, CamScanner-grade scans without sending any document data to a server or third party.

## Constraints
- **100% On-Prem & Offline:** Zero external CDNs, APIs, fonts, or network requests (`connect-src 'none'` in Nginx CSP).
- **Zero-dependency client code:** Pure vanilla HTML5, CSS, and JavaScript (plus HTML5 Canvas & Web Worker).
- **Dual launch mode:** Works both served via Nginx/Docker (`http://`) and opened directly via `run.bat` / `index.html` (`file://`), using classic scripts and a main-thread fallback when Web Workers are unavailable under `file://`.
- **Clean GitHub-ready repository:** Located in `f:\PersonalTools\DocClear` with zero personal or sample document images committed.

## Architecture
- `src/processor.js`: Pure-JS shadow removal & enhancement engine (`DocClearProcessor`):
  1. Multi-scale morphological background illumination estimation (downsampled $O(N)$ monotonic-deque dilation + mild closing + 3-pass box blur) to isolate paper lighting while ignoring text, lines, signatures, and stamps.
  2. Per-channel illumination division blended by `shadowStrength`.
  3. CamScanner-style tone mapping (`whiteness`, `contrast`, `gamma`) with mode-specific finishing (`magic`, `natural`, `grayscale`, `bw`, `original`).
  4. Thresholded unsharp mask (`sharpness`) with noise gating to keep paper clean.
- `src/worker.js`: Web Worker wrapper with transferable `ArrayBuffer` I/O.
- `src/zip.js`: Zero-dependency PKZIP STORE + CRC32 archive builder for multi-file downloads.
- `src/app.js`, `index.html`, `styles.css`: Interactive drag-and-drop workbench with before/after split comparison, zoom/pan, presets, live sliders, light/dark themes, and PNG/JPG/ZIP export.
- `Dockerfile`, `nginx.conf`, `docker-compose.yml`: Hardened, read-only `nginx:1.27-alpine` container (~25 MB).

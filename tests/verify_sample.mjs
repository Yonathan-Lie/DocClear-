import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Processor = require('../src/processor.js');

const [inputPath, outputDir] = process.argv.slice(2);
if (!inputPath || !outputDir) {
  console.error('Usage: node tests/verify_sample.mjs <inputImagePath> <outputDir>');
  process.exit(1);
}

if (!fs.existsSync(inputPath)) {
  console.error(`Input file not found: ${inputPath}`);
  process.exit(1);
}

fs.mkdirSync(outputDir, { recursive: true });

const rawInPath = path.join(outputDir, '_tmp_input.rgba');
const metaPath = path.join(outputDir, '_tmp_meta.json');

// Decode input JPG/PNG to raw RGBA bytes via System.Drawing LockBits
const decodeScript = `
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap '${inputPath.replace(/'/g, "''")}'
$w = $bmp.Width
$h = $bmp.Height
$argbBmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($argbBmp)
$g.DrawImage($bmp, 0, 0, $w, $h)
$g.Dispose()
$bmp.Dispose()

$rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h
$data = $argbBmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$bytes = New-Object byte[] ($w * $h * 4)
[System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
$argbBmp.UnlockBits($data)
$argbBmp.Dispose()

# Convert BGRA (little-endian 32bppArgb) -> RGBA
for ($i = 0; $i -lt $bytes.Length; $i += 4) {
  $b = $bytes[$i]
  $bytes[$i] = $bytes[$i + 2]
  $bytes[$i + 2] = $b
}
[System.IO.File]::WriteAllBytes('${rawInPath.replace(/'/g, "''")}', $bytes)
@{ width = $w; height = $h } | ConvertTo-Json | Set-Content -LiteralPath '${metaPath.replace(/'/g, "''")}'
`;

execFileSync('powershell', ['-NoProfile', '-Command', decodeScript], { stdio: 'inherit' });

const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
const { width, height } = meta;
const srcBytes = new Uint8ClampedArray(fs.readFileSync(rawInPath));

function samplePoint(buf, x, y) {
  const cx = Math.min(width - 1, Math.max(0, x));
  const cy = Math.min(height - 1, Math.max(0, y));
  const idx = (cy * width + cx) * 4;
  return `(${buf[idx]},${buf[idx + 1]},${buf[idx + 2]})`;
}

const probePoints = [
  ['TopLeftShadow(100,100)', 100, 100],
  ['TopRightBright(900,100)', 900, 100],
  ['Center(500,350)', 500, 350],
  ['BottomRight(900,650)', 900, 650],
];

console.log(`Image: ${width}x${height}`);
console.log('Original:', probePoints.map(([n, x, y]) => `${n}=${samplePoint(srcBytes, x, y)}`).join('  '));

const presets = ['magic', 'lighten', 'grayscale', 'bw'];
const encodePairs = [];

for (const presetId of presets) {
  const t0 = performance.now();
  const out = Processor.processImageData(srcBytes, width, height, Processor.getPresetOptions(presetId));
  const elapsed = Math.round(performance.now() - t0);

  console.log(`${presetId.padEnd(9)} (${elapsed} ms):`, probePoints.map(([n, x, y]) => `${n}=${samplePoint(out, x, y)}`).join('  '));

  const rawOut = path.join(outputDir, `_tmp_${presetId}.rgba`);
  const pngOut = path.join(outputDir, `${presetId}.png`);
  fs.writeFileSync(rawOut, Buffer.from(out.buffer, out.byteOffset, out.byteLength));
  encodePairs.push({ rawOut, pngOut });
}

const encodeBlocks = encodePairs.map(({ rawOut, pngOut }) => `
$bytes = [System.IO.File]::ReadAllBytes('${rawOut.replace(/'/g, "''")}')
for ($i = 0; $i -lt $bytes.Length; $i += 4) {
  $r = $bytes[$i]
  $bytes[$i] = $bytes[$i + 2]
  $bytes[$i + 2] = $r
}
$bmp = New-Object System.Drawing.Bitmap ${width}, ${height}, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$rect = New-Object System.Drawing.Rectangle 0, 0, ${width}, ${height}
$data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::WriteOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
[System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, $bytes.Length)
$bmp.UnlockBits($data)
$bmp.Save('${pngOut.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
`).join('\n');

execFileSync('powershell', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Drawing\n${encodeBlocks}`], { stdio: 'inherit' });

// Clean up temporary .rgba and .json files
for (const f of [rawInPath, metaPath, ...encodePairs.map((p) => p.rawOut)]) {
  if (fs.existsSync(f)) fs.unlinkSync(f);
}
console.log(`Saved PNG outputs to: ${outputDir}`);

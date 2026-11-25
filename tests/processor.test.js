'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Processor = require('../src/processor.js');

function makeRgba(width, height, fillFn) {
  const buf = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const [r, g, b, a = 255] = fillFn(x, y);
      buf[idx] = r;
      buf[idx + 1] = g;
      buf[idx + 2] = b;
      buf[idx + 3] = a;
    }
  }
  return buf;
}

function getPixel(buf, width, x, y) {
  const idx = (y * width + x) * 4;
  return [buf[idx], buf[idx + 1], buf[idx + 2], buf[idx + 3]];
}

function avgRegion(buf, width, x0, y0, x1, y1) {
  let r = 0, g = 0, b = 0, count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const idx = (y * width + x) * 4;
      r += buf[idx];
      g += buf[idx + 1];
      b += buf[idx + 2];
      count++;
    }
  }
  return [r / count, g / count, b / count];
}

test('removes uneven shadow gradient across white document while keeping text dark', () => {
  const w = 200;
  const h = 120;
  const src = makeRgba(w, h, (x, y) => {
    const paper = Math.round(170 + (x / (w - 1)) * 65);
    // Horizontal dark text bars across both shadowed and bright sides
    const isText = (y >= 40 && y <= 44 && x >= 20 && x <= 180) ||
                   (y >= 75 && y <= 78 && x >= 20 && x <= 180);
    if (isText) {
      const ink = Math.round(paper * 0.2);
      return [ink, ink, ink, 255];
    }
    return [paper, paper, paper, 255];
  });

  const out = Processor.processImageData(src, w, h, Processor.getPresetOptions('magic'));
  const leftPaper = avgRegion(out, w, 15, 10, 35, 30);
  const rightPaper = avgRegion(out, w, 165, 10, 185, 30);
  const leftText = avgRegion(out, w, 30, 41, 60, 43);

  assert.ok(leftPaper[0] >= 248, `Expected left paper >= 248, got ${leftPaper[0]}`);
  assert.ok(rightPaper[0] >= 248, `Expected right paper >= 248, got ${rightPaper[0]}`);
  assert.ok(Math.abs(leftPaper[0] - rightPaper[0]) < 5, `Expected uniform paper, diff=${Math.abs(leftPaper[0] - rightPaper[0])}`);
  assert.ok(leftText[0] <= 65, `Expected text bar <= 65, got ${leftText[0]}`);
});

test('preserves faint watermark inside shadowed region', () => {
  const w = 200;
  const h = 120;
  const src = makeRgba(w, h, (x, y) => {
    const paper = 180;
    const inEmblem = x >= 25 && x <= 45 && y >= 20 && y <= 40;
    if (inEmblem) {
      return [145, 145, 145, 255];
    }
    return [paper, paper, paper, 255];
  });

  for (const presetId of ['magic', 'lighten']) {
    const out = Processor.processImageData(src, w, h, Processor.getPresetOptions(presetId));
    const paperAvg = avgRegion(out, w, 100, 20, 140, 40)[0];
    const emblemAvg = avgRegion(out, w, 30, 25, 40, 35)[0];
    assert.ok(paperAvg >= 245, `${presetId}: expected paper >= 245, got ${paperAvg}`);
    assert.ok(paperAvg - emblemAvg >= 15, `${presetId}: expected emblem contrast >= 15, got ${paperAvg - emblemAvg}`);
  }
});

test('preserves colored stamps in magic color mode', () => {
  const w = 200;
  const h = 120;
  const src = makeRgba(w, h, (x, y) => {
    const inStamp = x >= 130 && x <= 146 && y >= 70 && y <= 86;
    if (inStamp) {
      return [90, 110, 180, 255];
    }
    return [185, 185, 185, 255];
  });

  const out = Processor.processImageData(src, w, h, Processor.getPresetOptions('magic'));
  const stamp = avgRegion(out, w, 134, 74, 142, 82);
  assert.ok(stamp[2] - stamp[0] >= 40, `Expected blue stamp B-R >= 40, got B=${stamp[2]} R=${stamp[0]}`);
});

test('grayscale and bw modes produce monochrome output', () => {
  const w = 120;
  const h = 80;
  const src = makeRgba(w, h, (x, y) => {
    if (x >= 20 && x <= 40 && y >= 20 && y <= 30) {
      return [40, 70, 140, 255];
    }
    return [195, 190, 185, 255];
  });

  for (const mode of ['grayscale', 'bw']) {
    const out = Processor.processImageData(src, w, h, Processor.getPresetOptions(mode));
    for (let i = 0; i < out.length; i += 4) {
      assert.equal(out[i], out[i + 1], `${mode}: R !== G`);
      assert.equal(out[i + 1], out[i + 2], `${mode}: G !== B`);
    }
    if (mode === 'bw') {
      const ink = avgRegion(out, w, 24, 22, 36, 28)[0];
      const paper = avgRegion(out, w, 80, 50, 110, 70)[0];
      assert.ok(ink <= 40, `bw: expected dark ink <= 40, got ${ink}`);
      assert.ok(paper >= 250, `bw: expected white paper >= 250, got ${paper}`);
    }
  }
});

test('original preset returns unmodified copy without mutating input', () => {
  const w = 32;
  const h = 32;
  const src = makeRgba(w, h, (x, y) => [x * 7, y * 7, 120, 255]);
  const snapshot = new Uint8ClampedArray(src);
  const out = Processor.processImageData(src, w, h, Processor.getPresetOptions('original'));

  assert.notEqual(out, src);
  assert.deepEqual(src, snapshot);
  assert.deepEqual(out, snapshot);
});

test('handles edge cases without NaN or crashes and preserves alpha', () => {
  for (const [w, h] of [[1, 1], [8, 8]]) {
    const black = makeRgba(w, h, () => [0, 0, 0, 128]);
    const white = makeRgba(w, h, () => [255, 255, 255, 128]);
    for (const buf of [black, white]) {
      const out = Processor.processImageData(buf, w, h, Processor.getPresetOptions('magic'));
      assert.equal(out.length, buf.length);
      for (let i = 0; i < out.length; i += 4) {
        assert.ok(Number.isFinite(out[i]) && Number.isFinite(out[i + 1]) && Number.isFinite(out[i + 2]));
        assert.equal(out[i + 3], 128);
      }
    }
  }
});

test('no external URLs in runtime assets', () => {
  const root = path.resolve(__dirname, '..');
  const runtimeFiles = [
    path.join(root, 'index.html'),
    path.join(root, 'styles.css'),
    ...fs.readdirSync(path.join(root, 'src')).map((f) => path.join(root, 'src', f)),
  ];
  for (const file of runtimeFiles) {
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(content, /https?:\/\//i, `Found external URL in ${file}`);
  }
});

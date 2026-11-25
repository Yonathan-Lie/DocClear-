'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const Zip = require('../src/zip.js');

test('createZip builds valid PKZIP archive and round-trips via Expand-Archive', () => {
  const fileA = Buffer.from('Hello DocClear!\nLine 2', 'utf8');
  const fileB = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0x42]);

  const zipBytes = Zip.createZip([
    { name: 'doc1_clean.txt', data: new Uint8Array(fileA) },
    { name: 'folder/doc2_clean.png', data: new Uint8Array(fileB) },
  ]);

  assert.ok(zipBytes instanceof Uint8Array);
  // Starts with PK\x03\x04
  assert.equal(zipBytes[0], 0x50);
  assert.equal(zipBytes[1], 0x4b);
  assert.equal(zipBytes[2], 0x03);
  assert.equal(zipBytes[3], 0x04);
  // Ends with EOCD PK\x05\x06 (22 bytes)
  const eocdOffset = zipBytes.length - 22;
  assert.equal(zipBytes[eocdOffset], 0x50);
  assert.equal(zipBytes[eocdOffset + 1], 0x4b);
  assert.equal(zipBytes[eocdOffset + 2], 0x05);
  assert.equal(zipBytes[eocdOffset + 3], 0x06);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docclear-zip-'));
  try {
    const zipPath = path.join(tmpDir, 'out.zip');
    const extractDir = path.join(tmpDir, 'extracted');
    fs.writeFileSync(zipPath, zipBytes);

    execFileSync('powershell', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${extractDir.replace(/'/g, "''")}' -Force`,
    ]);

    const gotA = fs.readFileSync(path.join(extractDir, 'doc1_clean.txt'));
    const gotB = fs.readFileSync(path.join(extractDir, 'folder', 'doc2_clean.png'));
    assert.deepEqual(gotA, fileA);
    assert.deepEqual(gotB, fileB);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

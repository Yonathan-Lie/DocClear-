(function (root) {
  'use strict';

  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var i = 0; i < 256; i++) {
      var c = i;
      for (var k = 0; k < 8; k++) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    var crc = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function encodeUtf8(str) {
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(str);
    }
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var code = str.charCodeAt(i);
      if (code < 0x80) {
        out.push(code);
      } else if (code < 0x800) {
        out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      } else {
        out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      }
    }
    return new Uint8Array(out);
  }

  function dosTimeDate(date) {
    var d = date instanceof Date ? date : new Date();
    var year = Math.max(1980, d.getFullYear()) - 1980;
    var month = d.getMonth() + 1;
    var day = d.getDate();
    var hours = d.getHours();
    var minutes = d.getMinutes();
    var seconds = Math.floor(d.getSeconds() / 2);
    return {
      dosTime: ((hours & 0x1f) << 11) | ((minutes & 0x3f) << 5) | (seconds & 0x1f),
      dosDate: ((year & 0x7f) << 9) | ((month & 0x0f) << 5) | (day & 0x1f),
    };
  }

  /**
   * Builds an uncompressed (STORE, method 0) PKZIP archive from { name, data: Uint8Array } entries.
   */
  function createZip(entries) {
    if (!Array.isArray(entries)) {
      throw new TypeError('entries must be an array');
    }

    var dt = dosTimeDate(new Date());
    var localParts = [];
    var centralParts = [];
    var localOffset = 0;
    var centralSize = 0;

    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var nameBytes = encodeUtf8(String(entry.name).replace(/^\/+/, ''));
      var data = entry.data instanceof Uint8Array ? entry.data : new Uint8Array(entry.data);
      var crc = crc32(data);

      // Local File Header (30 bytes + name)
      var lfh = new Uint8Array(30 + nameBytes.length);
      var lv = new DataView(lfh.buffer);
      lv.setUint32(0, 0x04034b50, true); // Local file header signature
      lv.setUint16(4, 20, true);         // Version needed to extract (2.0)
      lv.setUint16(6, 0x0800, true);     // UTF-8 filename flag
      lv.setUint16(8, 0, true);          // Compression method: 0 (STORE)
      lv.setUint16(10, dt.dosTime, true);
      lv.setUint16(12, dt.dosDate, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);         // Extra field length
      lfh.set(nameBytes, 30);

      localParts.push(lfh, data);

      // Central Directory Header (46 bytes + name)
      var cdh = new Uint8Array(46 + nameBytes.length);
      var cv = new DataView(cdh.buffer);
      cv.setUint32(0, 0x02014b50, true); // Central directory signature
      cv.setUint16(4, 20, true);         // Version made by
      cv.setUint16(6, 20, true);         // Version needed
      cv.setUint16(8, 0x0800, true);     // UTF-8 filename flag
      cv.setUint16(10, 0, true);         // Compression method: 0 (STORE)
      cv.setUint16(12, dt.dosTime, true);
      cv.setUint16(14, dt.dosDate, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);         // Extra field length
      cv.setUint16(32, 0, true);         // File comment length
      cv.setUint16(34, 0, true);         // Disk number start
      cv.setUint16(36, 0, true);         // Internal attributes
      cv.setUint32(38, 0, true);         // External attributes
      cv.setUint32(42, localOffset, true);
      cdh.set(nameBytes, 46);

      centralParts.push(cdh);
      localOffset += lfh.length + data.length;
      centralSize += cdh.length;
    }

    // End of Central Directory Record (22 bytes)
    var eocd = new Uint8Array(22);
    var ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, localOffset, true);
    ev.setUint16(20, 0, true);

    var totalSize = localOffset + centralSize + eocd.length;
    var result = new Uint8Array(totalSize);
    var cursor = 0;

    for (var j = 0; j < localParts.length; j++) {
      result.set(localParts[j], cursor);
      cursor += localParts[j].length;
    }
    for (var m = 0; m < centralParts.length; m++) {
      result.set(centralParts[m], cursor);
      cursor += centralParts[m].length;
    }
    result.set(eocd, cursor);

    return result;
  }

  var api = {
    createZip: createZip,
    crc32: crc32,
  };

  root.DocClearZip = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);

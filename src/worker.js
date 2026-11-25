/* global importScripts, DocClearProcessor */
'use strict';

importScripts('processor.js');

self.onmessage = function (event) {
  var payload = event.data;
  if (!payload || !payload.buffer) return;

  var started = performance.now();
  try {
    var src = new Uint8ClampedArray(payload.buffer);
    var out = DocClearProcessor.processImageData(src, payload.width, payload.height, payload.options);
    var elapsedMs = Math.round(performance.now() - started);

    self.postMessage(
      {
        id: payload.id,
        docId: payload.docId,
        width: payload.width,
        height: payload.height,
        buffer: out.buffer,
        elapsedMs: elapsedMs,
      },
      [out.buffer]
    );
  } catch (err) {
    self.postMessage({
      id: payload.id,
      docId: payload.docId,
      error: err && err.message ? err.message : 'Processing failed',
    });
  }
};

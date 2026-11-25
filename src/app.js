/* global DocClearProcessor, DocClearZip */
(function () {
  'use strict';

  var els = {
    addFilesBtn: document.getElementById('addFilesBtn'),
    browseBtn: document.getElementById('browseBtn'),
    queueAddBtn: document.getElementById('queueAddBtn'),
    fileInput: document.getElementById('fileInput'),
    themeToggleBtn: document.getElementById('themeToggleBtn'),
    headerDownloadBtn: document.getElementById('headerDownloadBtn'),
    emptyDropzone: document.getElementById('emptyDropzone'),
    stageToolbar: document.getElementById('stageToolbar'),
    previewViewport: document.getElementById('previewViewport'),
    previewCanvasWrap: document.getElementById('previewCanvasWrap'),
    compareFrame: document.getElementById('compareFrame'),
    previewOriginal: document.getElementById('previewOriginal'),
    cleanedLayer: document.getElementById('cleanedLayer'),
    previewCleaned: document.getElementById('previewCleaned'),
    badgeBefore: document.getElementById('badgeBefore'),
    badgeAfter: document.getElementById('badgeAfter'),
    splitHandle: document.getElementById('splitHandle'),
    processingOverlay: document.getElementById('processingOverlay'),
    queueBar: document.getElementById('queueBar'),
    queueList: document.getElementById('queueList'),
    metaDims: document.getElementById('metaDims'),
    metaStatus: document.getElementById('metaStatus'),
    zoomOutBtn: document.getElementById('zoomOutBtn'),
    zoomFitBtn: document.getElementById('zoomFitBtn'),
    zoom100Btn: document.getElementById('zoom100Btn'),
    zoomInBtn: document.getElementById('zoomInBtn'),
    zoomLabel: document.getElementById('zoomLabel'),
    presetGrid: document.getElementById('presetGrid'),
    shadowRange: document.getElementById('shadowRange'),
    whitenessRange: document.getElementById('whitenessRange'),
    contrastRange: document.getElementById('contrastRange'),
    sharpnessRange: document.getElementById('sharpnessRange'),
    shadowVal: document.getElementById('shadowVal'),
    whitenessVal: document.getElementById('whitenessVal'),
    contrastVal: document.getElementById('contrastVal'),
    sharpnessVal: document.getElementById('sharpnessVal'),
    resetBtn: document.getElementById('resetBtn'),
    applyAllBtn: document.getElementById('applyAllBtn'),
    jpgQualityGroup: document.getElementById('jpgQualityGroup'),
    qualityRange: document.getElementById('qualityRange'),
    qualityVal: document.getElementById('qualityVal'),
    downloadOneBtn: document.getElementById('downloadOneBtn'),
    downloadAllBtn: document.getElementById('downloadAllBtn'),
    globalDragOverlay: document.getElementById('globalDragOverlay'),
    toast: document.getElementById('toast'),
  };

  var state = {
    docs: [],
    activeId: null,
    viewMode: 'split', // 'split' | 'cleaned' | 'original'
    peekingOriginal: false,
    splitPct: 50,
    zoomMode: 'fit', // 'fit' | 'manual'
    zoomScale: 1,
    panX: 0,
    panY: 0,
    exportFormat: 'png', // 'png' | 'jpeg'
    jpgQuality: 92,
    nextDocId: 1,
    nextReqId: 1,
  };

  var worker = null;
  var pendingJobs = new Map();
  var debounceTimer = null;
  var toastTimer = null;
  var dragDepth = 0;

  function initTheme() {
    var saved = null;
    try {
      saved = localStorage.getItem('docclear-theme');
    } catch (_) {
      saved = null;
    }
    if (saved === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  }

  function toggleTheme() {
    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    var next = isDark ? 'light' : 'dark';
    if (next === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    try {
      localStorage.setItem('docclear-theme', next);
    } catch (_) {
      // ignore storage errors
    }
  }

  function showToast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      els.toast.classList.add('hidden');
    }, 3000);
  }

  function initWorker() {
    if (window.location.protocol === 'file:' || typeof Worker === 'undefined') {
      return;
    }
    try {
      worker = new Worker('src/worker.js');
      worker.onmessage = function (event) {
        var res = event.data;
        if (!res) return;
        var job = pendingJobs.get(res.id);
        if (!job) return;
        pendingJobs.delete(res.id);
        if (res.error) {
          job.reject(new Error(res.error));
        } else {
          job.resolve({
            rgba: new Uint8ClampedArray(res.buffer),
            elapsedMs: res.elapsedMs,
          });
        }
      };
      worker.onerror = function () {
        // Fallback to main thread if worker fails at runtime
        worker = null;
        pendingJobs.forEach(function (job) {
          job.reject(new Error('Worker unavailable'));
        });
        pendingJobs.clear();
      };
    } catch (_) {
      worker = null;
    }
  }

  function runProcessorAsync(doc, options) {
    var reqId = state.nextReqId++;
    doc.latestReqId = reqId;

    if (worker) {
      return new Promise(function (resolve, reject) {
        var copy = new Uint8ClampedArray(doc.origRgba);
        pendingJobs.set(reqId, { resolve: resolve, reject: reject });
        try {
          worker.postMessage(
            {
              id: reqId,
              docId: doc.id,
              width: doc.width,
              height: doc.height,
              buffer: copy.buffer,
              options: options,
            },
            [copy.buffer]
          );
        } catch (err) {
          pendingJobs.delete(reqId);
          worker = null;
          runMainThread(doc, options, reqId).then(resolve, reject);
        }
      }).catch(function () {
        return runMainThread(doc, options, reqId);
      });
    }

    return runMainThread(doc, options, reqId);
  }

  function runMainThread(doc, options, reqId) {
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        if (doc.latestReqId !== reqId) {
          resolve(null);
          return;
        }
        try {
          var t0 = performance.now();
          var out = DocClearProcessor.processImageData(doc.origRgba, doc.width, doc.height, options);
          var elapsedMs = Math.round(performance.now() - t0);
          resolve({ rgba: out, elapsedMs: elapsedMs });
        } catch (err) {
          reject(err);
        }
      }, 0);
    });
  }

  function getActiveDoc() {
    for (var i = 0; i < state.docs.length; i++) {
      if (state.docs[i].id === state.activeId) return state.docs[i];
    }
    return null;
  }

  function makeThumbnailUrl(canvas) {
    var maxSide = 96;
    var scale = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
    var tw = Math.max(1, Math.round(canvas.width * scale));
    var th = Math.max(1, Math.round(canvas.height * scale));
    var tCanvas = document.createElement('canvas');
    tCanvas.width = tw;
    tCanvas.height = th;
    var ctx = tCanvas.getContext('2d');
    ctx.drawImage(canvas, 0, 0, tw, th);
    return tCanvas.toDataURL('image/jpeg', 0.75);
  }

  function loadImageFile(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\/(png|jpeg|jpg|webp)$/i.test(file.type || '')) {
        var ext = (file && file.name ? file.name.split('.').pop() : '').toLowerCase();
        if (!['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
          reject(new Error('Unsupported file type: ' + (file ? file.name : 'unknown')));
          return;
        }
      }

      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        var w = img.naturalWidth;
        var h = img.naturalHeight;

        var origCanvas = document.createElement('canvas');
        origCanvas.width = w;
        origCanvas.height = h;
        var origCtx = origCanvas.getContext('2d', { willReadFrequently: true });
        origCtx.drawImage(img, 0, 0);
        var imgData = origCtx.getImageData(0, 0, w, h);

        var cleanCanvas = document.createElement('canvas');
        cleanCanvas.width = w;
        cleanCanvas.height = h;
        var cleanCtx = cleanCanvas.getContext('2d');
        cleanCtx.putImageData(imgData, 0, 0);

        resolve({
          id: state.nextDocId++,
          name: file.name || ('document-' + Date.now() + '.png'),
          width: w,
          height: h,
          origCanvas: origCanvas,
          cleanCanvas: cleanCanvas,
          origRgba: new Uint8ClampedArray(imgData.data),
          thumbUrl: makeThumbnailUrl(origCanvas),
          settings: DocClearProcessor.getPresetOptions('magic'),
          elapsedMs: null,
          status: 'queued',
          latestReqId: 0,
        });
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('Could not decode image: ' + (file.name || 'file')));
      };
      img.src = url;
    });
  }

  function handleFiles(fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;

    Promise.allSettled(files.map(loadImageFile)).then(function (results) {
      var loaded = [];
      var failures = 0;
      for (var i = 0; i < results.length; i++) {
        if (results[i].status === 'fulfilled') {
          loaded.push(results[i].value);
        } else {
          failures++;
        }
      }
      if (failures > 0) {
        showToast('Skipped ' + failures + ' unsupported or unreadable file(s).');
      }
      if (!loaded.length) return;

      var firstNewId = loaded[0].id;
      for (var j = 0; j < loaded.length; j++) {
        state.docs.push(loaded[j]);
      }

      if (!state.activeId || state.docs.length === loaded.length) {
        state.activeId = firstNewId;
        state.zoomMode = 'fit';
        state.panX = 0;
        state.panY = 0;
      }

      renderShellState();
      renderQueue();
      selectDocument(state.activeId);

      // Process all newly added docs
      loaded.forEach(function (doc) {
        processDocument(doc);
      });
    });
  }

  function processDocument(doc) {
    if (!doc) return Promise.resolve();
    doc.status = 'processing';
    var reqSnapshot = doc.latestReqId + 1;
    if (doc.id === state.activeId) {
      els.processingOverlay.classList.remove('hidden');
      els.metaStatus.textContent = 'Processing...';
    }
    renderQueue();

    return runProcessorAsync(doc, doc.settings).then(function (res) {
      if (!res || doc.latestReqId < reqSnapshot) return;
      var cleanCtx = doc.cleanCanvas.getContext('2d');
      var outImg = new ImageData(res.rgba, doc.width, doc.height);
      cleanCtx.putImageData(outImg, 0, 0);
      doc.elapsedMs = res.elapsedMs;
      doc.status = 'done';

      if (doc.id === state.activeId) {
        paintPreviewCanvases(doc);
        els.processingOverlay.classList.add('hidden');
        els.metaStatus.textContent = 'Cleaned in ' + doc.elapsedMs + ' ms';
      }
      renderQueue();
      updateDownloadButtons();
    }).catch(function (err) {
      doc.status = 'error';
      if (doc.id === state.activeId) {
        els.processingOverlay.classList.add('hidden');
        els.metaStatus.textContent = 'Error';
      }
      showToast(err && err.message ? err.message : 'Failed to process image');
      renderQueue();
    });
  }

  function paintPreviewCanvases(doc) {
    if (!doc) return;
    els.previewOriginal.width = doc.width;
    els.previewOriginal.height = doc.height;
    els.previewCleaned.width = doc.width;
    els.previewCleaned.height = doc.height;

    els.previewOriginal.getContext('2d').drawImage(doc.origCanvas, 0, 0);
    els.previewCleaned.getContext('2d').drawImage(doc.cleanCanvas, 0, 0);
    layoutCompareFrame();
  }

  function computeFitSize(doc) {
    var rect = els.previewViewport.getBoundingClientRect();
    var availW = Math.max(120, rect.width - 36);
    var availH = Math.max(120, rect.height - 36);
    var fitScale = Math.min(availW / doc.width, availH / doc.height);
    return {
      fitScale: fitScale,
      scale: state.zoomMode === 'fit' ? fitScale : state.zoomScale,
    };
  }

  function layoutCompareFrame() {
    var doc = getActiveDoc();
    if (!doc) return;

    var sizes = computeFitSize(doc);
    var dispW = Math.max(1, Math.round(doc.width * sizes.scale));
    var dispH = Math.max(1, Math.round(doc.height * sizes.scale));

    els.compareFrame.style.width = dispW + 'px';
    els.compareFrame.style.height = dispH + 'px';
    els.previewCanvasWrap.style.transform = 'translate(' + state.panX + 'px, ' + state.panY + 'px)';
    els.zoomLabel.textContent = state.zoomMode === 'fit'
      ? 'Fit (' + Math.round(sizes.fitScale * 100) + '%)'
      : Math.round(sizes.scale * 100) + '%';

    applyComparisonMode();
  }

  function applyComparisonMode() {
    var effectiveMode = state.peekingOriginal ? 'original' : state.viewMode;

    if (effectiveMode === 'split') {
      els.cleanedLayer.classList.remove('hidden');
      els.cleanedLayer.style.clipPath = 'inset(0 0 0 ' + state.splitPct + '%)';
      els.splitHandle.classList.remove('hidden');
      els.splitHandle.style.left = state.splitPct + '%';
      els.splitHandle.setAttribute('aria-valuenow', String(Math.round(state.splitPct)));
      els.badgeBefore.classList.remove('hidden');
      els.badgeAfter.classList.remove('hidden');
    } else if (effectiveMode === 'cleaned') {
      els.cleanedLayer.classList.remove('hidden');
      els.cleanedLayer.style.clipPath = 'inset(0 0 0 0)';
      els.splitHandle.classList.add('hidden');
      els.badgeBefore.classList.add('hidden');
      els.badgeAfter.classList.add('hidden');
    } else {
      els.cleanedLayer.classList.add('hidden');
      els.splitHandle.classList.add('hidden');
      els.badgeBefore.classList.remove('hidden');
      els.badgeAfter.classList.add('hidden');
    }
  }

  function renderShellState() {
    var hasDocs = state.docs.length > 0;
    els.emptyDropzone.classList.toggle('hidden', hasDocs);
    els.stageToolbar.classList.toggle('hidden', !hasDocs);
    els.previewViewport.classList.toggle('hidden', !hasDocs);
    els.queueBar.classList.toggle('hidden', !hasDocs);
    els.applyAllBtn.classList.toggle('hidden', state.docs.length < 2);
    els.downloadAllBtn.classList.toggle('hidden', state.docs.length < 2);

    var rangeEls = [els.shadowRange, els.whitenessRange, els.contrastRange, els.sharpnessRange];
    for (var i = 0; i < rangeEls.length; i++) {
      rangeEls[i].disabled = !hasDocs;
    }
    var bgBtns = document.querySelectorAll('[data-bgsize]');
    for (var j = 0; j < bgBtns.length; j++) {
      bgBtns[j].disabled = !hasDocs;
    }

    updateDownloadButtons();
  }

  function updateDownloadButtons() {
    var doc = getActiveDoc();
    var ready = Boolean(doc && doc.status !== 'error');
    els.headerDownloadBtn.disabled = !ready;
    els.downloadOneBtn.disabled = !ready;
    els.downloadAllBtn.disabled = state.docs.length < 2;
  }

  function renderQueue() {
    els.queueList.innerHTML = '';
    for (var i = 0; i < state.docs.length; i++) {
      (function (doc) {
        var item = document.createElement('div');
        item.className = 'queue-item' + (doc.id === state.activeId ? ' active' : '');
        item.tabIndex = 0;
        item.setAttribute('role', 'button');

        var img = document.createElement('img');
        img.className = 'queue-thumb';
        img.src = doc.thumbUrl;
        img.alt = doc.name;

        var meta = document.createElement('div');
        meta.className = 'queue-meta';
        var nameEl = document.createElement('span');
        nameEl.className = 'queue-name';
        nameEl.textContent = doc.name;
        var subEl = document.createElement('span');
        subEl.className = 'queue-sub';
        subEl.textContent = doc.status === 'processing'
          ? 'Cleaning...'
          : doc.elapsedMs !== null
            ? doc.width + 'x' + doc.height + ' · ' + doc.elapsedMs + 'ms'
            : doc.width + 'x' + doc.height;

        meta.appendChild(nameEl);
        meta.appendChild(subEl);

        var rmBtn = document.createElement('button');
        rmBtn.className = 'queue-remove';
        rmBtn.type = 'button';
        rmBtn.title = 'Remove';
        rmBtn.textContent = '\u00d7';
        rmBtn.addEventListener('click', function (ev) {
          ev.stopPropagation();
          removeDocument(doc.id);
        });

        item.appendChild(img);
        item.appendChild(meta);
        item.appendChild(rmBtn);
        item.addEventListener('click', function () {
          selectDocument(doc.id);
        });
        item.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault();
            selectDocument(doc.id);
          }
        });

        els.queueList.appendChild(item);
      })(state.docs[i]);
    }
  }

  function removeDocument(docId) {
    var idx = state.docs.findIndex(function (d) { return d.id === docId; });
    if (idx === -1) return;
    state.docs.splice(idx, 1);

    if (state.activeId === docId) {
      var next = state.docs[idx] || state.docs[idx - 1] || null;
      state.activeId = next ? next.id : null;
    }

    renderShellState();
    renderQueue();
    if (state.activeId) {
      selectDocument(state.activeId);
    }
  }

  function selectDocument(docId) {
    state.activeId = docId;
    state.zoomMode = 'fit';
    state.panX = 0;
    state.panY = 0;

    var doc = getActiveDoc();
    if (!doc) return;

    els.metaDims.textContent = doc.width + ' \u00d7 ' + doc.height;
    els.metaStatus.textContent = doc.status === 'processing'
      ? 'Processing...'
      : doc.elapsedMs !== null
        ? 'Cleaned in ' + doc.elapsedMs + ' ms'
        : 'Ready';
    els.processingOverlay.classList.toggle('hidden', doc.status !== 'processing');

    syncControlsFromDoc(doc);
    paintPreviewCanvases(doc);
    renderQueue();
    updateDownloadButtons();
  }

  function syncControlsFromDoc(doc) {
    var s = doc.settings;
    els.shadowRange.value = String(s.shadowStrength);
    els.whitenessRange.value = String(s.whiteness);
    els.contrastRange.value = String(s.contrast);
    els.sharpnessRange.value = String(s.sharpness);
    els.shadowVal.textContent = String(s.shadowStrength);
    els.whitenessVal.textContent = String(s.whiteness);
    els.contrastVal.textContent = String(s.contrast);
    els.sharpnessVal.textContent = String(s.sharpness);

    var presetBtns = document.querySelectorAll('.preset-btn');
    for (var i = 0; i < presetBtns.length; i++) {
      presetBtns[i].classList.toggle('active', presetBtns[i].dataset.preset === s.id);
    }

    var bgBtns = document.querySelectorAll('[data-bgsize]');
    for (var j = 0; j < bgBtns.length; j++) {
      bgBtns[j].classList.toggle('active', bgBtns[j].dataset.bgsize === s.backgroundSize);
    }
  }

  function scheduleReprocess() {
    var doc = getActiveDoc();
    if (!doc) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () {
      processDocument(doc);
    }, 45);
  }

  function canvasToBlob(canvas, format, qualityPct) {
    return new Promise(function (resolve, reject) {
      var mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
      var q = format === 'jpeg' ? Math.max(0.1, Math.min(1, qualityPct / 100)) : undefined;
      canvas.toBlob(function (blob) {
        if (!blob) {
          reject(new Error('Failed to encode image'));
          return;
        }
        resolve(blob);
      }, mime, q);
    });
  }

  function cleanedFilename(origName, format) {
    var base = String(origName || 'document').replace(/\.[^.]+$/, '');
    var ext = format === 'jpeg' ? 'jpg' : 'png';
    return base + '_clean.' + ext;
  }

  function triggerBlobDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function downloadActive() {
    var doc = getActiveDoc();
    if (!doc) return;
    canvasToBlob(doc.cleanCanvas, state.exportFormat, state.jpgQuality)
      .then(function (blob) {
        triggerBlobDownload(blob, cleanedFilename(doc.name, state.exportFormat));
      })
      .catch(function (err) {
        showToast(err.message);
      });
  }

  function downloadAllZip() {
    if (state.docs.length < 2) return;
    els.downloadAllBtn.disabled = true;
    els.downloadAllBtn.textContent = 'Building ZIP...';

    var usedNames = new Set();
    Promise.all(
      state.docs.map(function (doc) {
        return canvasToBlob(doc.cleanCanvas, state.exportFormat, state.jpgQuality)
          .then(function (blob) { return blob.arrayBuffer(); })
          .then(function (buf) {
            var name = cleanedFilename(doc.name, state.exportFormat);
            var counter = 2;
            while (usedNames.has(name)) {
              var dot = name.lastIndexOf('.');
              name = name.slice(0, dot) + '_' + counter + name.slice(dot);
              counter++;
            }
            usedNames.add(name);
            return { name: name, data: new Uint8Array(buf) };
          });
      })
    )
      .then(function (entries) {
        var zipBytes = DocClearZip.createZip(entries);
        var zipBlob = new Blob([zipBytes], { type: 'application/zip' });
        triggerBlobDownload(zipBlob, 'docclear_cleaned.zip');
      })
      .catch(function (err) {
        showToast(err && err.message ? err.message : 'ZIP export failed');
      })
      .finally(function () {
        els.downloadAllBtn.textContent = 'Download All (.zip)';
        updateDownloadButtons();
      });
  }

  function bindEvents() {
    // File open triggers
    [els.addFilesBtn, els.browseBtn, els.queueAddBtn].forEach(function (btn) {
      btn.addEventListener('click', function () {
        els.fileInput.value = '';
        els.fileInput.click();
      });
    });

    els.emptyDropzone.addEventListener('click', function (ev) {
      if (ev.target === els.browseBtn) return;
      els.fileInput.value = '';
      els.fileInput.click();
    });

    els.emptyDropzone.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        els.fileInput.click();
      }
    });

    els.fileInput.addEventListener('change', function (ev) {
      handleFiles(ev.target.files);
    });

    // Global drag-and-drop
    window.addEventListener('dragenter', function (ev) {
      if (ev.dataTransfer && Array.prototype.indexOf.call(ev.dataTransfer.types || [], 'Files') !== -1) {
        dragDepth++;
        els.globalDragOverlay.classList.remove('hidden');
        els.emptyDropzone.classList.add('drag-over');
      }
    });

    window.addEventListener('dragover', function (ev) {
      ev.preventDefault();
    });

    window.addEventListener('dragleave', function () {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) {
        els.globalDragOverlay.classList.add('hidden');
        els.emptyDropzone.classList.remove('drag-over');
      }
    });

    window.addEventListener('drop', function (ev) {
      ev.preventDefault();
      dragDepth = 0;
      els.globalDragOverlay.classList.add('hidden');
      els.emptyDropzone.classList.remove('drag-over');
      if (ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files.length) {
        handleFiles(ev.dataTransfer.files);
      }
    });

    // Clipboard paste
    window.addEventListener('paste', function (ev) {
      var items = ev.clipboardData && ev.clipboardData.items;
      if (!items) return;
      var files = [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].kind === 'file' && items[i].type.indexOf('image/') === 0) {
          var f = items[i].getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length) handleFiles(files);
    });

    // Theme & Downloads
    els.themeToggleBtn.addEventListener('click', toggleTheme);
    els.headerDownloadBtn.addEventListener('click', downloadActive);
    els.downloadOneBtn.addEventListener('click', downloadActive);
    els.downloadAllBtn.addEventListener('click', downloadAllZip);

    // View mode segmented buttons
    document.querySelectorAll('[data-view]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.viewMode = btn.dataset.view;
        document.querySelectorAll('[data-view]').forEach(function (b) {
          b.classList.toggle('active', b === btn);
        });
        applyComparisonMode();
      });
    });

    // Spacebar peek Original
    window.addEventListener('keydown', function (ev) {
      if (ev.code === 'Space' && !ev.repeat && getActiveDoc()) {
        var tag = document.activeElement ? document.activeElement.tagName : '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
        ev.preventDefault();
        state.peekingOriginal = true;
        applyComparisonMode();
      }
    });
    window.addEventListener('keyup', function (ev) {
      if (ev.code === 'Space' && state.peekingOriginal) {
        state.peekingOriginal = false;
        applyComparisonMode();
      }
    });

    // Split handle pointer drag
    var draggingSplit = false;
    function updateSplitFromClientX(clientX) {
      var rect = els.compareFrame.getBoundingClientRect();
      if (rect.width <= 0) return;
      var pct = ((clientX - rect.left) / rect.width) * 100;
      state.splitPct = Math.max(0, Math.min(100, pct));
      applyComparisonMode();
    }

    els.splitHandle.addEventListener('pointerdown', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      draggingSplit = true;
      els.splitHandle.setPointerCapture(ev.pointerId);
      updateSplitFromClientX(ev.clientX);
    });

    els.splitHandle.addEventListener('pointermove', function (ev) {
      if (!draggingSplit) return;
      updateSplitFromClientX(ev.clientX);
    });

    els.splitHandle.addEventListener('pointerup', function (ev) {
      draggingSplit = false;
      try { els.splitHandle.releasePointerCapture(ev.pointerId); } catch (_) {}
    });

    els.splitHandle.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowLeft') {
        state.splitPct = Math.max(0, state.splitPct - 3);
        applyComparisonMode();
      } else if (ev.key === 'ArrowRight') {
        state.splitPct = Math.min(100, state.splitPct + 3);
        applyComparisonMode();
      }
    });

    // Zoom & Pan
    function stepZoom(factor) {
      var doc = getActiveDoc();
      if (!doc) return;
      var cur = state.zoomMode === 'fit' ? computeFitSize(doc).fitScale : state.zoomScale;
      state.zoomMode = 'manual';
      state.zoomScale = Math.max(0.15, Math.min(5, cur * factor));
      layoutCompareFrame();
    }

    els.zoomInBtn.addEventListener('click', function () { stepZoom(1.25); });
    els.zoomOutBtn.addEventListener('click', function () { stepZoom(0.8); });
    els.zoomFitBtn.addEventListener('click', function () {
      state.zoomMode = 'fit';
      state.panX = 0;
      state.panY = 0;
      layoutCompareFrame();
    });
    els.zoom100Btn.addEventListener('click', function () {
      state.zoomMode = 'manual';
      state.zoomScale = 1;
      state.panX = 0;
      state.panY = 0;
      layoutCompareFrame();
    });

    els.previewViewport.addEventListener('wheel', function (ev) {
      if (!getActiveDoc()) return;
      ev.preventDefault();
      stepZoom(ev.deltaY < 0 ? 1.12 : 0.89);
    }, { passive: false });

    var panning = false;
    var panStartX = 0;
    var panStartY = 0;
    els.previewViewport.addEventListener('pointerdown', function (ev) {
      if (ev.target.closest('#splitHandle')) return;
      if (state.zoomMode === 'fit' && state.panX === 0 && state.panY === 0) return;
      panning = true;
      panStartX = ev.clientX - state.panX;
      panStartY = ev.clientY - state.panY;
    });
    window.addEventListener('pointermove', function (ev) {
      if (!panning) return;
      state.panX = ev.clientX - panStartX;
      state.panY = ev.clientY - panStartY;
      els.previewCanvasWrap.style.transform = 'translate(' + state.panX + 'px, ' + state.panY + 'px)';
    });
    window.addEventListener('pointerup', function () {
      panning = false;
    });

    window.addEventListener('resize', layoutCompareFrame);

    // Presets
    els.presetGrid.addEventListener('click', function (ev) {
      var btn = ev.target.closest('.preset-btn');
      if (!btn) return;
      var doc = getActiveDoc();
      if (!doc) return;
      var preset = DocClearProcessor.getPresetOptions(btn.dataset.preset);
      doc.settings = preset;
      syncControlsFromDoc(doc);
      processDocument(doc);
    });

    // Fine-tune sliders
    function bindSlider(rangeEl, readoutEl, key) {
      rangeEl.addEventListener('input', function () {
        var doc = getActiveDoc();
        if (!doc) return;
        var val = Number(rangeEl.value);
        readoutEl.textContent = String(val);
        doc.settings[key] = val;
        if (doc.settings.colorMode === 'original' && val > 0) {
          doc.settings.colorMode = 'natural';
          doc.settings.id = 'lighten';
        }
        scheduleReprocess();
      });
    }

    bindSlider(els.shadowRange, els.shadowVal, 'shadowStrength');
    bindSlider(els.whitenessRange, els.whitenessVal, 'whiteness');
    bindSlider(els.contrastRange, els.contrastVal, 'contrast');
    bindSlider(els.sharpnessRange, els.sharpnessVal, 'sharpness');

    document.querySelectorAll('[data-bgsize]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var doc = getActiveDoc();
        if (!doc) return;
        doc.settings.backgroundSize = btn.dataset.bgsize;
        syncControlsFromDoc(doc);
        processDocument(doc);
      });
    });

    els.resetBtn.addEventListener('click', function () {
      var doc = getActiveDoc();
      if (!doc) return;
      doc.settings = DocClearProcessor.getPresetOptions(doc.settings.id || 'magic');
      syncControlsFromDoc(doc);
      processDocument(doc);
    });

    els.applyAllBtn.addEventListener('click', function () {
      var active = getActiveDoc();
      if (!active || state.docs.length < 2) return;
      var snapshot = Object.assign({}, active.settings);
      state.docs.forEach(function (doc) {
        if (doc.id !== active.id) {
          doc.settings = Object.assign({}, snapshot);
          processDocument(doc);
        }
      });
      showToast('Applied settings to all ' + state.docs.length + ' documents.');
    });

    // Export options
    document.querySelectorAll('[data-format]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.exportFormat = btn.dataset.format;
        document.querySelectorAll('[data-format]').forEach(function (b) {
          b.classList.toggle('active', b === btn);
        });
        els.jpgQualityGroup.classList.toggle('hidden', state.exportFormat !== 'jpeg');
      });
    });

    els.qualityRange.addEventListener('input', function () {
      state.jpgQuality = Number(els.qualityRange.value);
      els.qualityVal.textContent = state.jpgQuality + '%';
    });
  }

  initTheme();
  initWorker();
  bindEvents();
  renderShellState();
})();

(function (root) {
  'use strict';

  var PRESETS = {
    magic: {
      id: 'magic',
      label: 'Magic Color',
      description: 'Removes shadows, brightens paper, keeps stamps & ink vivid',
      shadowStrength: 100,
      whiteness: 55,
      contrast: 45,
      sharpness: 35,
      backgroundSize: 'medium',
      colorMode: 'magic',
    },
    lighten: {
      id: 'lighten',
      label: 'Natural Lighten',
      description: 'Gently lifts shadows while preserving subtle watermarks',
      shadowStrength: 90,
      whiteness: 28,
      contrast: 15,
      sharpness: 15,
      backgroundSize: 'medium',
      colorMode: 'natural',
    },
    grayscale: {
      id: 'grayscale',
      label: 'Crisp Grayscale',
      description: 'Clean high-contrast monochrome scan for archival or OCR',
      shadowStrength: 100,
      whiteness: 60,
      contrast: 55,
      sharpness: 40,
      backgroundSize: 'medium',
      colorMode: 'grayscale',
    },
    bw: {
      id: 'bw',
      label: 'B&W Document',
      description: 'Sharp photocopy look with crisp black ink on pure white',
      shadowStrength: 100,
      whiteness: 62,
      contrast: 65,
      sharpness: 35,
      backgroundSize: 'medium',
      colorMode: 'bw',
    },
    original: {
      id: 'original',
      label: 'Original',
      description: 'Unprocessed original photo',
      shadowStrength: 0,
      whiteness: 0,
      contrast: 0,
      sharpness: 0,
      backgroundSize: 'medium',
      colorMode: 'original',
    },
  };

  function clamp(val, min, max) {
    return val < min ? min : val > max ? max : val;
  }

  function getPresetOptions(presetId) {
    var preset = PRESETS[presetId] || PRESETS.magic;
    return {
      id: preset.id,
      label: preset.label,
      description: preset.description,
      shadowStrength: preset.shadowStrength,
      whiteness: preset.whiteness,
      contrast: preset.contrast,
      sharpness: preset.sharpness,
      backgroundSize: preset.backgroundSize,
      colorMode: preset.colorMode,
    };
  }

  function normalizeOptions(options) {
    var base = getPresetOptions(options && options.id ? options.id : 'magic');
    if (!options) return base;
    return {
      id: options.id || base.id,
      shadowStrength: options.shadowStrength !== undefined ? clamp(Number(options.shadowStrength), 0, 100) : base.shadowStrength,
      whiteness: options.whiteness !== undefined ? clamp(Number(options.whiteness), 0, 100) : base.whiteness,
      contrast: options.contrast !== undefined ? clamp(Number(options.contrast), 0, 100) : base.contrast,
      sharpness: options.sharpness !== undefined ? clamp(Number(options.sharpness), 0, 100) : base.sharpness,
      backgroundSize: options.backgroundSize === 'small' || options.backgroundSize === 'large' ? options.backgroundSize : 'medium',
      colorMode: options.colorMode || base.colorMode,
    };
  }

  function downsampleRgb(srcRgba, width, height, workW, workH) {
    var size = workW * workH;
    var bgR = new Float32Array(size);
    var bgG = new Float32Array(size);
    var bgB = new Float32Array(size);

    if (workW === width && workH === height) {
      for (var i = 0, p = 0; i < size; i++, p += 4) {
        bgR[i] = srcRgba[p];
        bgG[i] = srcRgba[p + 1];
        bgB[i] = srcRgba[p + 2];
      }
      return { bgR: bgR, bgG: bgG, bgB: bgB };
    }

    var scaleX = width / workW;
    var scaleY = height / workH;

    for (var wy = 0; wy < workH; wy++) {
      var yStart = Math.floor(wy * scaleY);
      var yEnd = Math.min(height, Math.max(yStart + 1, Math.ceil((wy + 1) * scaleY)));
      for (var wx = 0; wx < workW; wx++) {
        var xStart = Math.floor(wx * scaleX);
        var xEnd = Math.min(width, Math.max(xStart + 1, Math.ceil((wx + 1) * scaleX)));

        var sumR = 0;
        var sumG = 0;
        var sumB = 0;
        var count = 0;

        for (var y = yStart; y < yEnd; y++) {
          var rowBase = y * width;
          for (var x = xStart; x < xEnd; x++) {
            var idx = (rowBase + x) * 4;
            sumR += srcRgba[idx];
            sumG += srcRgba[idx + 1];
            sumB += srcRgba[idx + 2];
            count++;
          }
        }

        var outIdx = wy * workW + wx;
        bgR[outIdx] = sumR / count;
        bgG[outIdx] = sumG / count;
        bgB[outIdx] = sumB / count;
      }
    }

    return { bgR: bgR, bgG: bgG, bgB: bgB };
  }

  /**
   * 1D sliding window extremum (max if isMax=true, min if isMax=false)
   * using an O(N) monotonic deque with clamped borders.
   */
  function morph1D(src, dst, width, height, radius, horizontal, isMax, deque) {
    if (radius <= 0) {
      dst.set(src);
      return;
    }

    if (horizontal) {
      for (var y = 0; y < height; y++) {
        var rowOffset = y * width;
        var head = 0;
        var tail = 0;

        for (var i = 0; i < Math.min(radius, width); i++) {
          var vInit = src[rowOffset + i];
          while (tail > head) {
            var backVal = src[rowOffset + deque[tail - 1]];
            if (isMax ? backVal <= vInit : backVal >= vInit) {
              tail--;
            } else {
              break;
            }
          }
          deque[tail++] = i;
        }

        for (var x = 0; x < width; x++) {
          var rightIdx = x + radius;
          if (rightIdx < width) {
            var vRight = src[rowOffset + rightIdx];
            while (tail > head) {
              var bVal = src[rowOffset + deque[tail - 1]];
              if (isMax ? bVal <= vRight : bVal >= vRight) {
                tail--;
              } else {
                break;
              }
            }
            deque[tail++] = rightIdx;
          }

          var leftBound = x - radius;
          while (head < tail && deque[head] < leftBound) {
            head++;
          }
          dst[rowOffset + x] = src[rowOffset + deque[head]];
        }
      }
    } else {
      for (var col = 0; col < width; col++) {
        var qHead = 0;
        var qTail = 0;

        for (var j = 0; j < Math.min(radius, height); j++) {
          var vInitC = src[j * width + col];
          while (qTail > qHead) {
            var backValC = src[deque[qTail - 1] * width + col];
            if (isMax ? backValC <= vInitC : backValC >= vInitC) {
              qTail--;
            } else {
              break;
            }
          }
          deque[qTail++] = j;
        }

        for (var row = 0; row < height; row++) {
          var bottomIdx = row + radius;
          if (bottomIdx < height) {
            var vBottom = src[bottomIdx * width + col];
            while (qTail > qHead) {
              var bValC = src[deque[qTail - 1] * width + col];
              if (isMax ? bValC <= vBottom : bValC >= vBottom) {
                qTail--;
              } else {
                break;
              }
            }
            deque[qTail++] = bottomIdx;
          }

          var topBound = row - radius;
          while (qHead < qTail && deque[qHead] < topBound) {
            qHead++;
          }
          dst[row * width + col] = src[deque[qHead] * width + col];
        }
      }
    }
  }

  function boxBlur1D(src, dst, width, height, radius, horizontal) {
    if (radius <= 0) {
      dst.set(src);
      return;
    }
    var winSize = radius * 2 + 1;
    var inv = 1 / winSize;

    if (horizontal) {
      var maxX = width - 1;
      for (var y = 0; y < height; y++) {
        var rowBase = y * width;
        var sum = src[rowBase] * (radius + 1);
        for (var k = 1; k <= radius; k++) {
          sum += src[rowBase + (k < maxX ? k : maxX)];
        }
        for (var x = 0; x < width; x++) {
          dst[rowBase + x] = sum * inv;
          var addIdx = x + radius + 1;
          var remIdx = x - radius;
          sum += src[rowBase + (addIdx < maxX ? addIdx : maxX)];
          sum -= src[rowBase + (remIdx > 0 ? remIdx : 0)];
        }
      }
    } else {
      var maxY = height - 1;
      for (var xCol = 0; xCol < width; xCol++) {
        var colSum = src[xCol] * (radius + 1);
        for (var ky = 1; ky <= radius; ky++) {
          colSum += src[(ky < maxY ? ky : maxY) * width + xCol];
        }
        for (var row = 0; row < height; row++) {
          dst[row * width + xCol] = colSum * inv;
          var addY = row + radius + 1;
          var remY = row - radius;
          colSum += src[(addY < maxY ? addY : maxY) * width + xCol];
          colSum -= src[(remY > 0 ? remY : 0) * width + xCol];
        }
      }
    }
  }

  function estimateChannelBackground(channel, tmp, width, height, morphR, closeR, blurR, deque) {
    // 1. Morphological dilation (max filter) removes dark text, lines, signatures, stamps
    morph1D(channel, tmp, width, height, morphR, true, true, deque);
    morph1D(tmp, channel, width, height, morphR, false, true, deque);

    // 2. Mild morphological erosion (min filter) closes isolated bright specular dots
    if (closeR > 0) {
      morph1D(channel, tmp, width, height, closeR, true, false, deque);
      morph1D(tmp, channel, width, height, closeR, false, false, deque);
    }

    // 3. 3-pass separable box blur approximates Gaussian smoothing without halos
    for (var p = 0; p < 3; p++) {
      boxBlur1D(channel, tmp, width, height, blurR, true);
      boxBlur1D(tmp, channel, width, height, blurR, false);
    }
  }

  function estimateBackground(srcRgba, width, height, backgroundSize) {
    var WORK_MAX = 400;
    var maxDim = Math.max(width, height);
    var workW = width;
    var workH = height;

    if (maxDim > WORK_MAX) {
      var ratio = WORK_MAX / maxDim;
      workW = Math.max(1, Math.round(width * ratio));
      workH = Math.max(1, Math.round(height * ratio));
    }

    var ds = downsampleRgb(srcRgba, width, height, workW, workH);
    var workMax = Math.max(workW, workH);

    var factor = backgroundSize === 'small' ? 0.022 : backgroundSize === 'large' ? 0.055 : 0.035;
    var minMorph = backgroundSize === 'small' ? 2 : backgroundSize === 'large' ? 4 : 3;
    var morphR = Math.min(workMax - 1, Math.max(minMorph, Math.round(workMax * factor)));
    if (workMax <= 4) morphR = Math.max(0, workMax - 1);

    var closeR = morphR > 1 ? Math.max(1, Math.round(morphR * 0.25)) : 0;
    var blurR = morphR > 0 ? Math.max(2, Math.round(morphR * 1.4)) : 0;

    var tmp = new Float32Array(workW * workH);
    var deque = new Int32Array(Math.max(workW, workH));

    estimateChannelBackground(ds.bgR, tmp, workW, workH, morphR, closeR, blurR, deque);
    estimateChannelBackground(ds.bgG, tmp, workW, workH, morphR, closeR, blurR, deque);
    estimateChannelBackground(ds.bgB, tmp, workW, workH, morphR, closeR, blurR, deque);

    return {
      workW: workW,
      workH: workH,
      bgR: ds.bgR,
      bgG: ds.bgG,
      bgB: ds.bgB,
    };
  }

  function applySharpen(rgbBuf, width, height, sharpness) {
    if (sharpness <= 0 || width < 3 || height < 3) return;
    var amount = (sharpness / 100) * 1.1;
    var len = width * height;
    var hBlur = new Float32Array(len * 3);

    // Horizontal [1, 2, 1] / 4 pass
    for (var y = 0; y < height; y++) {
      var row = y * width;
      for (var x = 0; x < width; x++) {
        var xm1 = x > 0 ? x - 1 : 0;
        var xp1 = x < width - 1 ? x + 1 : width - 1;
        var i0 = (row + xm1) * 3;
        var i1 = (row + x) * 3;
        var i2 = (row + xp1) * 3;
        hBlur[i1] = (rgbBuf[i0] + rgbBuf[i1] * 2 + rgbBuf[i2]) * 0.25;
        hBlur[i1 + 1] = (rgbBuf[i0 + 1] + rgbBuf[i1 + 1] * 2 + rgbBuf[i2 + 1]) * 0.25;
        hBlur[i1 + 2] = (rgbBuf[i0 + 2] + rgbBuf[i1 + 2] * 2 + rgbBuf[i2 + 2]) * 0.25;
      }
    }

    // Vertical [1, 2, 1] / 4 pass + noise-gated unsharp mask
    for (var yv = 0; yv < height; yv++) {
      var ym1 = yv > 0 ? yv - 1 : 0;
      var yp1 = yv < height - 1 ? yv + 1 : height - 1;
      for (var xv = 0; xv < width; xv++) {
        var j0 = (ym1 * width + xv) * 3;
        var j1 = (yv * width + xv) * 3;
        var j2 = (yp1 * width + xv) * 3;

        for (var c = 0; c < 3; c++) {
          var blurVal = (hBlur[j0 + c] + hBlur[j1 + c] * 2 + hBlur[j2 + c]) * 0.25;
          var orig = rgbBuf[j1 + c];
          var diff = orig - blurVal;
          if (diff > 3 || diff < -3) {
            rgbBuf[j1 + c] = clamp(orig + amount * diff, 0, 255);
          }
        }
      }
    }
  }

  function processImageData(srcRgba, width, height, options) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new RangeError('Invalid image dimensions');
    }
    if (!srcRgba || srcRgba.length !== width * height * 4) {
      throw new RangeError('Invalid RGBA buffer length');
    }

    var opts = normalizeOptions(options);
    if (
      opts.colorMode === 'original' ||
      (opts.colorMode === 'natural' &&
        opts.shadowStrength === 0 &&
        opts.whiteness === 0 &&
        opts.contrast === 0 &&
        opts.sharpness === 0)
    ) {
      return new Uint8ClampedArray(srcRgba);
    }

    var pixelCount = width * height;
    var s = opts.shadowStrength / 100;
    var w = opts.whiteness / 100;
    var k = opts.contrast / 100;

    var bg = s > 0 ? estimateBackground(srcRgba, width, height, opts.backgroundSize) : null;

    var whitePoint = 255 - w * 38;
    var blackPoint = k * 42;
    if (whitePoint - blackPoint < 16) {
      blackPoint = Math.max(0, whitePoint - 16);
    }
    var invSpan = 1 / (whitePoint - blackPoint);
    var gamma = 1.0 + k * 0.35;

    var bwThresh = 212 - (opts.contrast - 50) * 0.35;
    var bwSteepness = 0.095;

    var rgbWork = new Float32Array(pixelCount * 3);

    // Precompute bilinear X coordinates if shadow removal is active
    var x0Arr, x1Arr, fxArr;
    if (bg) {
      x0Arr = new Int32Array(width);
      x1Arr = new Int32Array(width);
      fxArr = new Float32Array(width);
      var scaleU = bg.workW / width;
      var maxU = bg.workW - 1;
      for (var x = 0; x < width; x++) {
        var u = clamp((x + 0.5) * scaleU - 0.5, 0, maxU);
        var x0 = Math.floor(u);
        var x1 = x0 < maxU ? x0 + 1 : maxU;
        x0Arr[x] = x0;
        x1Arr[x] = x1;
        fxArr[x] = u - x0;
      }
    }

    for (var y = 0; y < height; y++) {
      var y0 = 0, y1 = 0, fy = 0;
      if (bg) {
        var v = clamp((y + 0.5) * (bg.workH / height) - 0.5, 0, bg.workH - 1);
        y0 = Math.floor(v);
        y1 = y0 < bg.workH - 1 ? y0 + 1 : bg.workH - 1;
        fy = v - y0;
      }

      var rowPix = y * width;
      for (var px = 0; px < width; px++) {
        var idx4 = (rowPix + px) * 4;
        var r = srcRgba[idx4];
        var g = srcRgba[idx4 + 1];
        var b = srcRgba[idx4 + 2];

        if (bg) {
          var fx = fxArr[px];
          var w00 = (1 - fx) * (1 - fy);
          var w10 = fx * (1 - fy);
          var w01 = (1 - fx) * fy;
          var w11 = fx * fy;

          var i00 = y0 * bg.workW + x0Arr[px];
          var i10 = y0 * bg.workW + x1Arr[px];
          var i01 = y1 * bg.workW + x0Arr[px];
          var i11 = y1 * bg.workW + x1Arr[px];

          var bR = bg.bgR[i00] * w00 + bg.bgR[i10] * w10 + bg.bgR[i01] * w01 + bg.bgR[i11] * w11;
          var bG = bg.bgG[i00] * w00 + bg.bgG[i10] * w10 + bg.bgG[i01] * w01 + bg.bgG[i11] * w11;
          var bB = bg.bgB[i00] * w00 + bg.bgB[i10] * w10 + bg.bgB[i01] * w01 + bg.bgB[i11] * w11;

          var normR = (r / (bR > 28 ? bR : 28)) * 255;
          var normG = (g / (bG > 28 ? bG : 28)) * 255;
          var normB = (b / (bB > 28 ? bB : 28)) * 255;

          if (normR > 255) normR = 255;
          if (normG > 255) normG = 255;
          if (normB > 255) normB = 255;

          r = r * (1 - s) + normR * s;
          g = g * (1 - s) + normG * s;
          b = b * (1 - s) + normB * s;
        }

        var idx3 = (rowPix + px) * 3;
        if (opts.colorMode === 'grayscale' || opts.colorMode === 'bw') {
          var lum = 0.299 * r + 0.587 * g + 0.114 * b;
          var tLum = clamp((lum - blackPoint) * invSpan, 0, 1);
          var yTone = Math.pow(tLum, gamma) * 255;

          if (opts.colorMode === 'bw') {
            yTone = 255 / (1 + Math.exp(-bwSteepness * (yTone - bwThresh)));
          }
          rgbWork[idx3] = yTone;
          rgbWork[idx3 + 1] = yTone;
          rgbWork[idx3 + 2] = yTone;
        } else {
          var tr = clamp((r - blackPoint) * invSpan, 0, 1);
          var tg = clamp((g - blackPoint) * invSpan, 0, 1);
          var tb = clamp((b - blackPoint) * invSpan, 0, 1);

          var outR = Math.pow(tr, gamma) * 255;
          var outG = Math.pow(tg, gamma) * 255;
          var outB = Math.pow(tb, gamma) * 255;

          if (opts.colorMode === 'magic') {
            var yOut = 0.299 * outR + 0.587 * outG + 0.114 * outB;
            var inkWeight = clamp((245 - yOut) / 60, 0, 1);
            if (inkWeight > 0) {
              var sat = 1 + 0.28 * inkWeight;
              outR = clamp(yOut + (outR - yOut) * sat, 0, 255);
              outG = clamp(yOut + (outG - yOut) * sat, 0, 255);
              outB = clamp(yOut + (outB - yOut) * sat, 0, 255);
            }
          }

          rgbWork[idx3] = outR;
          rgbWork[idx3 + 1] = outG;
          rgbWork[idx3 + 2] = outB;
        }
      }
    }

    if (opts.sharpness > 0) {
      applySharpen(rgbWork, width, height, opts.sharpness);
    }

    var outRgba = new Uint8ClampedArray(srcRgba.length);
    for (var pIdx = 0; pIdx < pixelCount; pIdx++) {
      var o4 = pIdx * 4;
      var o3 = pIdx * 3;
      if (opts.colorMode === 'grayscale' || opts.colorMode === 'bw') {
        var mono = Math.round(clamp(rgbWork[o3], 0, 255));
        outRgba[o4] = mono;
        outRgba[o4 + 1] = mono;
        outRgba[o4 + 2] = mono;
      } else {
        outRgba[o4] = Math.round(clamp(rgbWork[o3], 0, 255));
        outRgba[o4 + 1] = Math.round(clamp(rgbWork[o3 + 1], 0, 255));
        outRgba[o4 + 2] = Math.round(clamp(rgbWork[o3 + 2], 0, 255));
      }
      outRgba[o4 + 3] = srcRgba[o4 + 3];
    }

    return outRgba;
  }

  var api = {
    PRESETS: PRESETS,
    getPresetOptions: getPresetOptions,
    processImageData: processImageData,
  };

  root.DocClearProcessor = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);

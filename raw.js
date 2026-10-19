/* Preset Lab: reads the picture inside a camera RAW file (DNG, CR2, CR3, NEF, ARW, RAF, ORF, RW2 and others).
   RAW files carry a full-size JPEG preview made by the camera. This finds the biggest one and returns its bytes.
   It does not decode the raw sensor data. Everything happens in the browser. */
(function (root) {
  'use strict';
  var R = {};
  R.EXT = ['dng', 'cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'raf', 'orf', 'rw2', 'rwl', 'raw', 'pef', 'ptx', 'srw', 'x3f', '3fr', 'fff', 'erf', 'kdc', 'dcr', 'mrw', 'mef', 'mos', 'iiq', 'cap', 'gpr'];
  R.isRaw = function (name) { var m = /\.([a-z0-9]+)$/i.exec(name || ''); return !!m && R.EXT.indexOf(m[1].toLowerCase()) >= 0; };
  R.accept = 'image/*,' + R.EXT.map(function (e) { return '.' + e; }).join(',');

  /* Length of a JPEG that starts at i (FFD8), or 0 if it does not parse to a clean end. */
  function jpegEnd(b, i) {
    var n = b.length, p = i + 2, sawFrame = false;
    while (p + 4 <= n) {
      if (b[p] !== 0xFF) return 0;
      var m = b[p + 1];
      if (m === 0xFF) { p++; continue; }
      if (m === 0xD9) return sawFrame ? p + 2 - i : 0;
      if (m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { p += 2; continue; }
      var len = (b[p + 2] << 8) | b[p + 3];
      if (len < 2) return 0;
      if (m === 0xC0 || m === 0xC1 || m === 0xC2) sawFrame = true;
      if (m === 0xDA) {
        p += 2 + len;
        while (p + 1 < n) { /* entropy data: skip until a real marker */
          if (b[p] === 0xFF && b[p + 1] !== 0 && !(b[p + 1] >= 0xD0 && b[p + 1] <= 0xD7)) break;
          p++;
        }
        continue;
      }
      p += 2 + len;
    }
    return 0;
  }
  /* All embedded JPEGs, biggest first. Pictures nested inside another JPEG (its thumbnail) are skipped. */
  R.previews = function (b, minBytes) {
    var out = [], n = b.length, i = 0; minBytes = minBytes || 10000;
    while (i + 3 < n) {
      if (b[i] === 0xFF && b[i + 1] === 0xD8 && b[i + 2] === 0xFF) {
        var len = jpegEnd(b, i);
        if (len >= minBytes) { out.push({ start: i, length: len }); i += len; continue; }
        if (len > 0) { i += len; continue; }
      }
      i++;
    }
    return out.sort(function (a, c) { return c.length - a.length; });
  };
  function u16(b, o, le) { return le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]; }
  function u32(b, o, le) { return le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }
  /* Orientation (1-8) from a TIFF block that starts at t, or 0 if there is none. */
  R.tiffOrientation = function (b, t) {
    if (t + 8 > b.length) return 0;
    var le = b[t] === 0x49 && b[t + 1] === 0x49;
    if (!le && !(b[t] === 0x4D && b[t + 1] === 0x4D)) return 0;
    var ifd = t + u32(b, t + 4, le); if (ifd + 2 > b.length) return 0;
    var cnt = u16(b, ifd, le);
    for (var k = 0; k < cnt && ifd + 2 + k * 12 + 12 <= b.length; k++) {
      var e = ifd + 2 + k * 12;
      if (u16(b, e, le) === 0x0112) { var v = u16(b, e + 8, le); return v >= 1 && v <= 8 ? v : 0; }
    }
    return 0;
  };
  /* Orientation stored inside a JPEG (Exif block), or 0 when it has none. */
  R.jpegOrientation = function (b, start) {
    var p = start + 2, n = b.length;
    while (p + 4 < n && b[p] === 0xFF) {
      var m = b[p + 1], len = (b[p + 2] << 8) | b[p + 3];
      if (m === 0xE1 && b[p + 4] === 0x45 && b[p + 5] === 0x78 && b[p + 6] === 0x69 && b[p + 7] === 0x66) return R.tiffOrientation(b, p + 10);
      if (m === 0xDA || len < 2) break;
      p += 2 + len;
    }
    return 0;
  };
  /* The turn still needed for the preview that starts at `start` (1 = none). */
  R.orientFor = function (b, start) { var own = R.jpegOrientation(b, start), file = R.tiffOrientation(b, 0); return own ? 1 : (file || 1); };
  /* Pick the picture to use. Returns { start, length, orient (turn still needed, 1 = none), count } or null. */
  R.pick = function (b) {
    var list = R.previews(b); if (!list.length) return null;
    var best = list[0], own = R.jpegOrientation(b, best.start), file = R.tiffOrientation(b, 0);
    return { start: best.start, length: best.length, orient: own ? 1 : (file || 1), count: list.length, candidates: list };
  };

  /* ---------- plain Bayer DNG (no preview picture inside) ---------- */
  var TSIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
  function readIfd(b, t, off, le, tags) {
    if (off + 2 > b.length) return null;
    var cnt = u16(b, off, le), out = {}, k, e, tag, type, n, size, vo, vals, i;
    for (k = 0; k < cnt && off + 2 + k * 12 + 12 <= b.length; k++) {
      e = off + 2 + k * 12; tag = u16(b, e, le); type = u16(b, e + 2, le); n = u32(b, e + 4, le);
      size = (TSIZE[type] || 1) * n; vo = size <= 4 ? e + 8 : t + u32(b, e + 8, le);
      if (vo + size > b.length || n > 4000000) continue;
      vals = [];
      for (i = 0; i < n; i++) {
        if (type === 3) vals.push(u16(b, vo + i * 2, le));
        else if (type === 4) vals.push(u32(b, vo + i * 4, le));
        else if (type === 1 || type === 7) vals.push(b[vo + i]);
        else if (type === 5) { var d = u32(b, vo + i * 8 + 4, le); vals.push(d ? u32(b, vo + i * 8, le) / d : 0); }
        else if (type === 10) { var sn = u32(b, vo + i * 8, le) | 0, sd = u32(b, vo + i * 8 + 4, le) | 0; vals.push(sd ? sn / sd : 0); }
        else if (type === 8) { var sv = u16(b, vo + i * 2, le); vals.push(sv > 32767 ? sv - 65536 : sv); }
        else break;
      }
      out[tag] = vals;
    }
    return out;
  }
  function inv3(m) {
    var a = m[0], bb = m[1], c = m[2], d = m[3], e = m[4], f = m[5], g = m[6], h = m[7], i = m[8];
    var A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + bb * B + c * C;
    if (!det) return null;
    return [A / det, -(bb * i - c * h) / det, (bb * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - bb * g) / det, (a * e - bb * d) / det];
  }
  function mul3(p, q) { var o = [], r, c, k; for (r = 0; r < 3; r++) for (c = 0; c < 3; c++) { var s = 0; for (k = 0; k < 3; k++) s += p[r * 3 + k] * q[k * 3 + c]; o.push(s); } return o; }
  /* Find the uncompressed Bayer image in a DNG and turn it into a picture at half size (each 2 x 2 block becomes one pixel).
     Returns { width, height, data (RGBA), orient } or { error }. */
  R.decodeBayer = function (b) {
    var le = b[0] === 0x49 && b[1] === 0x49;
    if (!(le || (b[0] === 0x4D && b[1] === 0x4D))) return { error: 'not a TIFF based file' };
    var ifd0 = readIfd(b, 0, u32(b, 4, le), le); if (!ifd0) return { error: 'unreadable' };
    var list = [ifd0], subs = ifd0[330] || [], i, c;
    for (i = 0; i < subs.length; i++) { var s = readIfd(b, 0, subs[i], le); if (s) list.push(s); }
    var cfa = null;
    for (i = 0; i < list.length; i++) if (list[i][262] && list[i][262][0] === 32803 && list[i][273] || list[i] && list[i][262] && list[i][262][0] === 32803 && list[i][324]) { cfa = list[i]; break; }
    if (!cfa) return { error: 'no sensor data' };
    var comp = (cfa[259] || [1])[0], bits = (cfa[258] || [16])[0], w = cfa[256][0], h = cfa[257][0];
    if (comp !== 1) return { error: 'compressed', comp: comp };
    if (!cfa[33422] || cfa[33422].length < 4) return { error: 'no colour pattern' };
    var offs = cfa[273] || cfa[324], cnts = cfa[279] || cfa[325];
    if (!offs || !cnts) return { error: 'no strips' };
    var total = 0; for (i = 0; i < cnts.length; i++) total += cnts[i];
    if (cfa[324]) return { error: 'tiled uncompressed' };
    if (total < w * h * 2) return { error: 'not 16 bit words', bits: bits };
    if (w * h > 80e6) return { error: 'too large' };
    var raw = new Uint16Array(w * h), pos = 0, j;
    for (i = 0; i < offs.length; i++) { var o = offs[i], n = Math.min(cnts[i] >> 1, raw.length - pos); for (j = 0; j < n; j++) raw[pos + j] = le ? b[o + j * 2] | (b[o + j * 2 + 1] << 8) : (b[o + j * 2] << 8) | b[o + j * 2 + 1]; pos += n; }
    var pat = cfa[33422].slice(0, 4); /* 0 red, 1 green, 2 blue */
    var wl = (ifd0[50717] || cfa[50717] || [65535])[0], bl = cfa[50714] || ifd0[50714] || [0], bld = cfa[50713] || ifd0[50713] || [1, 1];
    function blackAt(px, py) { var bw = bld[0] || 1, bh = bld[1] || 1, k2 = (py % bh) * bw + (px % bw); return bl.length ? (bl[k2 % bl.length] || 0) : 0; }
    var neutral = ifd0[50728] || cfa[50728], gains = [1, 1, 1];
    if (neutral && neutral.length >= 3 && neutral[0] > 0 && neutral[1] > 0 && neutral[2] > 0) gains = [neutral[1] / neutral[0], 1, neutral[1] / neutral[2]];
    var cm = ifd0[50722] && (ifd0[50779] || [])[0] === 21 ? ifd0[50722] : (ifd0[50721] || ifd0[50722]);
    var toRgb = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    if (cm && cm.length >= 9) {
      var rgb2xyz = [0.412453, 0.357580, 0.180423, 0.212671, 0.715160, 0.072169, 0.019334, 0.119193, 0.950227];
      var camRgb = mul3(cm.slice(0, 9), rgb2xyz), r2;
      for (r2 = 0; r2 < 3; r2++) { var sm = camRgb[r2 * 3] + camRgb[r2 * 3 + 1] + camRgb[r2 * 3 + 2]; if (sm) for (c = 0; c < 3; c++) camRgb[r2 * 3 + c] /= sm; }
      var iv = inv3(camRgb); if (iv) toRgb = iv;
    }
    var W2 = w >> 1, H2 = h >> 1, lin = new Float32Array(W2 * H2 * 3), x, y, den = Math.max(1, wl - 0);
    for (y = 0; y < H2; y++) for (x = 0; x < W2; x++) {
      var acc = [0, 0, 0], cn = [0, 0, 0], dy, dx;
      for (dy = 0; dy < 2; dy++) for (dx = 0; dx < 2; dx++) {
        var px = x * 2 + dx, py = y * 2 + dy, ch = pat[dy * 2 + dx], v = raw[py * w + px] - blackAt(px, py);
        acc[ch] += v < 0 ? 0 : v; cn[ch]++;
      }
      var rr = acc[0] / Math.max(1, cn[0]), gg = acc[1] / Math.max(1, cn[1]), bb2 = acc[2] / Math.max(1, cn[2]);
      var span = Math.max(1, wl - (bl[0] || 0));
      rr = rr / span * gains[0]; gg = gg / span * gains[1]; bb2 = bb2 / span * gains[2];
      var o2 = (y * W2 + x) * 3;
      lin[o2] = toRgb[0] * rr + toRgb[1] * gg + toRgb[2] * bb2; lin[o2 + 1] = toRgb[3] * rr + toRgb[4] * gg + toRgb[5] * bb2; lin[o2 + 2] = toRgb[6] * rr + toRgb[7] * gg + toRgb[8] * bb2;
    }
    /* automatic exposure: put the 99.5th percentile of brightness near white */
    var hist = new Uint32Array(4096), np = W2 * H2, step = Math.max(1, (np / 200000) | 0), cntS = 0, k3;
    var hi = 0; for (k3 = 0; k3 < np; k3 += step) { var yv = 0.2126 * lin[k3 * 3] + 0.7152 * lin[k3 * 3 + 1] + 0.0722 * lin[k3 * 3 + 2]; if (yv > hi) hi = yv; }
    var top = Math.max(hi, 1e-6), bin = 4095 / top;
    for (k3 = 0; k3 < np; k3 += step) { var y2 = 0.2126 * lin[k3 * 3] + 0.7152 * lin[k3 * 3 + 1] + 0.0722 * lin[k3 * 3 + 2]; hist[Math.max(0, Math.min(4095, (y2 * bin) | 0))]++; cntS++; }
    var acc2 = 0, p995 = top; for (k3 = 4095; k3 >= 0; k3--) { acc2 += hist[k3]; if (acc2 >= cntS * 0.005) { p995 = (k3 + 1) / bin; break; } }
    var gain = Math.max(0.3, Math.min(20, 0.95 / Math.max(p995, 1e-6)));
    var out = new Uint8ClampedArray(np * 4), lut = new Uint8ClampedArray(4096);
    for (k3 = 0; k3 < 4096; k3++) { var l = k3 / 4095; var gm = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055; gm = gm * 0.65 + (gm * gm * (3 - 2 * gm)) * 0.35; lut[k3] = Math.round(gm * 255); }
    for (k3 = 0; k3 < np; k3++) for (c = 0; c < 3; c++) { var vv = lin[k3 * 3 + c] * gain; out[k3 * 4 + c] = lut[vv <= 0 ? 0 : vv >= 1 ? 4095 : (vv * 4095 + 0.5) | 0]; out[k3 * 4 + 3] = 255; }
    return { width: W2, height: H2, data: out, orient: R.tiffOrientation(b, 0) || 1 };
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = R; else root.RAWX = R;
})(typeof self !== 'undefined' ? self : this);
